/* =============================================================
 * python.js — 浏览器内 Python 控制（Pyodide）
 *
 * 在浏览器里跑真正的 CPython（WebAssembly），把门机的全部状态与
 * 控制接口暴露成 Python 对象 crane，用户可以写算法：
 *   - 定量抓取（读料面高度与斗内填充率，控制插入深度/开度）
 *   - 防摇摆（读摆动角与角速度，反馈控制回转/变幅）
 *
 * 用户代码需定义 control(dt)，引擎每帧调用一次；setup() 可选。
 * ============================================================= */
(function (w) {
  'use strict';

  var KT = w.KT, U = w.U, C = w.CFG;

  var PY = {
    rec: [],          // 曲线记录
    seg: 0,           // 当前数据段（0=基线，1=对比组）
    segNames: ['基线', '算法'],
    recMax: 3600,
    chart: null,
    ready: false,
    loading: false,
    running: false,
    error: '',
    console: [],
    code: '',
    url: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
    onUpdate: null,
    onPrint: null,
    elapsed: 0,
    ticks: 0,
  };

  /* ---------------- 输出 ---------------- */
  PY.print = function (s) {
    PY.console.push('> ' + s);
    if (PY.console.length > 200) PY.console.shift();
    if (typeof PY.onPrint === 'function') PY.onPrint(s);
  };

  PY.err = function (s) {
    PY.console.push('✗ ' + s);
    if (PY.console.length > 200) PY.console.shift();
    if (typeof PY.onPrint === 'function') PY.onPrint('✗ ' + s);
  };

  /* ---------------- JS 侧接口（供 Python 调用） ---------------- */
  function buildBridge() {
    return {
      /* 完整状态，返回 JSON 字符串（Python 侧再解析成 dict） */
      status: function () {
        var s = KT.ST;
        return JSON.stringify({
          slew: +U.deg(s.slew).toFixed(3),
          alpha: +U.deg(s.alpha).toFixed(3),
          radius: +s.radius.toFixed(3),
          hoist: +s.height.toFixed(3),
          grab: +s.grabOpen.toFixed(3),
          load: +s.load.toFixed(3),
          holdLevel: +s.holdLevel.toFixed(3),
          holdRemain: +s.holdRemain.toFixed(3),
          swayX: +s.thx.toFixed(4),
          swayZ: +s.thz.toFixed(4),
          swayVX: +s.thvx.toFixed(4),
          swayVZ: +s.thvz.toFixed(4),
          swayMag: +Math.hypot(s.thx, s.thz).toFixed(4),
          travel: +s.travel.toFixed(3),
          truckLoad: w.DEMO ? w.DEMO.truckLoad : 0,
          grabPos: { x: +s.grabPos.x.toFixed(3), y: +s.grabPos.y.toFixed(3), z: +s.grabPos.z.toFixed(3) },
        });
      },
      /* 设定目标：slew(度) / radius(m) / hoist(m) / grab(0~1) / travel(m) */
      set: function (name, v) {
        if (name === 'radius') { KT.setRadius(v); return; }
        if (name === 'grab') { KT.set('grab', U.clamp(v, 0, 1)); return; }
        KT.set(name, v);
      },
      /* 直接刷新（跳过平滑），便于算法里做瞬时设定 */
      snap: function () { KT.snap(); },
      /* 回转角速度直控（°/s）：用于轨迹规划对比实验 */
      slewRate: function (dps) { KT.setSlewRate(dps); },
      slewFree: function () { KT.releaseSlewRate(); },
      /* 给对比段命名 */
      segName: function (i, name) {
        i = (i === undefined || i < 0) ? PY.seg : Math.max(0, Math.min(3, i | 0));
        PY.segNames[i] = String(name);
      },
      setSpeed: function (v) { if (w.UI) w.UI.setSpeed(v); },
      log: function (s) { PY.print(String(s)); },
      /* 复位 */
      reset: function () { KT.reset(); },
      /* 脚本引擎（复用行式 DSL） */
      runScript: function (code) {
        if (!w.SCRIPT) return 'no script engine';
        return w.SCRIPT.run(code) ? 'ok' : w.SCRIPT.status;
      },
      /* 曲线：Python 传 JSON 数组 */
      plot: function (keysJson) {
        var keys = ['hoist', 'load'];
        try { var k = JSON.parse(keysJson); if (k && k.length) keys = k; } catch (e) {}
        if (w.UI && w.UI.showChart) w.UI.showChart(keys, false);
        return 'chart ' + keys.join(',') + ' / ' + PY.rec.length + ' samples';
      },
      /* 切到下一段（对比模式）：0=基线 1=算法 */
      mark: function (name) {
        PY.seg = Math.min(PY.seg + 1, 3);
        if (name) PY.segNames[PY.seg] = String(name);
        PY.print('— 分段 ' + PY.seg + '：' + PY.segNames[PY.seg] + ' —');
        return PY.seg;
      },
      resetSeg: function () { PY.seg = 0; return 0; },
      plotCompare: function (keysJson) {
        var keys = ['swayMag'];
        try { var k = JSON.parse(keysJson); if (k && k.length) keys = k; } catch (e) {}
        if (w.UI && w.UI.showChart) w.UI.showChart(keys, true);
        return 'compare ' + keys.join(',');
      },
      clearPlot: function () { PY.rec = []; return 'cleared'; },
    };
    function W_SCRIPT_STATUS() { return w.SCRIPT.status; }
  }

  /* ---------------- Python 预置封装 ---------------- */
  var PRELUDE = [
    'import json',
    '',
    'class _Crane:',
    '    """门机控制接口。所有角度单位为度，长度单位为米。"""',
    '',
    '    def status(self):',
    '        """返回当前状态 dict：slew/radius/hoist/grab/load/holdLevel/swayX..."""',
    '        return json.loads(__pybridge__.status())',
    '',
    '    def set(self, name, value):',
    '        """设定机构目标：slew / radius / hoist / grab(0~1) / travel"""',
    '        __pybridge__.set(name, float(value))',
    '',
    '    def slew(self, deg):',
    '        __pybridge__.set("slew", float(deg))',
    '',
    '    def radius(self, m):',
    '        __pybridge__.set("radius", float(m))',
    '',
    '    def hoist(self, m):',
    '        __pybridge__.set("hoist", float(m))',
    '',
    '    def grab(self, v):',
    '        """开度 0 闭合 ~ 1 全开"""',
    '        __pybridge__.set("grab", float(v))',
    '',
    '    def travel(self, m):',
    '        __pybridge__.set("travel", float(m))',
    '',
    '    def speed(self, x):',
    '        __pybridge__.setSpeed(float(x))',
    '',
    '    def snap(self):',
    '        __pybridge__.snap()',
    '',
    '    def slew_rate(self, dps):',
    '        """直接给定回转角速度（°/s），轨迹规划实验用"""',
    '        __pybridge__.slewRate(float(dps))',
    '',
    '    def slew_free(self):',
    '        """退出角速度直控，回到目标角跟随"""',
    '        __pybridge__.slewFree()',
    '',
    '    def seg_name(self, name, i=None):',
    '        """给当前对比段命名"""',
    '        __pybridge__.segName(-1 if i is None else int(i), str(name))',
    '',
    '    def log(self, *a):',
    '        __pybridge__.log(" ".join(str(x) for x in a))',
    '',
    '    def reset(self):',
    '        __pybridge__.reset()',
    '',
    '    def plot(self, keys=None):',
    '        """绘制曲线。keys 为字段名列表，如 ["hoist","load","swayZ"]"""',
    '        __pybridge__.plot(json.dumps(keys or ["hoist", "load"]))',
    '',
    '    def mark(self, name=None):',
    '        """切换到对比组，之后的数据与之前的基线分开画"""',
    '        __pybridge__.mark(name)',
    '',
    '    def plot_compare(self, keys=None):',
    '        """对比绘制：基线段与算法段用不同线型"""',
    '        __pybridge__.plotCompare(json.dumps(keys or ["swayMag"]))',
    '',
    '    def clear_plot(self):',
    '        __pybridge__.clearPlot()',
    '',
    'crane = _Crane()',
    '',
  ].join('\n');

  /* ---------------- 加载 Pyodide ---------------- */
  PY.load = function () {
    if (PY.ready) return Promise.resolve();
    if (PY.loading) return PY._loadPromise;
    PY.loading = true;
    PY.error = '';

    PY._loadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PY.url + 'pyodide.js';
      s.onload = function () {
        w.loadPyodide({ indexURL: PY.url }).then(function (py) {
          PY.pyodide = py;
          py.globals.set('__pybridge__', buildBridge());
          py.runPython(PRELUDE);
          PY.ready = true;
          PY.loading = false;
          PY.print('Python ' + py.version + ' 就绪');
          resolve();
        }).catch(function (e) {
          PY.loading = false;
          PY.error = 'Pyodide 初始化失败：' + (e && e.message || e);
          reject(e);
        });
      };
      s.onerror = function () {
        PY.loading = false;
        PY.error = 'Pyodide 脚本加载失败（检查网络或 CDN 可达性）';
        reject(new Error(PY.error));
      };
      document.head.appendChild(s);
    });
    return PY._loadPromise;
  };

  /* ---------------- 运行 ---------------- */
  PY.run = async function (code) {
    PY.code = code;
    PY.console = [];
    PY.error = '';
    if (!PY.ready) PY.print('正在加载 Python 运行时（首次约 10~30 秒，之后走浏览器缓存）…');
    try {
      await PY.load();
    } catch (e) {
      PY.err(PY.error || String(e));
      return false;
    }
    try {
      /* 每次运行清掉上一次的回调，避免残留 */
      PY.pyodide.runPython('try:\n    del control\nexcept NameError:\n    pass\ntry:\n    del setup\nexcept NameError:\n    pass\n');
      PY.pyodide.runPython(code);

      var g = PY.pyodide.globals;
      PY._ctrl = g.get('control');
      PY._setup = g.get('setup');

      if (typeof PY._ctrl !== 'function') {
        PY.err('代码里找不到 control(dt) 函数。请定义 control(dt) 作为每帧回调。');
        return false;
      }
      PY.running = true;
      PY.elapsed = 0;
      PY.ticks = 0;
      PY.rec = [];
      PY.seg = 0;
      PY.segNames = ['基线', '算法'];
      if (PY._setup) {
        try { PY._setup(); } catch (e) { PY.err('setup() 出错：' + e); }
      }
      PY.print('开始运行');
      PY.notify();
      return true;
    } catch (e) {
      PY.error = briefPyErr(e && e.message || e);
      PY.err(PY.error);
      PY.running = false;
      PY.notify();
      return false;
    }
  };

  PY.stop = function (msg) {
    PY.running = false;
    /* 安全：脚本可能正在直控回转角速度，停止时必须交还控制权 */
    if (w.KT && w.KT.releaseSlewRate) { try { w.KT.releaseSlewRate(); } catch (e) {} }
    if (msg) PY.err(msg);
    else PY.print('已停止');
    if (PY._ctrl && PY._ctrl.destroy) { try { PY._ctrl.destroy(); } catch (e) {} }
    PY._ctrl = null;
    PY.notify();
  };

  /* ---------------- 每帧推进 ---------------- */
  /* 采样：每帧记一条（只在 Python 运行时记录，避免无谓开销） */
  function sample(dt) {
    var st = KT.ST;
    PY.rec.push({
      t: +(PY.elapsed).toFixed(3),
      hoist: +st.height.toFixed(3),
      radius: +st.radius.toFixed(3),
      slew: +U.deg(st.slew).toFixed(2),
      slewRate: +st.vSlew.toFixed(2),
      load: +st.load.toFixed(3),
      grab: +st.grabOpen.toFixed(3),
      swayZ: +st.thz.toFixed(4),
      swayVZ: +st.thvz.toFixed(4),
      swayX: +st.thx.toFixed(4),
      swayMag: +Math.hypot(st.thx, st.thz).toFixed(4),
      seg: PY.seg,
    });
    if (PY.rec.length > PY.recMax) PY.rec.shift();
  }

  /* 从 Python traceback 中提取最后一行有效错误（如 KeyError: 'xxx'） */
  function briefPyErr(raw) {
    var lines = String(raw || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = lines.length - 1; i >= 0; i--) {
      if (/Error|Exception|错误/.test(lines[i])) return lines[i];
    }
    return lines[lines.length - 1] || '未知错误';
  }

  PY.update = function (dt) {
    if (!PY.running || !PY._ctrl) return;
    try {
      PY._ctrl(dt);
      PY.elapsed += dt;
      PY.ticks++;
      sample(dt);
      if (PY.ticks % 20 === 0) PY.notify();
    } catch (e) {
      PY.stop('运行错误：' + briefPyErr(e && e.message || e));
    }
  };

  PY.notify = function () {
    if (typeof PY.onUpdate === 'function') PY.onUpdate(PY);
  };

  /* ---------------- 示例 ---------------- */
  PY.SAMPLE = [
    '# 定量抓取对比：固定浅插 vs 按料面自适应',
    '# 基线组固定插 0.55 m（抓不满），算法组按料面算深度（抓满）',
    '',
    'PH_INIT, PH_DOWN, PH_CLOSE, PH_UP, PH_DONE = 0, 1, 2, 3, 4',
    'phase = PH_INIT',
    'timer = 0.0',
    'rnd = 0            # 0=基线组 1=算法组',
    '',
    'def setup():',
    '    crane.log("定量抓取对比实验启动")',
    '    crane.slew(-90)',
    '    crane.radius(30)',
    '    crane.grab(1.0)',
    '',
    'def control(dt):',
    '    global phase, timer, rnd',
    '    st = crane.status()',
    '',
    '    if phase == PH_INIT:',
    '        if rnd == 1:',
    '            crane.mark("自适应")     # 从这里开始算算法组',
    '        crane.hoist(6.0)',
    '        if st["hoist"] > 5.7:',
    '            phase = PH_DOWN',
    '',
    '    elif phase == PH_DOWN:',
    '        if rnd == 0:',
    '            target = 2.00            # 基线：固定浅插，只抓到一半',
    '        else:',
    '            target = max(st["holdLevel"] - 1.15, 0.60)   # 算法：插到料面下 1.15 m',
    '        crane.hoist(target)',
    '        if abs(st["hoist"] - target) < 0.12:',
    '            phase = PH_CLOSE',
    '            timer = 0.0',
    '',
    '    elif phase == PH_CLOSE:',
    '        crane.grab(0.0)',
    '        timer += dt',
    '        if timer > 1.6:',
    '            crane.log("第 %d 轮填充率 %.0f%%" % (rnd + 1, st["load"] * 100))',
    '            phase = PH_UP',
    '',
    '    elif phase == PH_UP:',
    '        crane.grab(1.0)              # 卸掉，便于下一轮',
    '        crane.hoist(9.0)',
    '        if st["load"] < 0.05 and st["hoist"] > 8.5:',
    '            if rnd == 0:',
    '                rnd = 1',
    '                phase = PH_INIT',
    '                crane.log("--- 切换到自适应策略 ---")',
    '            else:',
    '                crane.plot_compare(["load", "hoist"])',
    '                crane.log("对比曲线已生成")',
    '                phase = PH_DONE',
    '',
  ].join('\n');

  /* 防摇摆对比示例 */
  PY.SAMPLE_SWAY = [
    '# 防摇摆对比：无补偿 vs PD 反馈补偿',
    '# 基线组直接给目标角，算法组用摆动角/角速度做反馈修正',
    '',
    'KP = 1.8',
    'KD = 0.55',
    'SWING_ANGLE = 45.0',
    '',
    'PH_BASE, PH_RESET, PH_PD, PH_DONE = 0, 1, 2, 3',
    'phase = PH_BASE',
    'k = 0.0',
    '',
    'def setup():',
    '    crane.log("防摇摆对比实验启动")',
    '    crane.grab(0.0)',
    '    crane.hoist(14.0)',
    '    crane.slew(0)',
    '',
    'def control(dt):',
    '    global phase, k',
    '    st = crane.status()',
    '',
    '    if phase == PH_BASE:',
    '        # 基线：直接给目标，不做任何补偿',
    '        crane.slew(SWING_ANGLE)',
    '        k += dt',
    '        if k > 9.0:',
    '            crane.mark("PD 补偿")',
    '            phase = PH_RESET',
    '            k = 0.0',
    '            crane.log("基线段结束，摆幅峰值 %.2f°" % (st["swayMag"] * 57.3))',
    '',
    '    elif phase == PH_RESET:',
    '        crane.slew(0)',
    '        k += dt',
    '        if k > 7.0:',
    '            phase = PH_PD',
    '            k = 0.0',
    '',
    '    elif phase == PH_PD:',
    '        # PD 补偿：用摆动偏角与角速度生成反向修正量',
    '        err = -(KP * st["swayZ"] + KD * st["swayVZ"])',
    '        err = max(-6.0, min(6.0, err))',
    '        crane.slew(SWING_ANGLE + err)',
    '        k += dt',
    '        if k > 12.0:',
    '            crane.plot_compare(["swayMag", "slew"])',
    '            crane.log("算法段摆幅峰值 %.2f°" % (st["swayMag"] * 57.3))',
    '            crane.log("对比曲线已生成")',
    '            phase = PH_DONE',
    '',
  ].join('\n');

  /* ---------------- 轨迹规划对比（真实门机运动） ---------------- */
  PY.SAMPLE_TRAJ = String.raw`
# 回转摆动抑制对比：手动 / 梯形 / S 型 / 优化 S 型
# 门机按各方案的速度曲线真实回转 0→90°，四段依次运行，结束后输出对比曲线
import math

V = 9.6            # 额定回转速度 °/s
A = 2.0            # 加速度 °/s²
J = 5.73           # 加加速度 °/s³（=0.1 rad/s³）
TH = 90.0          # 目标转角
HOLD = 4.0         # 每段结束后的观察时间 s
DT = 0.02

# 优化整定参数（离线差分进化结果，与网页实验台一致）
OA1, OJ1, OA2, OJ2, OT = 1.514, 12.0, 1.354, 12.0, 16.31

NAMES = ['手动操作', '梯形加减速', 'S 型加减速', '优化 S 型']


def _area(ts, ws):
    s = 0.0
    for i in range(1, len(ts)):
        s += 0.5 * (ws[i] + ws[i - 1]) * (ts[i] - ts[i - 1])
    return s


def _integrate(segs):
    ts, ws = [0.0], [0.0]
    w = 0.0
    a = 0.0
    for dur, j in segs:
        n = max(1, int(round(dur / DT)))
        h = dur / n
        for _ in range(n):
            w += a * h + 0.5 * j * h * h   # 速度：加速度积分
            a += j * h                      # 加速度：jerk 积分
            ts.append(ts[-1] + h)
            ws.append(w)
    return ts, ws


def _s_ramp(v, a, j):
    tj = a / j
    ta = v / a
    if ta < tj:
        t1 = math.sqrt(v / j)
        return [(t1, j), (t1, -j)]
    return [(tj, j), (ta - tj, 0.0), (tj, -j)]


def _build_s(v, a1, j1, a2, j2):
    ts1, ws1 = _integrate(_s_ramp(v, a1, j1))
    ts2, ws2 = _integrate([(d, -j) for d, j in _s_ramp(v, a2, j2)])
    # 减速段是负速度积分，位移取绝对值
    t_const = (TH - _area(ts1, ws1) - abs(_area(ts2, ws2))) / v
    if t_const < 0:
        t_const = 0.0
    ts, ws = list(ts1), list(ws1)
    n = max(1, int(round(t_const / DT)))
    for _ in range(n):
        ts.append(ts[-1] + t_const / n)
        ws.append(v)
    t0 = ts[-1]
    for i in range(1, len(ts2)):
        ts.append(t0 + ts2[i])
        ws.append(v + ws2[i])      # 减速段：从 v 平滑降到 0
    return ts, ws


def _build_trap(v, a):
    ta = v / a
    T = TH / v + ta
    ts, ws = [0.0], [0.0]
    t = 0.0
    while t < T:
        t += DT
        if t <= ta:
            w = a * t
        elif t <= T - ta:
            w = v
        else:
            w = max(0.0, a * (T - t))
        ts.append(t)
        ws.append(w)
    return ts, ws


def _build_manual():
    steps = [(0.0, 0.0), (1.0, 0.45), (3.6, 0.78), (6.6, 1.00),
             (10.2, 0.72), (11.8, 0.45), (12.6, 0.0)]
    tau = 0.30
    T = 12.6 + 3 * tau
    ts, ws = [0.0], [0.0]
    w = 0.0
    t = 0.0
    while t < T:
        t += DT
        c = 0.0
        for k in range(len(steps)):
            if t >= steps[k][0]:
                c = steps[k][1] * V
        w += (c - w) / tau * DT
        ts.append(t)
        ws.append(w)
    k = TH / max(_area(ts, ws), 1e-6)
    ws = [x * k for x in ws]
    return ts, ws


PROF = [_build_manual(),
        _build_trap(V, A),
        _build_s(V, A, J, A, J),
        _build_s(V, OA1, OJ1, OA2, OJ2)]
DUR = [p[0][-1] for p in PROF]


def rate_at(i, t):
    ts, ws = PROF[i]
    if t <= 0:
        return 0.0
    if t >= ts[-1]:
        return 0.0
    lo, hi = 0, len(ts) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if ts[mid] <= t:
            lo = mid
        else:
            hi = mid
    f = (t - ts[lo]) / max(ts[hi] - ts[lo], 1e-9)
    return ws[lo] + (ws[hi] - ws[lo]) * f


phase = 0
state = 'idle'
t = 0.0
peak = 0.0


def setup():
    crane.radius(26.0)      # 幅度 26 m
    crane.hoist(19.0)       # 悬垂长度约 14 m，摆动周期约 7.5 s
    crane.grab(0.0)
    crane.slew(0.0)
    crane.snap()
    crane.speed(2)          # 2 倍速，约 40 s 跑完四段
    crane.clear_plot()
    crane.seg_name(NAMES[0], 0)
    crane.log('四段轨迹对比开始：每段回转 90°，段间自动复位')
    crane.log('节拍：手动 %.1fs / 梯形 %.1fs / S 型 %.1fs / 优化 %.1fs'
              % (DUR[0], DUR[1], DUR[2], DUR[3]))


def control(dt):
    global phase, state, t, peak

    if phase >= 4:
        return

    if state == 'idle':
        crane.set('slew', 0.0)
        crane.snap()            # 立即回到 0°，同时清空摆动状态
        if phase > 0:
            crane.mark(NAMES[phase])
        t = 0.0
        peak = 0.0
        state = 'run'
        return

    if state == 'run':
        crane.slew_rate(rate_at(phase, t))
        st = crane.status()
        if abs(st['swayMag']) > peak:
            peak = abs(st['swayMag'])
        t += dt
        if t >= DUR[phase]:
            crane.slew_rate(0.0)
            res = abs(crane.status()['swayMag']) * 57.3
            crane.log('%s：T=%.1fs，峰值 %.2f°，停在 %.2f°'
                      % (NAMES[phase], DUR[phase], peak * 57.3, res))
            t = 0.0
            state = 'hold'
        return

    if state == 'hold':
        crane.slew_rate(0.0)
        st = crane.status()
        if abs(st['swayMag']) > peak:
            peak = abs(st['swayMag'])
        t += dt
        if t >= HOLD:
            phase += 1
            state = 'idle'
            if phase >= 4:
                crane.slew_free()
                crane.speed(1)
                crane.plot_compare(['slew', 'slewRate', 'swayMag'])
                crane.log('四段对比完成，曲线已输出（灰=手动 蓝=梯形 橙=S 型 绿=优化）')
`.trim();

  w.PY = PY;
})(window);
