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
      ta.focus();
    });
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
