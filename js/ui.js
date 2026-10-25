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

  function bindChart() {
    var btn = document.getElementById('chart-close');
    if (!btn) return;
    btn.addEventListener('click', function () {
      document.getElementById('chart-panel').classList.add('hidden');
    });
  }

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

    open.addEventListener('click', function () { showPanel(true); });
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

  UI.showChart = function (keys) {
    var panel = document.getElementById('chart-panel');
    var cv = document.getElementById('py-chart');
    if (!panel || !cv || !w.PY) return;
    panel.classList.remove('hidden');

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

    if (!keys || !keys.length) keys = ['hoist', 'load'];
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
      ctx.beginPath();
      for (var m = 0; m < rec.length; m++) {
        var val = rec[m][k];
        if (typeof val !== 'number' || !isFinite(val)) continue;
        var px = x0 + (rec.length > 1 ? (m / (rec.length - 1)) * (x1 - x0) : 0);
        var py = y1 - ((val - min) / (max - min)) * (y1 - y0);
        if (m === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = CHART_COLORS[i % CHART_COLORS.length];
      ctx.lineWidth = 1.6;
      ctx.stroke();

      /* 标注 */
      ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
      ctx.font = '600 10.5px ui-monospace, monospace';
      ctx.fillText(k, 8, y0 + 6);
      ctx.fillStyle = '#8b96a4';
      ctx.font = '9.5px ui-monospace, monospace';
      ctx.fillText(max.toFixed(2), 8, y0 + 18);
      ctx.fillText(min.toFixed(2), 8, y1);
    });

    /* 时间轴 */
    ctx.fillStyle = '#9aa5b4';
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillText('t = ' + rec[rec.length - 1].t.toFixed(1) + ' s', x1 - 52, H - 3);
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
