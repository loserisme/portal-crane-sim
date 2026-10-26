/* =============================================================
 * comprehensive.js — 综合实验 · 全流程引导
 *
 * 从结构认知到系统控制优化的完整引导式实验，共 22 步、6 个阶段：
 *   A 结构认知(15%) → B 机构操作(20%) → C 抓斗作业(20%)
 *   → D 程序控制(15%) → E 算法优化(25%) → F 综合评估(5%)
 *
 * 每一步实时判定完成条件；条件满足后学生点击「下一步」进入下一
 * 步骤。最后按阶段权重汇总综合评分，支持文本报告与 Word 导出。
 * ============================================================= */
(function (w) {
  'use strict';

  var KT = w.KT, U = w.U;

  function st() { return KT.ST; }
  function deg(r) { return U.deg(r); }
  function sway() { var s = st(); return Math.hypot(s.thx || 0, s.thz || 0); }

  var STAGES = [
    { id: 'A', name: '阶段一 · 结构认知', weight: 15 },
    { id: 'B', name: '阶段二 · 机构操作', weight: 20 },
    { id: 'C', name: '阶段三 · 抓斗作业', weight: 20 },
    { id: 'D', name: '阶段四 · 程序控制', weight: 15 },
    { id: 'E', name: '阶段五 · 算法优化', weight: 25 },
    { id: 'F', name: '阶段六 · 综合评估', weight: 5 },
  ];

  /* ---------------- 22 个步骤定义 ---------------- */
  var STEPS = [
    /* ---- 阶段一 · 结构认知 ---- */
    {
      stage: 'A',
      title: '阅读实验导引',
      goal: '本综合实验将从「认识门机」开始，经历机构操作、抓斗作业、程序控制，最后完成算法抑摆优化，共 22 步。请先浏览平台界面：左侧机构操控、右上视角切换、下方实训与曲线面板。',
      hint: '了解即可，点击「下一步」开始。建议先在左侧面板用滑块随意动一动各机构，建立手感。',
      init: function () {},
      check: function () { return { ok: true, score: 100, metric: '已阅读导引' }; },
    },
    {
      stage: 'A',
      title: '识别上部结构（一）',
      goal: '依次把鼠标悬停到 塔架、人字架、大拉杆、平衡重 四个部件上，阅读弹出的说明。',
      hint: '四个部件都在回转平台上部。回转或变幅时观察：哪些部件跟着臂架动，哪些不动。',
      init: function () { this.seen = {}; },
      check: function () {
        var need = ['塔架', '人字架', '大拉杆', '平衡重'];
        var got = [];
        for (var i = 0; i < need.length; i++) if ((this.seen || {})[need[i]]) got.push(need[i]);
        this.live = '已识别 ' + got.length + ' / 4：' + (got.length ? got.join('、') : '—');
        if (got.length === need.length) return { ok: true, score: 100, metric: '上部结构 4 项全部识别' };
        return { ok: false };
      },
    },
    {
      stage: 'A',
      title: '识别驱动与操作设施（二）',
      goal: '依次悬停识别 行走台车、回转支承与转台、齿条变幅机构、司机室。',
      hint: '行走台车在门架底部（视角可以放低），齿条变幅机构在臂架根部，司机室挂在转台前部。',
      init: function () { this.seen = {}; },
      check: function () {
        var need = ['行走台车', '回转支承与转台', '齿条变幅机构', '司机室'];
        var got = [];
        for (var i = 0; i < need.length; i++) if ((this.seen || {})[need[i]]) got.push(need[i]);
        this.live = '已识别 ' + got.length + ' / 4：' + (got.length ? got.join('、') : '—');
        if (got.length === need.length) return { ok: true, score: 100, metric: '驱动设施 4 项全部识别' };
        return { ok: false };
      },
    },
    {
      stage: 'A',
      title: '观察四连杆联动',
      goal: '把幅度从 28 m 以上变到 24 m 以下，观察主臂、象鼻梁、大拉杆如何联动，以及抓斗高度是否基本不变。',
      hint: '变幅滑块往左拖。注意抓斗高度——这就是四连杆水平变幅特性，后面阶段会定量验证它。',
      init: function () { this.armed = false; this.h0 = 0; this.maxR = 0; },
      check: function () {
        var s = st();
        if (s.radius > this.maxR) this.maxR = s.radius;
        if (!this.armed && this.maxR >= 28) { this.h0 = s.height; this.armed = true; }
        this.live = this.armed
          ? '已记录起点高度 ' + this.h0.toFixed(2) + ' m，当前幅度 ' + s.radius.toFixed(2) + ' m'
          : '先把幅度开到 28 m 以上（当前 ' + s.radius.toFixed(1) + ' m）';
        if (this.armed && s.radius <= 24) {
          var dh = Math.abs(s.height - this.h0);
          var sc = dh < 0.6 ? 100 : Math.max(60, Math.round(100 - (dh - 0.6) * 40));
          return { ok: true, score: sc, metric: '变幅 28→24 m 高度变化 ' + dh.toFixed(2) + ' m' };
        }
        return { ok: false };
      },
    },

    /* ---- 阶段二 · 机构操作 ---- */
    {
      stage: 'B',
      title: '大车行走练习',
      goal: '沿轨道行走整机，累计移动 2.5 m 以上，再走回 0 m 附近。',
      hint: '大车行走改变整机沿码头方向的位置，用于对准舱口。注意移动时抓斗会跟着整体平移。',
      init: function () { this.tr0 = st().travel; this.maxD = 0; },
      check: function () {
        var d = Math.abs(st().travel - this.tr0);
        if (d > this.maxD) this.maxD = d;
        this.live = '累计行走 ' + this.maxD.toFixed(2) + ' m（需 ≥ 2.5 m）';
        if (this.maxD >= 2.5) return { ok: true, score: 100, metric: '行走练习 ' + this.maxD.toFixed(1) + ' m' };
        return { ok: false };
      },
    },
    {
      stage: 'B',
      title: '回转对位',
      goal: '把回转角对到 −90°（误差 ±2° 以内）。',
      hint: '−90° 是船舱方向。回转速度较快，接近目标时提前松手或用小步进调整。',
      init: function () {},
      check: function () {
        var e = Math.abs(deg(st().slew) + 90);
        this.live = '回转角 ' + deg(st().slew).toFixed(1) + '° ／ 误差 ' + e.toFixed(2) + '°';
        if (e < 2) return { ok: true, score: Math.max(70, Math.round(100 - e * 10)), metric: '回转误差 ' + e.toFixed(2) + '°' };
        return { ok: false };
      },
    },
    {
      stage: 'B',
      title: '变幅对位',
      goal: '把工作幅度对到 30.0 m（误差 ±0.3 m 以内）。',
      hint: '幅度是抓斗到回转中心的水平距离，看右侧「工作幅度」读数。',
      init: function () {},
      check: function () {
        var e = Math.abs(st().radius - 30);
        this.live = '幅度 ' + st().radius.toFixed(2) + ' m ／ 误差 ' + e.toFixed(2) + ' m';
        if (e < 0.3) return { ok: true, score: Math.max(70, Math.round(100 - e * 60)), metric: '幅度误差 ' + e.toFixed(2) + ' m' };
        return { ok: false };
      },
    },
    {
      stage: 'B',
      title: '三点定位（船舱上方）',
      goal: '同时满足：回转 −90°±2°、幅度 30±0.3 m、起升高度 5±0.3 m —— 完成船舱上方作业点定位。',
      hint: '上一、二步的机构不要动，只把起升调到 5 m。三个条件必须同时成立。',
      init: function () {},
      check: function () {
        var s = st();
        var e1 = Math.abs(deg(s.slew) + 90), e2 = Math.abs(s.radius - 30), e3 = Math.abs(s.height - 5);
        this.live = '回转误差 ' + e1.toFixed(1) + '° ／ 幅度误差 ' + e2.toFixed(2) + ' m ／ 高度误差 ' + e3.toFixed(2) + ' m';
        if (e1 < 2 && e2 < 0.3 && e3 < 0.3) {
          var sc = Math.max(60, Math.round(100 - e1 * 6 - e2 * 40 - e3 * 40));
          return { ok: true, score: sc, metric: '三点定位综合误差 e=' + (e1 + e2 * 20 + e3 * 20).toFixed(1) };
        }
        return { ok: false };
      },
    },
    {
      stage: 'B',
      title: '水平变幅特性验证',
      goal: '保持起升不动，把幅度从 30 m 附近变到 24 m 附近，验证抓斗高度变化小于 0.6 m。',
      hint: '这是本平台的核芯机构特性：四连杆补偿让吊点在变幅全程近似走水平线。',
      init: function () { this.armed = false; this.h0 = 0; },
      check: function () {
        var s = st();
        if (!this.armed && Math.abs(s.radius - 30) < 0.6) { this.h0 = s.height; this.armed = true; }
        this.live = this.armed
          ? '当前幅度 ' + s.radius.toFixed(2) + ' m ／ 高度变化 ' + Math.abs(s.height - this.h0).toFixed(3) + ' m'
          : '先把幅度调回 30 m 附近';
        if (this.armed && Math.abs(s.radius - 24) < 0.35) {
          var dh = Math.abs(s.height - this.h0);
          var sc = dh < 0.6 ? 100 : Math.max(40, Math.round(100 - (dh - 0.6) * 40));
          return { ok: true, score: sc, metric: '变幅 30→24 m 高度变化 ' + dh.toFixed(2) + ' m' };
        }
        return { ok: false };
      },
    },

    /* ---- 阶段三 · 抓斗作业 ---- */
    {
      stage: 'C',
      title: '抓斗开合练习',
      goal: '完成一次完整的「张开 → 闭合」循环：先把抓斗开到 90% 以上，再闭到 15% 以下。',
      hint: '抓斗开合滑块从右拖到左再拖回来。闭合动作就是"抓料"动作。',
      init: function () { this.ph = 0; this.openMax = 0; },
      check: function () {
        var g = st().grabOpen;
        if (this.ph === 0 && g < 0.15) this.ph = 1;
        if (this.ph === 1) { if (g > this.openMax) this.openMax = g; if (g >= 0.9) this.ph = 2; }
        this.live = this.ph === 0 ? '先把抓斗完全闭合（当前开度 ' + Math.round(g * 100) + '%）'
          : this.ph === 1 ? '张开抓斗到 90% 以上（最大 ' + Math.round(this.openMax * 100) + '%）'
          : '再闭合到 15% 以下（当前 ' + Math.round(g * 100) + '%）';
        if (this.ph === 2 && g <= 0.15)
          return { ok: true, score: 100, metric: '开合循环完成，最大开度 ' + Math.round(this.openMax * 100) + '%' };
        return { ok: false };
      },
    },
    {
      stage: 'C',
      title: '抓取作业',
      goal: '把抓斗插入舱内料堆抓取一斗，填充率达到 70% 以上。',
      hint: '先把抓斗下放到料面以下约 1 m、完全张开，再闭合——插入越深、开度越大，抓得越满。',
      init: function () { this.maxLoad = 0; },
      check: function () {
        var l = st().load;
        if (l > this.maxLoad) this.maxLoad = l;
        this.live = '本步最大填充率 ' + Math.round(this.maxLoad * 100) + '%（需 ≥ 70%）';
        if (this.maxLoad >= 0.7) {
          return { ok: true, score: Math.round(Math.min(1, this.maxLoad / 0.85) * 100),
            metric: '填充率 ' + Math.round(this.maxLoad * 100) + '%' };
        }
        return { ok: false };
      },
    },
    {
      stage: 'C',
      title: '卸料入车',
      goal: '把抓到的物料运转到卡车上方（回转 0°、幅度约 23 m）卸入车斗。',
      hint: '回转回 0° 附近、幅度 23 m 左右，下降到 5 m 以下后张开抓斗即可卸料。',
      init: function () { this.t0 = (w.DEMO ? w.DEMO.truckLoad : 0); this.maxLoad = 0; },
      check: function () {
        var truck = w.DEMO ? w.DEMO.truckLoad : 0;
        if (st().load > this.maxLoad) this.maxLoad = st().load;
        this.live = '卡车已装 ' + truck + ' 斗（本步需 +1）';
        if (truck > this.t0 && this.maxLoad > 0.3)
          return { ok: true, score: 100, metric: '卸料入车 1 斗' };
        return { ok: false };
      },
    },
    {
      stage: 'C',
      title: '连续作业（3 斗）',
      goal: '继续完成装卸循环，让卡车累计再装 3 斗，体会作业节拍。',
      hint: '可以手动操作，也可以切到「脚本控制」用程序跑。抓取 → 起升 → 回转 → 卸料，注意路径安全。',
      init: function () { this.t0 = (w.DEMO ? w.DEMO.truckLoad : 0); this.t0s = Date.now(); },
      check: function () {
        var truck = w.DEMO ? w.DEMO.truckLoad : 0;
        var n = truck - this.t0;
        this.live = '本步已卸 ' + n + ' / 3 斗' + (n >= 1 ? '，用时 ' + ((Date.now() - this.t0s) / 1000).toFixed(0) + ' s' : '');
        if (n >= 3) {
          var t = (Date.now() - this.t0s) / 1000;
          var sc = t < 180 ? 100 : Math.max(60, Math.round(100 - (t - 180) / 6));
          return { ok: true, score: sc, metric: '3 斗用时 ' + t.toFixed(0) + ' s' };
        }
        return { ok: false };
      },
    },

    /* ---- 阶段四 · 程序控制 ---- */
    {
      stage: 'D',
      title: '脚本控制入门',
      goal: '打开「脚本控制」面板，直接运行内置示例脚本，观察门机按指令序列自动作业。',
      hint: '脚本按行执行：回转/变幅/起升/抓斗 指令 + 目标值。运行前确认抓斗在舱内上方。',
      init: function () { this.doneN = 0; },
      onScript: function (info) { if (info.event === 'done') this.doneN = (this.doneN || 0) + 1; },
      check: function () {
        this.live = '脚本完成次数 ' + (this.doneN || 0) + ' / 1';
        if ((this.doneN || 0) >= 1) return { ok: true, score: 100, metric: '脚本运行成功 1 次' };
        return { ok: false };
      },
    },
    {
      stage: 'D',
      title: '修改脚本参数',
      goal: '把脚本里的幅度目标改成 26 m（或其他与示例不同的值），再次运行成功。',
      hint: '体会"改参数→看行为变化"——这就是程序化控制的基本工作方式。改完点运行即可。',
      init: function () { this.doneN = 0; },
      onScript: function (info) { if (info.event === 'done') this.doneN = (this.doneN || 0) + 1; },
      check: function () {
        this.live = '本步脚本完成次数 ' + (this.doneN || 0) + ' / 1';
        if ((this.doneN || 0) >= 1) return { ok: true, score: 100, metric: '参数化脚本运行成功' };
        return { ok: false };
      },
    },
    {
      stage: 'D',
      title: 'Python 实时控制',
      goal: '打开「Python 控制」面板，运行防摆示例程序（control(dt) 每帧被调用），累计运行 3 秒以上。',
      hint: 'Python 程序运行在浏览器里的 Pyodide 环境，通过 crane.slew() 等接口实时控制门机、读取摆角。',
      init: function () { this.t = 0; },
      check: function () {
        var py = w.PY;
        if (py && py.running) this.t += 0.15;
        this.live = 'Python 运行累计 ' + this.t.toFixed(1) + ' / 3.0 s' + (py && py.running ? '' : '（未运行）');
        if (this.t >= 3) return { ok: true, score: 100, metric: 'Python 实时控制运行 ' + this.t.toFixed(0) + ' s' };
        return { ok: false };
      },
    },
    {
      stage: 'D',
      title: '观测控制曲线',
      goal: '打开控制曲线面板，勾选查看至少一组数据通道（摆角、幅度、回转角等）。',
      hint: '曲线是评价控制品质的工具——下一阶段就要用它对比"开算法前"和"开算法后"的摆动。',
      init: function () {},
      check: function () {
        this.live = this.chartSeen ? '已打开控制曲线 ✓' : '尚未打开曲线面板';
        if (this.chartSeen) return { ok: true, score: 100, metric: '控制曲线观测完成' };
        return { ok: false };
      },
    },

    /* ---- 阶段五 · 算法优化 ---- */
    {
      stage: 'E',
      title: '基线摆动测试（无算法）',
      goal: '关闭 Python 程序，做一次大幅回转（变化 25° 以上），记录摆动峰值作为基线。',
      hint: '这就是"没有抑摆算法"时的自然表现。记住这个数字，稍后与算法结果对比。',
      init: function () { this.slew0 = deg(st().slew); this.maxSw = 0; this.maxD = 0; },
      check: function () {
        var d = Math.abs(deg(st().slew) - this.slew0);
        if (d > this.maxD) this.maxD = d;
        var sw = sway();
        if (sw > this.maxSw) this.maxSw = sw;
        this.live = '回转变化 ' + this.maxD.toFixed(1) + ' / 25° ／ 摆动峰值 ' + (this.maxSw * 57.3).toFixed(2) + '°';
        if (this.maxD >= 25) {
          COMP.basePeak = this.maxSw;
          return { ok: true, score: 100, metric: '基线摆动峰值 ' + (this.maxSw * 57.3).toFixed(2) + '°' };
        }
        return { ok: false };
      },
    },
    {
      stage: 'E',
      title: '启用抑摆算法',
      goal: '运行 Python 防摆程序（PD 反馈），让摆动峰值降到 0.05 rad（约 2.9°）以内。',
      hint: '防摆示例在 Python 面板的「防摇摆」按钮里。KP、KD 直接决定了抑制的快慢与稳定性。',
      init: function () { this.lowT = 0; },
      check: function () {
        var py = w.PY;
        if (!py || !py.rec || py.rec.length < 40) {
          this.live = (py && py.running) ? '采样中…' : '等待运行 Python 防摆程序';
          return { ok: false };
        }
        var rec = py.rec, pk = 0;
        for (var i = Math.max(0, rec.length - 120); i < rec.length; i++) {
          var v = rec[i].swayMag;
          if (isFinite(v) && v > pk) pk = v;
        }
        this.live = '近 2 s 摆动峰值 ' + (pk * 57.3).toFixed(2) + '°（需 < 2.9°）';
        if (pk < 0.05) {
          this.lowT += 0.15;
          if (this.lowT > 1.5) {
            return { ok: true, score: 90, metric: '算法投入，峰值 ' + (pk * 57.3).toFixed(2) + '°' };
          }
        } else this.lowT = 0;
        return { ok: false };
      },
    },
    {
      stage: 'E',
      title: '参数调优',
      goal: '调整 KP / KD（或改善操作策略），把峰值进一步压到 0.03 rad（约 1.7°）以内并保持 2 秒。',
      hint: 'KP 太大容易振荡，KD 太小抑制慢。调参 → 运行 → 看曲线，反复迭代。',
      init: function () { this.lowT = 0; this.best = 9; },
      check: function () {
        var py = w.PY;
        if (!py || !py.rec || py.rec.length < 40) {
          this.live = '等待 Python 程序采样…';
          return { ok: false };
        }
        var rec = py.rec, pk = 0;
        for (var i = Math.max(0, rec.length - 120); i < rec.length; i++) {
          var v = rec[i].swayMag;
          if (isFinite(v) && v > pk) pk = v;
        }
        if (pk < this.best) this.best = pk;
        this.live = '峰值 ' + (pk * 57.3).toFixed(2) + '°（需 < 1.7° 保持 2 s）／ 历史最优 ' + (this.best * 57.3).toFixed(2) + '°';
        if (pk < 0.05) {
          this.lowT += 0.15;
          if (pk < 0.03 && this.lowT > 2.4) {
            COMP.tunedPeak = Math.min(COMP.tunedPeak || 9, pk);
            return { ok: true, score: pk < 0.02 ? 100 : 85, metric: '调优后峰值 ' + (pk * 57.3).toFixed(2) + '°' };
          }
        } else this.lowT = 0;
        return { ok: false };
      },
    },
    {
      stage: 'E',
      title: '算法效果对比',
      goal: '对比基线峰值与调优后峰值，得出抑摆算法的改善幅度。',
      hint: '改善幅度 = (基线 − 调优) / 基线。想一想：为什么回转运动会引起抓斗摆动？PD 两项各起什么作用？',
      init: function () {},
      check: function () {
        var b = COMP.basePeak, t = COMP.tunedPeak;
        if (!b || !t || t >= b) {
          this.live = !b ? '缺少基线数据（第 18 步）' : (!t ? '缺少调优数据（第 20 步）' : '调优峰值未低于基线');
          return { ok: false };
        }
        var imp = (b - t) / b * 100;
        COMP.improve = imp;
        this.live = '基线 ' + (b * 57.3).toFixed(2) + '° → 调优 ' + (t * 57.3).toFixed(2) + '°，改善 ' + imp.toFixed(0) + '%';
        return { ok: true, score: imp > 40 ? 100 : Math.max(70, Math.round(imp * 2)), metric: '摆动改善 ' + imp.toFixed(0) + '%' };
      },
    },

    /* ---- 阶段六 · 综合评估 ---- */
    {
      stage: 'F',
      title: '综合评分与实验报告',
      goal: '全部步骤完成！查看综合评分，填写姓名学号后生成报告文本或导出 Word 文档。',
      hint: '报告中包含各阶段得分、每步量化数据与操作记录。建议结合数据完成"实验分析"部分。',
      init: function () {},
      check: function () { return { ok: true, score: 100, metric: '实验流程完成' }; },
    },
  ];

  /* ---------------- 状态机 ---------------- */
  var COMP = {
    stages: STAGES,
    steps: STEPS,
    CP: null,
    basePeak: 0,
    tunedPeak: 0,
    improve: 0,
    onUpdate: null,
  };

  COMP.fresh = function () {
    return {
      started: false, step: 0, passed: false, finished: false,
      scores: [],          // 每步 {score, metric}
      live: '',
    };
  };
  COMP.CP = COMP.fresh();

  COMP.start = function () {
    COMP.CP = COMP.fresh();
    COMP.basePeak = 0; COMP.tunedPeak = 0; COMP.improve = 0;
    COMP.beginStep(0);
    COMP.CP.started = true;
    COMP.push('开始综合实验（22 步）');
    COMP.emit();
  };

  COMP.beginStep = function (i) {
    var cp = COMP.CP;
    cp.step = i;
    cp.passed = false;
    cp.live = '';
    var s = STEPS[i];
    if (s.init) s.init.call(s);
    COMP.push('进入第 ' + (i + 1) + ' 步：' + s.title);
  };

  COMP.next = function () {
    var cp = COMP.CP;
    if (!cp.started || cp.finished || !cp.passed) return;
    var s = STEPS[cp.step];
    cp.scores[cp.step] = { score: s._score || 100, metric: s._metric || '' };
    COMP.push('第 ' + (cp.step + 1) + ' 步完成：' + s.title + '（' + (s._score || 100) + ' 分）');
    if (cp.step >= STEPS.length - 1) {
      cp.finished = true;
      COMP.push('综合实验全部完成');
    } else {
      COMP.beginStep(cp.step + 1);
    }
    COMP.emit();
  };

  COMP.reset = function () {
    COMP.CP = COMP.fresh();
    COMP.basePeak = 0; COMP.tunedPeak = 0; COMP.improve = 0;
    COMP.emit();
  };

  COMP.notePart = function (name) {
    var cp = COMP.CP;
    if (!cp.started || cp.finished) return;
    [1, 2].forEach(function (i) {
      if (cp.step !== i || cp.passed) return;
      var s = STEPS[i];
      s.seen = s.seen || {};
      if (!s.seen[name]) { s.seen[name] = 1; COMP.emit(); }
    });
  };

  COMP.noteChart = function () {
    var cp = COMP.CP;
    if (cp.started && !cp.finished && cp.step === 16) STEPS[16].chartSeen = true;
  };

  COMP.onScriptEvent = function (info) {
    var cp = COMP.CP;
    if (!cp.started || cp.finished) return;
    var s = STEPS[cp.step];
    if (s && s.onScript && !cp.passed) s.onScript.call(s, info);
  };

  /* 每帧判定（节流 150ms） */
  var lastT = 0;
  COMP.update = function () {
    var cp = COMP.CP;
    if (!cp.started || cp.finished) return;
    var now = Date.now();
    if (now - lastT < 150) return;
    lastT = now;
    var s = STEPS[cp.step];
    var r = s.check.call(s);
    cp.live = s.live || '';
    if (r && r.ok && !cp.passed) {
      cp.passed = true;
      s._score = r.score === undefined ? 100 : Math.round(r.score);
      s._metric = r.metric || '';
      COMP.push('第 ' + (cp.step + 1) + ' 步条件达成（' + s._score + ' 分），请点击下一步');
      COMP.emit();
    } else if (r && r.ok) {
      /* 已达成时允许继续刷新更优分数 */
      var sc = r.score === undefined ? 100 : Math.round(r.score);
      if (sc > (s._score || 0)) { s._score = sc; s._metric = r.metric || s._metric; }
      COMP.emit();
    } else {
      COMP.emit();
    }
  };

  COMP.push = function (msg) {
    var cp = COMP.CP;
    cp.log = cp.log || [];
    cp.log.push({ t: new Date().toLocaleTimeString('zh-CN', { hour12: false }), msg: msg });
    if (cp.log.length > 80) cp.log.shift();
  };

  COMP.emit = function () {
    if (typeof COMP.onUpdate === 'function') COMP.onUpdate(COMP);
  };

  /* ---------------- 评分 ---------------- */
  /* 每步得分：passed 且有 _score 用 _score；未 pass 为 0 */
  COMP.stepScore = function (i) {
    var s = STEPS[i];
    var rec = COMP.CP.scores[i];
    if (rec) return rec.score;
    if (COMP.CP.step === i && COMP.CP.passed) return s._score || 100;
    return 0;
  };

  COMP.stageAvg = function (sid) {
    var sum = 0, n = 0;
    STEPS.forEach(function (s, i) {
      if (s.stage === sid) { sum += COMP.stepScore(i); n++; }
    });
    return n ? sum / n : 0;
  };

  COMP.total = function () {
    var percent = 0, stageScores = [];
    STAGES.forEach(function (g) {
      var avg = COMP.stageAvg(g.id);
      stageScores.push({ name: g.name, weight: g.weight, avg: Math.round(avg) });
      percent += g.weight * avg / 100;
    });
    var passedN = 0;
    STEPS.forEach(function (s, i) { if (COMP.stepScore(i) > 0) passedN++; });
    return {
      percent: Math.round(percent),
      stages: stageScores,
      done: passedN,
      total: STEPS.length,
      grade: percent >= 90 ? '优秀' : percent >= 80 ? '良好' : percent >= 70 ? '中等' : percent >= 60 ? '及格' : '待提高',
    };
  };

  /* ---------------- 文本报告 ---------------- */
  COMP.report = function () {
    var L = [];
    var d = new Date();
    var stu = (w.TRAIN && w.TRAIN.student) || {};
    var tot = COMP.total();
    L.push('港口门座式起重机运动控制仿真实验 · 综合实验报告');
    L.push('='.repeat(50));
    L.push('姓名：' + (stu.name || '____________') + '    学号：' + (stu.no || '____________'));
    L.push('日期：' + d.toLocaleString('zh-CN', { hour12: false }));
    L.push('');
    L.push('一、综合评分：' + tot.percent + ' / 100（' + tot.grade + '）   完成 ' + tot.done + '/' + tot.total + ' 步');
    L.push('');
    L.push('二、阶段得分');
    L.push('-'.repeat(50));
    tot.stages.forEach(function (g) {
      L.push(g.name + '（权重 ' + g.weight + '%）：阶段均分 ' + g.avg);
    });
    L.push('');
    L.push('三、步骤明细');
    L.push('-'.repeat(50));
    var sid = '';
    STEPS.forEach(function (s, i) {
      if (s.stage !== sid) {
        sid = s.stage;
        var g = STAGES.filter(function (x) { return x.id === sid; })[0];
        L.push('【' + g.name + '】');
      }
      var sc = COMP.stepScore(i);
      L.push('  ' + (i + 1) + '. ' + s.title + '：' + (sc > 0 ? sc + ' 分' : '未完成') +
        (s._metric && sc > 0 ? '（' + s._metric + '）' : ''));
    });
    L.push('');
    L.push('四、关键数据');
    L.push('-'.repeat(50));
    L.push('基线摆动峰值：' + (COMP.basePeak ? (COMP.basePeak * 57.3).toFixed(2) + '°' : '—'));
    L.push('调优后峰值：' + (COMP.tunedPeak ? (COMP.tunedPeak * 57.3).toFixed(2) + '°' : '—'));
    L.push('抑摆改善幅度：' + (COMP.improve ? COMP.improve.toFixed(0) + '%' : '—'));
    L.push('');
    L.push('五、操作记录');
    L.push('-'.repeat(50));
    (COMP.CP.log || []).forEach(function (l) { L.push('[' + l.t + '] ' + l.msg); });
    return L.join('\n');
  };

  w.COMP = COMP;
})(window);
