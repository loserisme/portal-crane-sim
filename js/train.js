/* =============================================================
 * train.js — 实训任务与自动评分
 *
 * 五个递进任务，覆盖结构认知 → 单机构操作 → 变幅特性 →
 * 抓斗作业 → 轨迹规划 → 脚本编程。
 * 每个任务实时判定，达成后按精度/用时给分，最终汇总成实训报告。
 * ============================================================= */
(function (w) {
  'use strict';

  var KT = w.KT, U = w.U, C = w.CFG;

  var T = {
    tasks: [],
    active: -1,
    running: false,
    student: { name: '', no: '' },
    startTime: 0,
    log: [],
    onUpdate: null,
  };

  /* ---------------- 工具 ---------------- */
  function st() { return KT.ST; }
  function dw(fn, ms) {            // 简易节流
    var last = 0;
    return function () {
      var t = Date.now();
      if (t - last < ms) return;
      last = t;
      fn.apply(null, arguments);
    };
  }

  /* ---------------- 任务定义 ---------------- */
  T.tasks = [
    {
      id: 't1',
      title: '任务一 · 机构定位',
      goal: '把抓斗移到船舱中心正上方 5 m 处：回转 −90°、幅度 30.0 m、起升高度 5.0 m。',
      hint: '三个机构要同时到位。回转与变幅会改变抓斗的水平位置，起升只改高度。',
      point: '精度分：三项误差越小得分越高',
      state: 'idle', score: 0, detail: '',
      init: function () { this.t0 = Date.now(); },
      check: function () {
        var s = st();
        var e1 = Math.abs(U.deg(s.slew) + 90);
        var e2 = Math.abs(s.radius - 30);
        var e3 = Math.abs(s.height - 5);
        this.live = '回转误差 ' + e1.toFixed(1) + '° ／ 幅度误差 ' +
          (e2).toFixed(2) + ' m ／ 高度误差 ' + e3.toFixed(2) + ' m';
        if (e1 < 1.5 && e2 < 0.25 && e3 < 0.25) {
          var score = 100 - (e1 * 6 + e2 * 40 + e3 * 40);
          return { ok: true, score: Math.max(60, Math.round(score)) };
        }
        return { ok: false };
      },
    },
    {
      id: 't2',
      title: '任务二 · 水平变幅验证',
      goal: '保持起升机构不动，把幅度从 30 m 变到 24 m，观察抓斗高度变化。',
      hint: '四连杆水平变幅的作用就是让变幅时吊点高度基本不变。只动变幅，别动起升。',
      point: '高度变化 < 0.6 m 满分，越大扣分',
      state: 'idle', score: 0, detail: '',
      init: function () { this.h0 = st().height; this.r0 = st().radius; this.armed = false; },
      check: function () {
        var s = st();
        /* 起点附近才"武装"，防止一上来就判定 */
        if (!this.armed && Math.abs(s.radius - 30) < 0.6) { this.h0 = s.height; this.armed = true; }
        this.live = '幅度 ' + s.radius.toFixed(2) + ' m ／ 高度变化 ' +
          Math.abs(s.height - this.h0).toFixed(3) + ' m';
        if (this.armed && Math.abs(s.radius - 24) < 0.35) {
          var dh = Math.abs(s.height - this.h0);
          var score = dh < 0.6 ? 100 : Math.max(40, Math.round(100 - (dh - 0.6) * 40));
          return { ok: true, score: score, detail: '高度变化 ' + dh.toFixed(2) + ' m' };
        }
        return { ok: false };
      },
    },
    {
      id: 't3',
      title: '任务三 · 抓斗抓取作业',
      goal: '下放抓斗入舱抓满一斗（填充率 ≥ 85%），再卸到卡车上。',
      hint: '抓取量取决于插入深度和开度：抓斗要插进沙面以下约 1 m，且完全张开后再闭合。',
      point: '按填充率给分，卸到车外不得分',
      state: 'idle', score: 0, detail: '',
      init: function () { this.maxLoad = 0; this.got = 0; },
      check: function () {
        var s = st();
        if (s.load > this.maxLoad) this.maxLoad = s.load;
        var truck = w.DEMO ? w.DEMO.truckLoad : 0;
        if (truck > this.got && this.maxLoad > 0.3) {
          this.got = truck;
          var score = Math.round(Math.min(1, this.maxLoad / 0.85) * 100);
          return { ok: true, score: score, detail: '本次填充率 ' + Math.round(this.maxLoad * 100) + '%' };
        }
        this.live = '本次最大填充 ' + Math.round(this.maxLoad * 100) + '% ／ 卡车已装 ' + truck + ' 斗';
        return { ok: false };
      },
    },
    {
      id: 't4',
      title: '任务四 · 轨迹规划',
      goal: '把抓斗从船舱（回转 −90°、幅度 30 m）转移到卡车上方（回转 0°、幅度 23 m），全程起升高度不得低于 12 m。',
      hint: '舱口围板高约 5.8 m。先起升到安全高度，再回转+变幅，到位后再下降——这是标准的三段式路径。',
      point: '全程合规且用时越短得分越高',
      state: 'idle', score: 0, detail: '',
      init: function () { this.minH = 99; this.t0 = Date.now(); this.started = false; },
      check: function () {
        var s = st();
        if (!this.started && Math.abs(U.deg(s.slew) + 90) < 8 && Math.abs(s.radius - 30) < 1.2) {
          this.started = true;
        }
        if (this.started && s.height < this.minH) this.minH = s.height;
        var arrived = Math.abs(U.deg(s.slew)) < 3 && Math.abs(s.radius - 23) < 0.6;
        this.live = '最低高度 ' + (this.minH === 99 ? '—' : this.minH.toFixed(1)) + ' m ／ ' +
          (arrived ? '已到达' : '未到位');
        if (arrived && this.started) {
          var t = (Date.now() - this.t0) / 1000;
          var ok = this.minH >= 12;
          var score = ok ? Math.max(50, Math.round(100 - Math.max(0, t - 25) * 1.5)) : 30;
          return {
            ok: true, score: score,
            detail: '最低高度 ' + this.minH.toFixed(1) + ' m，用时 ' + t.toFixed(0) + ' s' + (ok ? '' : '（低于安全高度）'),
          };
        }
        return { ok: false };
      },
    },
    {
      id: 't5',
      title: '任务五 · 脚本编程',
      goal: '用「脚本控制」编写一段指令，自动完成 抓取 → 回转 → 卸料 的完整循环。',
      hint: '参考：回转 -90 / 变幅 30 / 起升 1.2 / 抓斗 100 / 抓斗 0 / 起升 16 / 回转 0 / 变幅 23 / 起升 5 / 抓斗 100。',
      point: '脚本跑通即合格，用时越短、抓取越满得分越高',
      state: 'idle', score: 0, detail: '',
      init: function () { this.t0 = 0; this.load = 0; },
      onScript: function (info) {
        if (info.event === 'start') { this.t0 = Date.now(); this.load = 0; this.state = 'doing'; }
        if (info.event === 'done' && this.t0 && this.state === 'doing') {
          var t = (Date.now() - this.t0) / 1000;
          var lv = this.load || 0;
          var score = Math.round(Math.min(100, 40 + lv * 40 + (t < 60 ? 20 : 5)));
          this.t0 = 0;
          T.done({ ok: true, score: score, detail: '脚本用时 ' + t.toFixed(0) + ' s，最大填充 ' + Math.round(lv * 100) + '%' });
        }
      },
      check: function () { this.live = this.t0 ? '脚本执行中…' : '等待启动脚本'; return { ok: false }; },
    },
    {
      id: 't6',
      title: '任务六 · 结构认知',
      goal: '用鼠标依次悬停到塔架、人字架、大拉杆、平衡重四个部件，读完弹出的说明。',
      hint: '鼠标移到部件上会弹出名称与作用说明。这四个都在门机上部，回转或变幅时可以观察它们是否跟着动。',
      point: '四个全部识别得满分，缺一个扣 25 分',
      state: 'idle', score: 0, detail: '',
      init: function () { this.seen = {}; },
      check: function () {
        var need = ['塔架', '人字架', '大拉杆', '平衡重'];
        var seen = this.seen || {};
        var got = [];
        for (var i = 0; i < need.length; i++) if (seen[need[i]]) got.push(need[i]);
        this.live = '已识别 ' + got.length + ' / 4：' + (got.length ? got.join('、') : '—');
        if (got.length === need.length) {
          return { ok: true, score: 100, detail: '四个部件全部识别' };
        }
        return { ok: false };
      },
    },
    {
      id: 't7',
      title: '任务七 · 算法抑摆',
      goal: '用 Python 写控制程序，把抓斗摆动的峰值压到 0.03 rad（约 1.7°）以下，并稳定保持 2 秒以上。',
      hint: '参考「防摇摆」示例：读 swayZ / swayVZ 做 PD 反馈，把补偿量叠加到回转目标角上。KP、KD 要自己调。',
      point: '峰值 <0.02 rad 满分；<0.03 rad 得 85；<0.05 rad 得 70',
      state: 'idle', score: 0, detail: '',
      init: function () { this.lowT = 0; },
      check: function () {
        if (!w.PY || !w.PY.rec || w.PY.rec.length < 40) {
          this.live = (w.PY && w.PY.running) ? '采样中…' : '等待启动 Python 程序';
          return { ok: false };
        }
        var rec = w.PY.rec;
        var from = Math.max(0, rec.length - 120);      // 最近约 2 秒
        var pk = 0;
        for (var i = from; i < rec.length; i++) {
          var v = rec[i].swayMag;
          if (isFinite(v) && v > pk) pk = v;
        }
        this.live = '近 2 秒摆幅峰值 ' + (pk * 57.3).toFixed(2) + '°' +
          (w.PY.running ? '' : '（程序已停止）');

        if (pk < 0.05) {
          this.lowT += 0.15;
          if (pk < 0.03 && this.lowT > 2.4) {
            var sc = pk < 0.02 ? 100 : 85;
            return { ok: true, score: sc, detail: '峰值 ' + (pk * 57.3).toFixed(2) + '°' };
          }
          if (this.lowT > 6 && pk < 0.05) {
            return { ok: true, score: 70, detail: '峰值 ' + (pk * 57.3).toFixed(2) + '°（未达 0.03）' };
          }
        } else {
          this.lowT = 0;
        }
        return { ok: false };
      },
    },
  ];

  /* ---------------- 状态 ---------------- */
  T.start = function (idx) {
    T.active = idx;
    T.running = true;
    var t = T.tasks[idx];
    t.state = 'doing';
    t.detail = '';
    t.live = '';
    t.t0 = Date.now();
    if (t.init) t.init();
    T.push('开始 ' + t.title);
    T.emit();
  };

  T.done = function (r) {
    var t = T.tasks[T.active];
    if (!t || t.state === 'done') return;
    t.state = 'done';
    t.score = r.score || 0;
    t.detail = r.detail || '';
    T.push(t.title + ' 完成，得分 ' + t.score);
    T.emit();
  };

  T.reset = function () {
    T.tasks.forEach(function (t) {
      t.state = 'idle'; t.score = 0; t.detail = ''; t.live = '';
    });
    T.active = -1;
    T.running = false;
    T.log = [];
    T.startTime = 0;
    T.emit();
  };

  /* 由悬停提示调用：记录玩家识别到的部件（任务六用） */
  T.notePart = function (name) {
    var t = T.tasks[T.active];
    if (!t || t.id !== 't6' || t.state !== 'doing') return;
    t.seen = t.seen || {};
    if (!t.seen[name]) {
      t.seen[name] = 1;
      T.emit();
    }
  };

  T.push = function (msg) {
    T.log.push({
      t: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      msg: msg,
    });
    if (T.log.length > 60) T.log.shift();
  };

  T.emit = function () {
    if (typeof T.onUpdate === 'function') T.onUpdate(T);
  };

  /* ---------------- 每帧推进 ---------------- */
  var tick = dw(function () {
    if (!T.running || T.active < 0) return;
    var t = T.tasks[T.active];
    if (!t || t.state !== 'doing') return;
    var r = t.check.call(t);
    if (r && r.ok) T.done(r);
    else T.emit();
  }, 150);

  T.update = function () {
    /* 任务五：跟踪脚本执行期间的最大装料 */
    var t = T.tasks[T.active];
    if (t && t.id === 't5' && t.state === 'doing') {
      if (st().load > (t.load || 0)) t.load = st().load;
    }
    tick();
  };

  T.onScriptEvent = function (info) {
    var t = T.tasks[T.active];
    if (t && t.onScript && t.state !== 'done') t.onScript.call(t, info);
  };

  /* ---------------- 计分与报告 ---------------- */
  T.maxScore = function () { return T.tasks.length * 100; };

  T.total = function () {
    var s = 0, done = 0;
    T.tasks.forEach(function (t) {
      s += t.score || 0;
      if (t.state === 'done') done++;
    });
    return { sum: s, done: done, avg: done ? Math.round(s / T.tasks.length) : 0 };
  };

  T.report = function () {
    var lines = [];
    var d = new Date();
    lines.push('港口门座式起重机运动控制仿真实验 · 实训报告');
    lines.push('='.repeat(46));
    lines.push('姓名：' + (T.student.name || '____________') +
      '    学号：' + (T.student.no || '____________'));
    lines.push('日期：' + d.toLocaleString('zh-CN', { hour12: false }));
    lines.push('');
    lines.push('任务得分');
    lines.push('-'.repeat(46));
    T.tasks.forEach(function (t, i) {
      var stt = t.state === 'done' ? (t.score + ' 分') : (t.state === 'doing' ? '进行中' : '未完成');
      lines.push((i + 1) + '. ' + t.title.replace(/^任务.·\s*/, '') + '：' + stt +
        (t.detail ? '   （' + t.detail + '）' : ''));
    });
    var tot = T.total();
    lines.push('-'.repeat(46));
    lines.push('总分：' + tot.sum + ' / ' + T.maxScore() +
      '    完成：' + tot.done + '/' + T.tasks.length + ' 项');
    lines.push('');
    lines.push('操作记录');
    lines.push('-'.repeat(46));
    T.log.forEach(function (l) { lines.push('[' + l.t + '] ' + l.msg); });
    return lines.join('\n');
  };

  w.TRAIN = T;
})(window);
