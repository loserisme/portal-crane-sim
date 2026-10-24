/* =============================================================
 * script.js — 简易指令解析与执行
 *
 * 语法：每行一条指令，行内 # 之后为注释
 *   回转 90          回转角（度）
 *   变幅 30          工作幅度（m）
 *   起升 15          起升高度（m，抓斗底距轨面）
 *   抓斗 0           抓斗开度（0 闭合 ~ 100 全开）
 *   行走 5           大车位置（m）
 *   装载 1           斗内物料（0 空 / 1 满）
 *   等待 1.5         延时（s，按仿真时间）
 *   速度 2           仿真倍速
 *   复位             回到初始姿态
 *
 * 执行方式：逐条下达目标值，等实测值进入容差后再执行下一条。
 * ============================================================= */
(function (w) {
  'use strict';

  var C = w.CFG, KT = w.KT, U = w.U;

  var S = {
    lines: [],
    idx: -1,
    running: false,
    waitT: 0,
    status: '',
    err: false,
    t: 0,
    onUpdate: null,
  };

  /* ---------------- 指令表 ---------------- */
  var CMDS = {
    回转: {
      alias: ['回转', 'slew'], tol: 1.0,
      apply: function (v) { KT.set('slew', v); },
      done: function (v) { return Math.abs(U.deg(KT.ST.slew) - v) < 1.0; },
      fmt: '回转角 %s°',
    },
    变幅: {
      alias: ['变幅', 'radius', '幅度'], tol: 0.15,
      apply: function (v) { KT.setRadius(v); },
      done: function (v) { return Math.abs(KT.ST.Cl.x - v) < 0.18; },
      fmt: '幅度 %s m',
    },
    起升: {
      alias: ['起升', 'hoist'], tol: 0.12,
      apply: function (v) { KT.set('hoist', v); },
      done: function (v) { return Math.abs(KT.ST.hoist - v) < 0.14; },
      fmt: '起升 %s m',
    },
    抓斗: {
      alias: ['抓斗', 'grab'], tol: 0.03,
      apply: function (v) { KT.set('grab', U.clamp(v, 0, 100) / 100); },
      done: function (v) { return Math.abs(KT.ST.grabOpen * 100 - v) < 4; },
      fmt: '抓斗 %s%',
    },
    行走: {
      alias: ['行走', 'travel'], tol: 0.1,
      apply: function (v) { KT.set('travel', v); },
      done: function (v) { return Math.abs(KT.ST.travel - v) < 0.12; },
      fmt: '行走 %s m',
    },
    装载: {
      alias: ['装载', 'load'], instant: true,
      apply: function (v) { KT.setLoad(U.clamp(v, 0, 1)); },
      fmt: '装载 %s',
    },
    等待: {
      alias: ['等待', 'wait', 'delay'], wait: true,
      apply: function (v) { S.waitT = Math.max(v, 0); },
      fmt: '等待 %s s',
    },
    速度: {
      alias: ['速度', 'speed'], instant: true,
      apply: function (v) { if (w.UI && w.UI.setSpeed) w.UI.setSpeed(U.clamp(v, 0.1, 8)); },
      fmt: '倍速 %s×',
    },
    复位: {
      alias: ['复位', 'reset'], instant: true,
      apply: function () {
        KT.reset();
        KT.set('slew', -90);
        KT.setRadius(30);
        KT.set('hoist', 3.2);
        KT.set('grab', 1);
        if (w.UI) { w.UI.setSpeed(1); w.UI.syncSliders(); }
      },
      fmt: '复位',
    },
  };

  function findCmd(name) {
    for (var k in CMDS) {
      if (!CMDS.hasOwnProperty(k)) continue;
      var al = CMDS[k].alias;
      for (var i = 0; i < al.length; i++) {
        if (al[i].toLowerCase() === name) return { key: k, def: CMDS[k] };
      }
    }
    return null;
  }

  /* ---------------- 解析 ---------------- */
  S.parse = function (text) {
    var out = [], errs = [];
    var raw = String(text || '').split(/\r?\n/);
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i].replace(/#.*$/, '').replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      var parts = line.split(/[\s,，]+/).filter(function (t) { return t.length; });
      var name = parts[0].toLowerCase();
      var hit = findCmd(name);
      if (!hit) {
        errs.push('第 ' + (i + 1) + ' 行：未知指令「' + parts[0] + '」');
        continue;
      }
      var needArg = !['复位'].includes(hit.key);
      var val = parseFloat(parts[1]);
      if (needArg && !isFinite(val)) {
        errs.push('第 ' + (i + 1) + ' 行：' + parts[0] + ' 缺少数值参数');
        continue;
      }
      out.push({
        no: i + 1, key: hit.key, def: hit.def,
        val: isFinite(val) ? val : 0,
        raw: line,
      });
    }
    return { list: out, errs: errs };
  };

  /* ---------------- 执行 ---------------- */
  S.run = function (text) {
    var r = S.parse(text);
    if (r.errs.length) {
      S.status = r.errs[0];
      S.err = true;
      S.running = false;
      S._notify();
      return false;
    }
    if (!r.list.length) {
      S.status = '没有可执行指令';
      S.err = true;
      S._notify();
      return false;
    }
    S.lines = r.list;
    S.idx = -1;
    S.running = true;
    S.err = false;
    S.waitT = 0;
    S.status = '运行中';
    if (w.DEMO && w.DEMO.running) w.DEMO.stop();
    S._next();
    S._notify();
    if (w.TRAIN) w.TRAIN.onScriptEvent({ event: 'start' });
    return true;
  };

  S.stop = function (msg) {
    S.running = false;
    S.waitT = 0;
    S.status = msg || '已停止';
    S._notify();
  };

  S._next = function () {
    S.idx++;
    S.waitT = 0;
    S.t = 0;
    var c = S.lines[S.idx];
    if (!c) {
      S.running = false;
      S.status = '执行完毕（' + S.lines.length + ' 条）';
      S._notify();
      if (w.TRAIN) w.TRAIN.onScriptEvent({ event: 'done' });
      return;
    }
    c.def.apply(c.val);
    c.def.done && (S._started = true);
    S.status = '第 ' + c.no + ' 行 · ' + c.def.fmt.replace('%s', c.val);
    S._notify();
    /* 瞬时指令直接进下一条 */
    if (c.def.instant) S._next();
  };

  S._notify = function () {
    if (typeof S.onUpdate === 'function') S.onUpdate(S);
  };

  /* ---------------- 每帧推进 ---------------- */
  S.update = function (dt) {
    if (!S.running) return;
    var c = S.lines[S.idx];
    if (!c) { S.running = false; return; }

    if (S.waitT > 0) {
      S.waitT -= dt;
      if (S.waitT <= 0) S._next();
      return;
    }
    if (c.def.wait) return;   // 等待指令由 waitT 控制

    if (c.def.done && c.def.done(c.val)) { S._next(); return; }

    S.t += dt;
    if (S.t > 45) {
      S.status = '第 ' + c.no + ' 行超时，已跳过';
      S.err = true;
      S._notify();
      S._next();
    }
  };

  /* 默认示例脚本 */
  S.SAMPLE = [
    '# 从船舱抓沙装车（抓取量由插深与开度自动计算）',
    '速度 2        # 仿真倍速',
    '回转 -90',
    '变幅 30',
    '起升 1.2      # 深插，满斗',
    '抓斗 100      # 张斗入舱',
    '等待 0.6',
    '',
    '抓斗 0        # 闭斗抓取',
    '等待 1.2',
    '起升 16       # 提斗出舱',
    '',
    '回转 0        # 转向卡车',
    '变幅 23',
    '起升 5',
    '抓斗 100      # 张斗卸料',
    '等待 1.4',
    '',
    '起升 12',
  ].join('\n');

  w.SCRIPT = S;
})(window);
