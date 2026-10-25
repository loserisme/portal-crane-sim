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
      setSpeed: function (v) { if (w.UI) w.UI.setSpeed(v); },
      log: function (s) { PY.print(String(s)); },
      /* 复位 */
      reset: function () { KT.reset(); },
      /* 脚本引擎（复用行式 DSL） */
      runScript: function (code) {
        if (!w.SCRIPT) return 'no script engine';
        return w.SCRIPT.run(code) ? 'ok' : W_SCRIPT_STATUS();
      },
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
    '    def log(self, *a):',
    '        __pybridge__.log(" ".join(str(x) for x in a))',
    '',
    '    def reset(self):',
    '        __pybridge__.reset()',
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
      /* 每次运行重建命名空间，避免残留 */
      PY.pyodide.runPython('del control\ndel setup' in {} ? '' : '');
      PY.pyodide.runPython('try:\n    del control\nexcept NameError:\n    pass\ntry:\n    del setup\nexcept NameError:\n    pass\n');
      PY.pyodide.runPython(code);

      var g = PY.pyodide.globals;
      PY._ctrl = g.get('control');
      PY._setup = g.get('setup');

      if (typeof PY._ctrl !== 'function') {
        PY.err('代码里找不到 control(dt) 函数。请定义 control(dt) 作为每帧回调。');
        return false;
      }
      if (PY._setup) {
        try { PY._setup(); } catch (e) { PY.err('setup() 出错：' + e); }
      }
      PY.running = true;
      PY.elapsed = 0;
      PY.ticks = 0;
      PY.print('开始运行');
      PY.notify();
      return true;
    } catch (e) {
      PY.error = String(e && e.message || e).split('\n').slice(0, 2).join(' ');
      PY.err(PY.error);
      PY.running = false;
      PY.notify();
      return false;
    }
  };

  PY.stop = function (msg) {
    PY.running = false;
    if (msg) PY.err(msg);
    else PY.print('已停止');
    if (PY._ctrl && PY._ctrl.destroy) { try { PY._ctrl.destroy(); } catch (e) {} }
    PY._ctrl = null;
    PY.notify();
  };

  /* ---------------- 每帧推进 ---------------- */
  PY.update = function (dt) {
    if (!PY.running || !PY._ctrl) return;
    try {
      PY._ctrl(dt);
      PY.elapsed += dt;
      PY.ticks++;
      if (PY.ticks % 20 === 0) PY.notify();
    } catch (e) {
      PY.stop('运行错误：' + String(e && e.message || e).split('\n')[0]);
    }
  };

  PY.notify = function () {
    if (typeof PY.onUpdate === 'function') PY.onUpdate(PY);
  };

  /* ---------------- 示例 ---------------- */
  PY.SAMPLE = [
    '# 定量抓取：按料面高度自动决定下放深度，保证抓满',
    '# crane.status() 读状态；crane.hoist(m) / crane.grab(v) 控制',
    '',
    'PHASE_INIT, PHASE_DOWN, PHASE_CLOSE, PHASE_UP = 0, 1, 2, 3',
    'phase = PHASE_INIT',
    'timer = 0.0',
    '',
    'def setup():',
    '    """运行前执行一次"""',
    '    crane.log("定量抓取演示启动")',
    '    crane.slew(-90)',
    '    crane.radius(30)',
    '    crane.grab(1.0)',
    '',
    'def control(dt):',
    '    global phase, timer',
    '    st = crane.status()',
    '',
    '    if phase == PHASE_INIT:',
    '        crane.hoist(6.0)',
    '        if abs(st["hoist"] - 6.0) < 0.3:',
    '            phase = PHASE_DOWN',
    '',
    '    elif phase == PHASE_DOWN:',
    '        # 目标：插到料面以下 1.15 m，抓斗高 2.55 m',
    '        target = st["holdLevel"] - 1.15',
    '        target = max(target, 0.6)',
    '        crane.hoist(target)',
    '        if abs(st["hoist"] - target) < 0.12:',
    '            phase = PHASE_CLOSE',
    '            timer = 0.0',
    '',
    '    elif phase == PHASE_CLOSE:',
    '        crane.grab(0.0)          # 闭斗',
    '        timer += dt',
    '        if timer > 1.6:',
    '            crane.log("抓取完成，填充率 %.0f%%" % (st["load"] * 100))',
    '            phase = PHASE_UP',
    '',
    '    elif phase == PHASE_UP:',
    '        crane.hoist(16.0)',
    '        if st["hoist"] > 15.5:',
    '            crane.slew(0)',
    '            crane.radius(23)',
    '            if abs(st["slew"]) < 3 and abs(st["radius"] - 23) < 0.6:',
    '                crane.log("已到卡车上方")',
    '                crane.stop_hint = True',
    '',
  ].join('\n');

  /* 防摇摆示例 */
  PY.SAMPLE_SWAY = [
    '# 防摇摆：用回转速度反馈抑制吊物摆动（PD 控制）',
    '# 摆动状态：swayX/swayZ（偏角，rad）、swayVX/swayVZ（角速度）',
    '',
    'KP = 1.8',
    'KD = 0.55',
    'BASE_SLEW = 0.0     # 目标回转角',
    'TARGET = 45.0       # 本次回转目标',
    '',
    'k = 0.0',
    '',
    'def setup():',
    '    crane.log("防摇摆控制启动：目标回转 %.0f°" % TARGET)',
    '    crane.grab(0.0)',
    '    crane.hoist(14.0)',
    '',
    'def control(dt):',
    '    global k',
    '    st = crane.status()',
    '',
    '    # 摆动偏差量：用横向偏角与角速度构造回调',
    '    err = -(KP * st["swayZ"] + KD * st["swayVZ"])',
    '',
    '    # 限制最大补偿量，避免饱和',
    '    err = max(-6.0, min(6.0, err))',
    '',
    '    # 前馈：目标角 + 摆动补偿',
    '    k += dt',
    '    feed = TARGET if k > 1.0 else 0.0',
    '    crane.slew(feed + err)',
    '',
  ].join('\n');

  w.PY = PY;
})(window);
