/* =============================================================
 * ui.js — 控制面板绑定、数据面板、特性曲线、三维标注
 * ============================================================= */
(function (w) {
  'use strict';

  var C = w.CFG, KT = w.KT, SCENE = w.SCENE, U = w.U;
  var UI = {};

  var el = {};
  var tags = [];
  var dpr = Math.min(w.devicePixelRatio || 1, 2);
  var chartAcc = 0;

  var TAG_DEF = [
    { k: 'gantry', t: '门架' },
    { k: 'slew', t: '回转中心' },
    { k: 'apex', t: '人字架' },
    { k: 'boom', t: '主臂' },
    { k: 'jib', t: '象鼻梁' },
    { k: 'hook', t: '抓斗' },
  ];

  UI.init = function () {
    el = {
      slew: document.getElementById('slew'),
      radius: document.getElementById('radius'),
      hoist: document.getElementById('hoist'),
      grab: document.getElementById('grab'),
      travel: document.getElementById('travel'),
      slewV: document.getElementById('slew-v'),
      radiusV: document.getElementById('radius-v'),
      hoistV: document.getElementById('hoist-v'),
      grabV: document.getElementById('grab-v'),
      travelV: document.getElementById('travel-v'),
      oRadius: document.getElementById('o-radius'),
      oHeight: document.getElementById('o-height'),
      oSlew: document.getElementById('o-slew'),
      oAlpha: document.getElementById('o-alpha'),
      oGrab: document.getElementById('o-grab'),
      oRope: document.getElementById('o-rope'),
      oSpeed: document.getElementById('o-speed'),
      oSway: document.getElementById('o-sway'),
      oPos: document.getElementById('o-pos'),
      oTravel: document.getElementById('o-travel'),
      oLoad: document.getElementById('o-load'),
      oHold: document.getElementById('o-hold'),
      oTruck: document.getElementById('o-truck'),
      oLoadState: document.getElementById('o-loadstate'),
      oCap: document.getElementById('o-cap'),
      chart: document.getElementById('chart'),
      stMode: document.getElementById('st-mode'),
      stFps: document.getElementById('st-fps'),
      stDot: document.getElementById('st-dot'),
      demo: document.getElementById('btn-demo'),
      reset: document.getElementById('btn-reset'),
      tags: document.getElementById('tags'),
    };

    bindSliders();
    bindSegs();
    bindChips();
    bindViews();
    bindScript();
    bindPython();
    bindTrain();
    bindChart();
    buildTags();
    applyFloating();
    resizeChart();
    w.addEventListener('resize', resizeChart);

    el.demo.addEventListener('click', function () {
      if (w.DEMO) w.DEMO.toggle();
    });
    el.reset.addEventListener('click', function () {
      if (w.DEMO) {
        w.DEMO.stop();
        w.DEMO.truckLoad = 0;
      }
      KT.reset();
      KT.set('slew', -90);
      KT.setRadius(30);
      if (w.CRANE) w.CRANE.resetTrace();
      syncSliders();
    });

    syncSliders();
  };

  /* ---------------- 控件 ---------------- */
  function bindSliders() {
    el.slew.addEventListener('input', function () {
      if (w.DEMO && w.DEMO.running) w.DEMO.stop();
      KT.set('slew', parseFloat(this.value));
      el.slewV.textContent = (+this.value).toFixed(1) + '°';
    });
    el.radius.addEventListener('input', function () {
      if (w.DEMO && w.DEMO.running) w.DEMO.stop();
      KT.setRadius(parseFloat(this.value));
      el.radiusV.textContent = (+this.value).toFixed(1) + ' m';
    });
    el.hoist.addEventListener('input', function () {
      if (w.DEMO && w.DEMO.running) w.DEMO.stop();
      KT.set('hoist', parseFloat(this.value));
      el.hoistV.textContent = (+this.value).toFixed(1) + ' m';
    });
    el.grab.addEventListener('input', function () {
      if (w.DEMO && w.DEMO.running) w.DEMO.stop();
      KT.set('grab', parseFloat(this.value) / 100);
      el.grabV.textContent = (+this.value).toFixed(0) + '%';
    });
    el.travel.addEventListener('input', function () {
      if (w.DEMO && w.DEMO.running) w.DEMO.stop();
      KT.set('travel', parseFloat(this.value));
      el.travelV.textContent = (+this.value).toFixed(1) + ' m';
    });
  }

  function bindSegs() {
    var spd = document.getElementById('seg-speed');
    if (spd) {
      spd.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        [].forEach.call(spd.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        KT.setTimeScale(parseFloat(b.dataset.v));
      });
    }

    var qual = document.getElementById('seg-quality');
    if (qual) {
      qual.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        [].forEach.call(qual.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        SCENE.setQuality(b.dataset.v);
        SCENE.qualityManual = true;
      });
    }

    var sway = document.getElementById('seg-sway');
    sway.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      [].forEach.call(sway.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      KT.ST.swayOn = b.dataset.v === 'on';
    });
  }

  function bindChips() {
    var box = document.getElementById('chips');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      b.classList.toggle('on');
      var on = b.classList.contains('on');
      var k = b.dataset.k;
      if (k === 'grid') { SCENE.setGrid(on); KT.ST.showGrid = on; }
      if (k === 'tags') { KT.ST.showTags = on; }
      if (k === 'radius') { KT.ST.showRadius = on; }
      if (k === 'trace') {
        KT.ST.showTrace = on;
        if (w.CRANE) w.CRANE.resetTrace();
      }
    });
  }

  /* ---------------- 浮动面板：拖动 + 最小化 ---------------- */
  var _zTop = 40;

  UI.makeFloating = function (panel, head) {
    if (!panel || !head || head.dataset.floatReady) return;
    head.dataset.floatReady = '1';
    head.classList.add('panel-head-drag');

    /* 最小化按钮 */
    var btn = document.createElement('button');
    btn.className = 'iconbtn minbtn';
    btn.textContent = '−';
    btn.title = '最小化 / 展开';
    head.appendChild(btn);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.toggle('collapsed');
      btn.textContent = panel.classList.contains('collapsed') ? '+' : '−';
    });

    /* 拖动 */
    var dragging = false, sx = 0, sy = 0, sl = 0, stp = 0;
    head.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      var r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px';
      panel.style.top = r.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
      panel.style.zIndex = ++_zTop;
      dragging = true;
      sx = e.clientX; sy = e.clientY; sl = r.left; stp = r.top;
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var w = panel.offsetWidth, h = panel.offsetHeight;
      var nx = sl + e.clientX - sx;
      var ny = stp + e.clientY - sy;
      nx = Math.max(-w + 90, Math.min(window.innerWidth - 90, nx));
      ny = Math.max(0, Math.min(window.innerHeight - 42, ny));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
    });

    window.addEventListener('mouseup', function () { dragging = false; });

    /* 点击面板时置顶 */
    panel.addEventListener('mousedown', function () {
      panel.style.zIndex = ++_zTop;
    }, true);
  };

  function applyFloating() {
    var pairs = [
      ['code-panel', '.code-head'],
      ['py-panel', '.code-head'],
      ['ai-panel', '.ai-head'],
      ['chart-panel', '.chart-head'],
    ];
    pairs.forEach(function (p) {
      var panel = document.getElementById(p[0]);
      if (!panel) return;
      UI.makeFloating(panel, panel.querySelector(p[1]));
    });
  }

  function bindChart() {
    var btn = document.getElementById('chart-close');
    if (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('chart-panel').classList.add('hidden');
      });
    }
    var aiBtn = document.getElementById('chart-ai');
    if (aiBtn) aiBtn.addEventListener('click', function () {
      if (w.STATS) w.STATS.track('ai_eval');
      UI.evalChart();
    });
  }

  /* ---- 性能指标计算 ---- */
  function analyzeSeg(rows) {
    var n = rows.length;
    if (n < 8) return null;
    var out = {};

    /* 摆动：峰值、衰减到 10% 的时间、稳态残余、过零次数 */
    var sw = [], sz = [], ts = [];
    for (var i = 0; i < n; i++) {
      sw.push(isFinite(rows[i].swayMag) ? rows[i].swayMag : 0);
      sz.push(isFinite(rows[i].swayZ) ? rows[i].swayZ : 0);
      ts.push(rows[i].t);
    }
    var pk = -Infinity, pkIdx = 0;
    for (var a = 0; a < n; a++) if (sw[a] > pk) { pk = sw[a]; pkIdx = a; }

    /* 衰减时间：按振荡峰值包络判断（直接看瞬时值会被过零点误判） */
    var decayT = null;
    if (pk > 1e-6) {
      var peaks = [];
      for (var pp = 1; pp < n - 1; pp++) {
        if (sw[pp] > sw[pp - 1] && sw[pp] >= sw[pp + 1]) peaks.push({ i: pp, v: sw[pp] });
      }
      if (peaks.length >= 2) {
        /* 从最大峰所在位置开始，找第一个跌到 10% 以下的后续峰 */
        var refIdx = 0;
        for (var pq = 0; pq < peaks.length; pq++) if (peaks[pq].v >= pk * 0.999) { refIdx = pq; break; }
        for (var pr = refIdx + 1; pr < peaks.length; pr++) {
          if (peaks[pr].v < pk * 0.10) {
            decayT = ts[peaks[pr].i] - ts[peaks[refIdx].i];
            break;
          }
        }
      } else {
        for (var b = pkIdx; b < n; b++) {
          if (sw[b] < pk * 0.10) { decayT = ts[b] - ts[pkIdx]; break; }
        }
      }
    }
    /* 稳态残余：最后 20% 的 RMS */
    var tailN = Math.max(3, Math.floor(n * 0.2));
    var acc = 0, cnt = 0;
    for (var c = n - tailN; c < n; c++) { acc += sw[c] * sw[c]; cnt++; }
    var rms = cnt ? Math.sqrt(acc / cnt) : 0;

    /* 过零次数（带死区，避免噪声抖动计数） */
    var dead = Math.max(pk * 0.02, 1e-4);
    var zc = 0, lastSign = 0;
    for (var d = 0; d < n; d++) {
      if (Math.abs(sz[d]) < dead) continue;
      var sg = sz[d] > 0 ? 1 : -1;
      if (lastSign !== 0 && sg !== lastSign) zc++;
      lastSign = sg;
    }

    out.swayPeak = pk;
    out.swayDecay = decayT;
    out.swayRms = rms;
    out.zeroCross = zc;

    /* 回转定位：以末段为"目标"，算稳态误差与超调 */
    var sl = [];
    for (var e = 0; e < n; e++) sl.push(isFinite(rows[e].slew) ? rows[e].slew : 0);
    var tgtN = Math.max(3, Math.floor(n * 0.1));
    var tgt = 0;
    for (var f = n - tgtN; f < n; f++) tgt += sl[f];
    tgt /= tgtN;
    var errAcc = 0;
    for (var g = n - tgtN; g < n; g++) errAcc += Math.abs(sl[g] - tgt);

    out.slewTarget = tgt;
    out.slewErr = errAcc / tgtN;

    /* 超调：朝目标移动时越过目标的最大量 */
    var startVal = sl[0];
    var dir = tgt - startVal;
    var ov = 0;
    if (Math.abs(dir) > 0.5) {
      for (var h = 0; h < n; h++) {
        var over = dir > 0 ? (sl[h] - tgt) : (tgt - sl[h]);
        if (over > ov) ov = over;
      }
    }
    out.slewOvershoot = ov;

    /* 抓取效率：最大填充率与单斗耗时（load 从 <5% 到峰值的时间） */
    var ld = [];
    for (var j2 = 0; j2 < n; j2++) ld.push(isFinite(rows[j2].load) ? rows[j2].load : 0);
    var lmax = -Infinity;
    for (var k2 = 0; k2 < n; k2++) if (ld[k2] > lmax) lmax = ld[k2];
    out.loadMax = lmax;

    /* 单斗耗时：物料从 5% 升到 90% 所用时间 */
    if (lmax > 0.1) {
      var tLow = null, tHigh = null;
      for (var m3 = 0; m3 < n; m3++) {
        if (tLow === null && ld[m3] > 0.05) tLow = ts[m3];
        if (ld[m3] > lmax * 0.9) { tHigh = ts[m3]; break; }
      }
      out.grabTime = (tLow !== null && tHigh !== null) ? Math.max(0, tHigh - tLow) : null;
    } else {
      out.grabTime = null;
    }

    return out;
  }

  function fmtNum(v, d, unit) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toFixed(d || 2) + (unit || '');
  }

  /* ---- 曲线数据摘要（供 AI 评估） ---- */
  function buildSummary() {
    var rec = (w.PY && w.PY.rec) || [];
    if (rec.length < 5) return null;
    var L = [];
    var dur = rec[rec.length - 1].t - rec[0].t;
    var segCount = {};
    for (var i = 0; i < rec.length; i++) {
      var sg = rec[i].seg || 0;
      segCount[sg] = (segCount[sg] || 0) + 1;
    }
    var segIds = Object.keys(segCount).sort();
    L.push('采样 ' + rec.length + ' 帧，时长 ' + dur.toFixed(1) + ' 秒，分 ' + segIds.length + ' 段。');
    L.push('');
    L.push('【各通道统计】');

    ALL_FIELDS.forEach(function (k) {
      var vals = [];
      for (var j = 0; j < rec.length; j++) {
        var v = rec[j][k];
        if (typeof v === 'number' && isFinite(v)) vals.push(v);
      }
      if (!vals.length) return;
      var mn = vals.reduce(function (a, b) { return a < b ? a : b; }, Infinity);
      var mx = vals.reduce(function (a, b) { return a > b ? a : b; }, -Infinity);
      var sum = vals.reduce(function (a, b) { return a + b; }, 0);
      var meta = FIELD_META[k] || [k, ''];
      L.push(meta[0] + (meta[1] ? '（' + meta[1] + '）' : '') +
        '：起 ' + vals[0].toFixed(3) + '，终 ' + vals[vals.length - 1].toFixed(3) +
        '，范围 ' + mn.toFixed(3) + ' ~ ' + mx.toFixed(3) +
        '，均值 ' + (sum / vals.length).toFixed(3));
    });

    var A = analyzeSeg(rec);
    if (A) {
      L.push('');
      L.push('【性能指标（整体）】');
      L.push('摆动：峰值 ' + fmtNum(A.swayPeak, 4, ' rad') + '（' + fmtNum(A.swayPeak * 57.3, 2, '°') + '）'
        + '，衰减到峰值 10% 用时 ' + (A.swayDecay === null ? '未衰减到位' : fmtNum(A.swayDecay, 2, ' s'))
        + '，稳态残余 RMS ' + fmtNum(A.swayRms, 4, ' rad')
        + '，过零 ' + A.zeroCross + ' 次');
      L.push('回转定位：目标 ' + fmtNum(A.slewTarget, 1, '°')
        + '，稳态误差 ' + fmtNum(A.slewErr, 2, '°')
        + '，超调 ' + fmtNum(A.slewOvershoot, 2, '°'));
      L.push('抓取：最大填充率 ' + fmtNum(A.loadMax * 100, 0, '%')
        + '，单斗耗时 ' + (A.grabTime === null ? '—' : fmtNum(A.grabTime, 1, ' s')));
    }

    if (segIds.length > 1) {
      L.push('');
      L.push('【分段对比】');
      segIds.forEach(function (sid) {
        var sub = [];
        for (var i2 = 0; i2 < rec.length; i2++) if ((rec[i2].seg || 0) === +sid) sub.push(rec[i2]);
        var nm = (w.PY.segNames && w.PY.segNames[+sid]) || ('段' + sid);
        var sa = analyzeSeg(sub);
        if (!sa) return;
        L.push(nm + '（' + sub.length + ' 帧）：摆动峰值 ' + fmtNum(sa.swayPeak, 4, ' rad')
          + '，衰减到 10% ' + (sa.swayDecay === null ? '未到位' : fmtNum(sa.swayDecay, 2, ' s'))
          + '，残余 ' + fmtNum(sa.swayRms, 4, ' rad')
          + '，过零 ' + sa.zeroCross + ' 次'
          + '，填充率 ' + fmtNum(sa.loadMax * 100, 0, '%'));
      });
    }
    return L.join('\n');
  }

  function escHtml(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  UI.evalChart = function () {
    var box = document.getElementById('chart-eval');
    var btn = document.getElementById('chart-ai');
    if (!box) return;

    var summary = buildSummary();
    box.classList.remove('hidden');

    if (!summary) {
      box.innerHTML = '<span class="ev-title">AI 评估</span>还没有采集到数据，先运行一段 Python 控制程序。';
      return;
    }
    if (!w.AI || !w.AI.cfg || !w.AI.cfg.key) {
      box.innerHTML = '<span class="ev-title">AI 评估</span>尚未配置 API Key。点左侧「AI 控制」→ 齿轮，填入 DeepSeek 或其他兼容接口的 Key。';
      return;
    }

    if (btn) btn.disabled = true;
    box.innerHTML = '<span class="ev-title">AI 评估</span>正在分析曲线数据…';

    var SYS = '你是港口机械控制课程的实验评阅教师。学生刚做完门座式起重机抓斗控制仿真，'
      + '下面是他采集到的各通道数据。请用中文给出简明评估：\n'
      + '1. 控制效果如何（抓取是否充分、摆动是否被抑制），引用具体数字；\n'
      + '2. 若有多段对比，判断算法段相对基线段的改善程度；\n'
      + '3. 指出 2~3 个可改进之处（可涉及 PD 参数、下放深度、时序安排）；\n'
      + '4. 最后给一个 0~100 的主观评分。\n'
      + '总字数控制在 350 字以内，不要铺垫，直接给结论。';

    w.AI.askText(SYS, summary).then(function (txt) {
      box.innerHTML = '<span class="ev-title">AI 评估</span>' + escHtml(txt);
    }).catch(function (e) {
      box.innerHTML = '<span class="ev-title">AI 评估</span>调用失败：' + escHtml(e.message);
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  };

  /* ---------------- Python 控制面板 ---------------- */
  function bindPython() {
    var panel = document.getElementById('py-panel');
    var ta = document.getElementById('py-text');
    var run = document.getElementById('py-run');
    var stop = document.getElementById('py-stop');
    var close = document.getElementById('py-close');
    var open = document.getElementById('py-open');
    var st = document.getElementById('py-status');
    var con = document.getElementById('py-console');
    var s1 = document.getElementById('py-sample');
    var s2 = document.getElementById('py-sway');
    if (!panel || !w.PY) return;

    ta.value = w.PY.SAMPLE;

    w.PY.onPrint = function (line) {
      con.textContent += line + '\n';
      con.scrollTop = con.scrollHeight;
    };
    w.PY.onUpdate = function (p) {
      if (p.running) {
        st.textContent = '运行中 ' + p.elapsed.toFixed(1) + 's';
        st.className = 'run';
      } else if (p.error) {
        st.textContent = p.error.slice(0, 28);
        st.className = 'err';
      } else {
        st.textContent = p.ready ? '就绪' : '未加载';
        st.className = '';
      }
    };

    function showPanel(on) {
      panel.classList.toggle('hidden', !on);
      if (on) {
        var cp = document.getElementById('code-panel');
        var ap = document.getElementById('ai-panel');
        if (cp) cp.classList.add('hidden');
        if (ap) ap.classList.add('hidden');
        ta.focus();
      }
    }

    open.addEventListener('click', function () {
      showPanel(true);
      if (w.STATS) w.STATS.track('python');
    });
    close.addEventListener('click', function () { showPanel(false); });

    run.addEventListener('click', function () {
      con.textContent = '';
      st.textContent = '加载中…';
      st.className = '';
      w.PY.run(ta.value);
    });
    stop.addEventListener('click', function () { w.PY.stop(); });
    s1.addEventListener('click', function () { ta.value = w.PY.SAMPLE; });
    s2.addEventListener('click', function () { ta.value = w.PY.SAMPLE_SWAY; });

    /* 供 AI 写入 */
    UI.setPyCode = function (code) {
      ta.value = code;
      showPanel(true);
    };

    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        run.click();
      }
    });
  }

  /* ---------------- 实训面板 ---------------- */
  function bindTrain() {
    var panel = document.getElementById('train-panel');
    var list = document.getElementById('tp-list');
    var total = document.getElementById('tp-total');
    var nameIn = document.getElementById('tp-name');
    var noIn = document.getElementById('tp-no');
    var repBtn = document.getElementById('train-report');
    var repBox = document.getElementById('tp-report');
    var openBtn = document.getElementById('train-open');
    if (!panel || !w.TRAIN) return;
    var TR = w.TRAIN;

    function render() {
      var sc = list.scrollTop;
      list.innerHTML = '';
      TR.tasks.forEach(function (t, i) {
        var cls = t.state === 'done' ? 'done' : (t.state === 'doing' ? 'doing' : '');
        var badge = t.state === 'done' ? (t.score + ' 分')
          : (t.state === 'doing' ? '进行中' : '未开始');
        var d = document.createElement('div');
        d.className = 'tp-task ' + cls;
        d.innerHTML =
          '<div class="tp-t"><b>' + t.title + '</b><span class="tp-badge">' + badge + '</span></div>' +
          '<p class="tp-goal">' + t.goal + '</p>' +
          (t.live && t.state === 'doing' ? '<div class="tp-live">' + t.live + '</div>' : '') +
          (t.detail ? '<div class="tp-live">✓ ' + t.detail + '</div>' : '') +
          '<div class="tp-actions"><button data-i="' + i + '"' +
          (t.state === 'doing' ? ' class="primary"' : '') + '>' +
          (t.state === 'done' ? '重做' : (t.state === 'doing' ? '重置' : '开始')) + '</button></div>' +
          '<div class="tp-hint">' + t.hint + '</div>';
        list.appendChild(d);
      });
      var tot = TR.total();
      total.textContent = tot.sum;
      list.scrollTop = sc;
    }

    list.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (!b) return;
      TR.start(+b.dataset.i);
    });

    TR.onUpdate = render;

    openBtn.addEventListener('click', function () {
      if (w.STATS) w.STATS.track('train');
      var on = panel.classList.toggle('hidden');
      openBtn.classList.toggle('on', !on);
      var rp = document.getElementById('panel-right');
      if (rp) rp.style.display = on ? '' : 'none';
      if (!on) render();
    });
    document.getElementById('train-close').addEventListener('click', function () {
      panel.classList.add('hidden');
      openBtn.classList.remove('on');
      var rp = document.getElementById('panel-right');
      if (rp) rp.style.display = '';
      if (repBox) repBox.classList.add('hidden');
    });

    nameIn.addEventListener('input', function () { TR.student.name = this.value; });
    noIn.addEventListener('input', function () { TR.student.no = this.value; });

    repBtn.addEventListener('click', function () {
      if (w.STATS) {
        w.STATS.track('report');
        var tot = TR.total();
        var det = TR.tasks.map(function (t) {
          return { id: t.id, title: t.title, score: t.score, state: t.state };
        });
        w.STATS.reportScore(TR.student.name, TR.student.no, tot.sum, det);
      }
      repBox.value = TR.report();
      repBox.classList.remove('hidden');
      repBox.focus();
      repBox.select();
    });
    repBox.addEventListener('blur', function () { repBox.classList.add('hidden'); });

    render();
  }

  /* ---------------- 脚本控制面板 ---------------- */
  function bindScript() {
    var panel = document.getElementById('code-panel');
    var ta = document.getElementById('code-text');
    var run = document.getElementById('code-run');
    var stop = document.getElementById('code-stop');
    var sample = document.getElementById('code-sample');
    var close = document.getElementById('code-close');
    var open = document.getElementById('code-open');
    var st = document.getElementById('code-status');
    if (!panel || !w.SCRIPT) return;

    ta.value = w.SCRIPT.SAMPLE;

    w.SCRIPT.onUpdate = function (s) {
      st.textContent = s.status || '';
      st.className = s.err ? 'err' : (s.running ? 'run' : '');
    };

    open.addEventListener('click', function () {
      panel.classList.remove('hidden');
      if (w.STATS) w.STATS.track('script');
      var ap = document.getElementById('ai-panel');
      if (ap) ap.classList.add('hidden');
      var pp = document.getElementById('py-panel');
      if (pp) pp.classList.add('hidden');
      ta.focus();
    });

    UI.setScriptCode = function (code) {
      ta.value = code;
      panel.classList.remove('hidden');
      var ap = document.getElementById('ai-panel');
      if (ap) ap.classList.add('hidden');
      var pp = document.getElementById('py-panel');
      if (pp) pp.classList.add('hidden');
    };
    close.addEventListener('click', function () { panel.classList.add('hidden'); });

    run.addEventListener('click', function () {
      if (w.DEMO && w.DEMO.running) w.DEMO.stop();
      w.SCRIPT.run(ta.value);
    });
    stop.addEventListener('click', function () { w.SCRIPT.stop(); });
    sample.addEventListener('click', function () {
      ta.value = w.SCRIPT.SAMPLE;
      st.textContent = '已载入示例';
      st.className = '';
    });

    /* Ctrl+Enter 运行 */
    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        run.click();
      }
    });
  }

  function bindViews() {
    var nav = document.getElementById('views');
    nav.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      [].forEach.call(nav.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      SCENE.applyView(b.dataset.view);
    });
  }

  /* ---------------- 三维标注 ---------------- */
  function buildTags() {
    for (var i = 0; i < TAG_DEF.length; i++) {
      var d = document.createElement('div');
      d.className = 'tag';
      d.textContent = TAG_DEF[i].t;
      el.tags.appendChild(d);
      tags.push({ el: d, key: TAG_DEF[i].k });
    }
  }

  var _v = new THREE.Vector3();

  function updateTags(anchors) {
    var w2 = w.innerWidth, h2 = w.innerHeight;
    var cam = SCENE.camera;
    for (var i = 0; i < tags.length; i++) {
      var t = tags[i];
      var a = anchors[t.key];
      if (!a) { t.el.classList.add('hide'); continue; }
      _v.copy(a).project(cam);
      if (_v.z > 1 || !KT.ST.showTags) { t.el.classList.add('hide'); continue; }
      t.el.classList.remove('hide');
      t.el.style.left = ((_v.x * 0.5 + 0.5) * w2) + 'px';
      t.el.style.top = ((-_v.y * 0.5 + 0.5) * h2) + 'px';
    }
  }

  /* ---------------- 数值面板 ---------------- */
  function syncSliders() {
    el.slew.value = KT.ST.cmd.slew;
    el.radius.value = KT.ST.Cl.x;
    el.hoist.value = KT.ST.cmd.hoist;
    el.grab.value = Math.round(KT.ST.cmd.grab * 100);
    el.travel.value = KT.ST.cmd.travel;
    el.slewV.textContent = (+KT.ST.cmd.slew).toFixed(1) + '°';
    el.radiusV.textContent = KT.ST.Cl.x.toFixed(1) + ' m';
    el.hoistV.textContent = (+KT.ST.cmd.hoist).toFixed(1) + ' m';
    el.grabV.textContent = Math.round(KT.ST.cmd.grab * 100) + '%';
    el.travelV.textContent = (+KT.ST.cmd.travel).toFixed(1) + ' m';
  }
  UI.syncSliders = syncSliders;

  /* ---------------- 控制曲线 ---------------- */
  var CHART_COLORS = ['#c0392b', '#2b6fb0', '#2e8b57', '#b8860b', '#7a4fa8', '#0f7b8a'];

  /* 曲线字段：英文键 → 中文名（单位） */
  var FIELD_META = {
    hoist:   ['起升高度', 'm'],
    radius:  ['工作幅度', 'm'],
    slew:    ['回转角', '°'],
    load:    ['斗内物料', ''],
    grab:    ['抓斗开度', ''],
    swayMag: ['合摆角', 'rad'],
    swayZ:   ['横向摆角', 'rad'],
    swayVZ:  ['横向角速度', 'rad/s'],
    swayX:   ['纵向摆角', 'rad'],
  };
  var ALL_FIELDS = ['hoist', 'radius', 'slew', 'load', 'grab', 'swayMag', 'swayZ', 'swayVZ', 'swayX'];

  UI.showChart = function (keys, compare) {
    var panel = document.getElementById('chart-panel');
    var cv = document.getElementById('py-chart');
    if (!panel || !cv || !w.PY) return;
    panel.classList.remove('hidden');

    /* 画布高度随字段数变化，每行 52 px */
    var flds = (keys && keys.length) ? keys : ALL_FIELDS;
    var wantH = Math.max(150, flds.length * 46);
    cv.style.height = wantH + 'px';

    var rec = w.PY.rec || [];
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = cv.clientWidth || 620, H = cv.clientHeight || 240;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!rec.length) {
      ctx.fillStyle = '#8b96a4';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('还没有数据，先运行 Python 程序', 20, 30);
      return;
    }

    if (!keys || !keys.length) keys = ALL_FIELDS;
    var n = keys.length;
    var ph = H / n;
    var x0 = 46, x1 = W - 12;

    keys.forEach(function (k, i) {
      var min = Infinity, max = -Infinity;
      for (var j = 0; j < rec.length; j++) {
        var v = rec[j][k];
        if (typeof v === 'number' && isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (!isFinite(min)) return;
      if (max - min < 1e-6) { min -= 0.5; max += 0.5; }
      var pd = (max - min) * 0.14;
      min -= pd; max += pd;

      var y0 = i * ph + 16, y1 = (i + 1) * ph - 10;

      /* 背景分隔线 */
      ctx.strokeStyle = '#eceff4';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y1); ctx.lineTo(x1, y1);
      ctx.stroke();

      /* 曲线 */
      function drawSeg(segFilter, color, dash) {
        ctx.beginPath();
        var started = false;
        for (var m = 0; m < rec.length; m++) {
          if (segFilter !== null && (rec[m].seg || 0) !== segFilter) { started = false; continue; }
          var val = rec[m][k];
          if (typeof val !== 'number' || !isFinite(val)) { started = false; continue; }
          var px = x0 + (rec.length > 1 ? (m / (rec.length - 1)) * (x1 - x0) : 0);
          var py = y1 - ((val - min) / (max - min)) * (y1 - y0);
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = dash ? 1.4 : 1.8;
        ctx.setLineDash(dash || []);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      var hasSeg1 = false;
      for (var q = 0; q < rec.length; q++) { if ((rec[q].seg || 0) === 1) { hasSeg1 = true; break; } }

      if (compare && hasSeg1) {
        drawSeg(0, '#9aa5b4', [5, 3]);                       // 基线：灰虚线
        drawSeg(1, CHART_COLORS[i % CHART_COLORS.length]);   // 算法：彩色实线
      } else {
        drawSeg(null, CHART_COLORS[i % CHART_COLORS.length]);
      }

      /* 标注：中文名 + 单位 */
      var meta = FIELD_META[k] || [k, ''];
      ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
      ctx.font = '600 10px "SimHei","Microsoft YaHei",sans-serif';
      ctx.fillText(meta[0], 8, y0 + 7);
      ctx.fillStyle = '#8b96a4';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(max.toFixed(2) + (meta[1] ? ' ' + meta[1] : ''), 8, y0 + 18);
      ctx.fillText(min.toFixed(2), 8, y1);
    });

    /* 顶部指标条 */
    var mbox = document.getElementById('chart-metrics');
    if (mbox) {
      var A2 = analyzeSeg(rec);
      if (A2) {
        mbox.innerHTML =
          '<b>摆动</b> 峰值 ' + (A2.swayPeak * 57.3).toFixed(2) + '° · 衰减 '
          + (A2.swayDecay === null ? '未到位' : A2.swayDecay.toFixed(1) + 's')
          + ' · 残余 ' + A2.swayRms.toFixed(4) + ' · 过零 ' + A2.zeroCross
          + ' <i>|</i> <b>回转</b> 误差 ' + A2.slewErr.toFixed(2) + '° · 超调 ' + A2.slewOvershoot.toFixed(2) + '°'
          + ' <i>|</i> <b>抓取</b> ' + (A2.loadMax * 100).toFixed(0) + '% · '
          + (A2.grabTime === null ? '—' : A2.grabTime.toFixed(1) + 's');
      }
    }

    /* 图例与时间轴 */
    var hasS1 = false;
    for (var z = 0; z < rec.length; z++) { if ((rec[z].seg || 0) === 1) { hasS1 = true; break; } }
    if (compare && hasS1) {
      var names = (w.PY.segNames || ['基线', '算法']);
      ctx.font = '9.5px ui-monospace, monospace';
      ctx.strokeStyle = '#9aa5b4'; ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(x1 - 132, H - 7); ctx.lineTo(x1 - 112, H - 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#7b8695';
      ctx.fillText(names[0], x1 - 108, H - 4);

      ctx.strokeStyle = CHART_COLORS[0]; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(x1 - 62, H - 7); ctx.lineTo(x1 - 42, H - 7); ctx.stroke();
      ctx.fillStyle = '#7b8695';
      ctx.fillText(names[1], x1 - 38, H - 4);
    }
    ctx.fillStyle = '#9aa5b4';
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillText('t = ' + rec[rec.length - 1].t.toFixed(1) + ' s', x0, H - 4);
  };

  UI.setQuality = function (name) {
    var qual = document.getElementById('seg-quality');
    if (!qual) return;
    [].forEach.call(qual.children, function (c) {
      c.classList.toggle('on', c.dataset.v === name);
    });
  };

  UI.setSpeed = function (v) {
    KT.setTimeScale(v);
    var spd = document.getElementById('seg-speed');
    if (!spd) return;
    [].forEach.call(spd.children, function (c) {
      c.classList.toggle('on', Math.abs(parseFloat(c.dataset.v) - v) < 1e-6);
    });
  };

  UI.setDemoButton = function (running) {
    el.demo.classList.toggle('running', running);
    el.demo.textContent = running ? '■ 停止循环' : '▶ 作业循环';
  };

  var uiAcc = 0;

  UI.update = function (dt, fps) {
    var st = KT.ST;

    if (w.CRANE) updateTags(w.CRANE.anchors(st));

    uiAcc += dt;
    if (uiAcc < 0.08) return;
    uiAcc = 0;

    var R = st.radius, H = st.height;
    var sway = Math.hypot(st.thx, st.thz);

    el.oRadius.textContent = R.toFixed(1);
    el.oHeight.textContent = H.toFixed(1);
    el.oSlew.textContent = (U.deg(st.slew) % 360).toFixed(1) + '°';
    el.oAlpha.textContent = U.deg(st.alpha).toFixed(1) + '°';
    el.oGrab.textContent = Math.round(st.grabOpen * 100) + '%';
    el.oRope.textContent = st.ropeLen.toFixed(2) + ' m';
    el.oSpeed.textContent =
      Math.abs(st.vRope).toFixed(2) + ' / ' + Math.abs(st.vTip || 0).toFixed(2);
    el.oSway.textContent = U.deg(sway).toFixed(1) + '°';
    el.oPos.textContent =
      st.grabPos.x.toFixed(1) + ', ' + st.grabPos.y.toFixed(1) + ', ' +
      st.grabPos.z.toFixed(1);
    el.oTravel.textContent = st.travel.toFixed(2) + ' m';

    /* 载荷：抓斗自重 + 斗内物料 */
    var g = C.grab;
    var payload = g.weight + g.payload * st.load;
    var Q = KT.ratedLoad(R);
    var over = payload > Q + 0.05;

    el.oLoad.textContent = Math.round(st.load * 100) + '%';
    el.oLoad.title = st.lastGrabInfo || '';
    if (el.oHold) {
      el.oHold.textContent = Math.round(st.holdRemain * 100) + '%';
      el.oHold.title = '料面 ' + st.holdLevel.toFixed(2) + ' m';
    }
    el.oTruck.textContent = (w.DEMO ? w.DEMO.truckLoad : 0) + ' / ' + C.scene.truck.capacity;

    el.oLoadState.textContent = over ? '超载' : '安全';
    el.oLoadState.className = over ? 'over' : 'ok';
    el.oCap.textContent = 'Q(' + R.toFixed(1) + ' m) = ' + Q.toFixed(1) +
      ' t ／ 载荷 ' + payload.toFixed(1) + ' t';

    var moving = Math.abs(st.vRope) > 0.01 || Math.abs(st.vSlew) > 0.2 ||
      Math.abs(st.vLuff) > 0.15 || Math.abs(st.vTravel) > 0.01 ||
      Math.abs(st.vGrab) > 0.02;

    if (over) el.stMode.textContent = '超载报警';
    else if (w.DEMO && w.DEMO.running) el.stMode.textContent = '循环 · ' + w.DEMO.label;
    else el.stMode.textContent = moving ? '机构运行中' : '待机';
    el.stDot.className = 'dot' + (over ? ' over' : (moving ? ' run' : ''));
    if (fps) {
      var ts = KT.ST.timeScale || 1;
      el.stFps.textContent = fps.toFixed(0) + ' fps' +
        (Math.abs(ts - 1) > 0.01 ? ' · ' + ts + '×' : '');
    }

    chartAcc += 0.08;
    if (chartAcc > 0.16) { chartAcc = 0; drawChart(R, payload, over); }

    if (w.DEMO && w.DEMO.running) syncSliders();
  };

  /* ---------------- 起重量-幅度曲线 ---------------- */
  function resizeChart() {
    var c = el.chart;
    if (!c) return;
    var wpx = c.parentElement.clientWidth;
    var hpx = Math.max(88, Math.round(wpx * 0.44));
    c.width = Math.round(wpx * dpr);
    c.height = Math.round(hpx * dpr);
    c.style.width = wpx + 'px';
    c.style.height = hpx + 'px';
    drawChart();
  }

  function drawChart(Rcur, Qcur, over) {
    var c = el.chart;
    if (!c) return;
    var ctx = c.getContext('2d');
    var W = c.width / dpr, H = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var pl = 30, pr = 9, pt = 10, pb = 20;
    var R0 = 21, R1 = 33, Q0 = 0, Q1 = 18;
    var X = function (r) { return pl + (r - R0) / (R1 - R0) * (W - pl - pr); };
    var Y = function (q) { return H - pb - (q - Q0) / (Q1 - Q0) * (H - pt - pb); };

    ctx.strokeStyle = 'rgba(24,36,52,.07)';
    ctx.lineWidth = 1;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#8994a4';
    for (var rr = 22; rr <= 32; rr += 2) {
      ctx.beginPath(); ctx.moveTo(X(rr), pt); ctx.lineTo(X(rr), H - pb); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(rr + '', X(rr), H - 6);
    }
    for (var qq = 0; qq <= 18; qq += 6) {
      ctx.beginPath(); ctx.moveTo(pl, Y(qq)); ctx.lineTo(W - pr, Y(qq)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(qq + '', pl - 4, Y(qq) + 3);
    }

    var pts = [];
    for (var r = 21.2; r <= 32.9; r += 0.2) pts.push([r, KT.ratedLoad(r)]);

    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), H - pb);
    for (var i = 0; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    ctx.lineTo(X(pts[pts.length - 1][0]), H - pb);
    ctx.closePath();
    ctx.fillStyle = 'rgba(43,111,176,.10)';
    ctx.fill();

    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) {
      var px = X(pts[j][0]), py = Y(pts[j][1]);
      if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#2b6fb0';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    if (Rcur != null) {
      var cx = X(U.clamp(Rcur, R0, R1));
      var cy = Y(U.clamp(Qcur, Q0, Q1));
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(cx, pt); ctx.lineTo(cx, H - pb);
      ctx.strokeStyle = over ? 'rgba(207,74,52,.5)' : 'rgba(46,139,87,.42)';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = over ? '#cf4a34' : '#2e8b57';
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke();
    }

    ctx.fillStyle = '#9aa5b4';
    ctx.textAlign = 'left'; ctx.fillText('R/m', 2, H - 6);
    ctx.textAlign = 'right'; ctx.fillText('Q/t', pl - 4, pt + 2);
  }

  w.UI = UI;
})(window);
