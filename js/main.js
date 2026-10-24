/* =============================================================
 * main.js — 主循环、抓取卸料作业循环、吊钩视角
 * ============================================================= */
(function (w) {
  'use strict';

  var C = w.CFG, SCENE = w.SCENE, CRANE = w.CRANE, KT = w.KT, UI = w.UI, U = w.U;
  var ST = KT.ST;

  ST.sandFlow = 0;
  ST.sandFlowLen = 0;

  /* ---------------- 作业循环 ---------------- */
  var DEMO = { running: false, idx: -1, hold: 0, t: 0, label: '', truckLoad: 0 };

  var SHIP_R = 30.0, SHIP_SLEW = -90;
  var TRUCK_R = 23.0, TRUCK_SLEW = 0;

  /* 每阶段只下达目标值，速度由运动学层按机构额定值限幅 */
  var SEQ = [
    { label: '抓斗下降入舱', radius: SHIP_R, slew: SHIP_SLEW, hoist: 1.25, grab: 1, hold: 0.45 },
    { label: '闭合抓取', grab: 0, grabLoad: 1.15, hold: 0.9 },
    { label: '提升出舱', hoist: 15.5, hold: 0.35 },
    { label: '回转至卡车上方', slew: TRUCK_SLEW, radius: TRUCK_R, hold: 0.45 },
    { label: '下降就位', hoist: 5.0, hold: 0.35 },
    { label: '张开卸料', grab: 1, unload: true, hold: 1.5 },
    { label: '提升', hoist: 11.0, hold: 0.25 },
    { label: '回转复位', slew: SHIP_SLEW, radius: SHIP_R, hold: 0.45 },
  ];

  DEMO.toggle = function () { this.running ? this.stop() : this.start(); };

  DEMO.start = function () {
    this.running = true;
    this.idx = -1;
    this.hold = 0;
    this.t = 0;
    this._next();
    UI.setDemoButton(true);
  };

  DEMO.stop = function () {
    this.running = false;
    this.label = '';
    ST.sandFlow = 0;
    UI.setDemoButton(false);
  };

  DEMO._next = function () {
    this.idx++;
    if (this.idx >= SEQ.length) this.idx = 0;
    this.hold = 0;
    this.t = 0;
    this.label = SEQ[this.idx].label;
  };

  DEMO.update = function (dt) {
    if (!this.running) return;
    var s = SEQ[this.idx];
    this.t += dt;

    if (this.hold > 0) {
      this.hold -= dt;
      DEMO.label = s.label;
      if (this.hold <= 0) this._next();
      return;
    }

    if (s.radius != null) KT.setRadius(s.radius);
    if (s.slew != null) KT.set('slew', s.slew);
    if (s.hoist != null) KT.set('hoist', s.hoist);
    if (s.grab != null) KT.set('grab', s.grab);


    /* 阶段完成判定 */
    var ok = true;
    if (s.radius != null && Math.abs(KT.ST.Cl.x - s.radius) > 0.25) ok = false;
    if (s.slew != null && Math.abs(U.deg(ST.slew) - s.slew) > 0.8) ok = false;
    if (s.hoist != null && Math.abs(ST.hoist - s.hoist) > 0.12) ok = false;
    if (s.grab != null && Math.abs(ST.grabOpen - s.grab) > 0.03) ok = false;

    if (ok && s.unload && ST.load > 0.02) ok = false;
    if (ok && s.grabLoad && ST.load < 0.15) ok = false;

    if (ok) {
      this.hold = s.hold || 0;
      if (this.hold <= 0) this._next();
    }
  };

  w.DEMO = DEMO;

  /* ---------------- 吊钩特写（跟随视角） ---------------- */
  var _cp = new THREE.Vector3(), _ct = new THREE.Vector3();

  function updateHookCam() {
    var gp = ST.grabPos;
    var nx = Math.sin(ST.slew), nz = Math.cos(ST.slew);
    _cp.set(gp.x + nx * 19, gp.y + 8.5, gp.z + nz * 19);
    _ct.copy(gp);
    _ct.y -= 1.5;
    SCENE.setCabView(_cp, _ct);
  }

  /* ---------------- 卡车装载可视化 ---------------- */
  function updateTruck() {
    var sand = SCENE.truckSand;
    if (!sand) return;
    var k = DEMO.truckLoad / C.scene.truck.capacity;
    sand.visible = k > 0.01;
    if (!sand.visible) return;
    var bed = SCENE.truckBed;
    var hh = 1.05 * k;
    sand.scale.y = hh;
    sand.position.y = bed.y + 0.1 + hh * 0.5;
  }

  /* ---------------- 落料与卡车装载 ---------------- */
  var prevLoad = 0;

  function overTruck(gp) {
    var t = C.scene.truck;
    return Math.abs(gp.x - t.x) < 5.0 && Math.abs(gp.z - t.z) < 2.2;
  }

  function updateUnload(dt) {
    var st = KT.ST;
    var dumping = st.sandFlow > 0.01 && st.load > 0.01;
    st.sandFlow = dumping
      ? Math.min(1, st.sandFlow + dt * 6)
      : Math.max(0, st.sandFlow - dt * 4);

    /* 料刚放空：若抓斗在车斗上方则计一斗 */
    if (prevLoad > 0.05 && st.load <= 0.02) {
      if (overTruck(st.grabPos)) {
        var cap = C.scene.truck.capacity;
        DEMO.truckLoad = DEMO.truckLoad >= cap ? 0 : DEMO.truckLoad + 1;
      }
    }
    prevLoad = st.load;
  }

  /* ---------------- 落料沙流 ---------------- */
  function updateSandFlow() {
    if (ST.sandFlow < 0.02) { ST.sandFlowLen = 0; return; }
    var bedY = C.scene.truck.bedY + 0.15;
    var len = Math.max(ST.grabPos.y - C.grab.height - bedY, 0.2);
    ST.sandFlowLen = len;
  }

  /* ---------------- 帧率自适应 ---------------- */
  var lowT = 0;

  function autoQuality(dt, fps) {
    if (SCENE.qualityManual) return;      // 手动选过就不再干预
    if (fps < 26) lowT += 0.5;
    else lowT = Math.max(0, lowT - 0.25);
    if (lowT < 3) return;
    lowT = 0;
    if (SCENE.quality === 'high') { SCENE.setQuality('mid'); UI.setQuality('mid'); }
    else if (SCENE.quality === 'mid') { SCENE.setQuality('low'); UI.setQuality('low'); }
    else { SCENE.qualityManual = true; }   // 已经最低，停止继续判断
  }

  /* ---------------- 主循环 ---------------- */
  var lastT = 0, fpsAcc = 0, fpsFrames = 0, fpsVal = 60;

  function loop(now) {
    var t = now * 0.001;
    var dt = lastT ? Math.min(t - lastT, 0.05) : 0.016;
    lastT = t;

    /* 倍速只作用于仿真时间轴，相机过渡与界面刷新仍按真实时间 */
    var dtSim = dt * (ST.timeScale || 1);

    DEMO.update(dtSim);
    if (w.SCRIPT) w.SCRIPT.update(dtSim);
    KT.updateGrab(dtSim);
    updateUnload(dtSim);
    if (!DEMO.running) ST.sandFlow = Math.max(0, ST.sandFlow - dtSim * 5);

    KT.update(dtSim);
    KT.measure(dtSim);

    updateSandFlow();
    if (SCENE.holdSand) SCENE.holdSand.position.y = ST.holdLevel - 1.3;
    CRANE.update(ST);
    updateTruck();

    SCENE.updateFly(dt);
    if (SCENE._view === 'cab') updateHookCam();
    else if (SCENE.controls.enabled) SCENE.controls.update();

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fpsVal = fpsFrames / fpsAcc;
      fpsAcc = 0; fpsFrames = 0;
      autoQuality(dt, fpsVal);
    }

    UI.update(dt, fpsVal);
    SCENE.render();
    requestAnimationFrame(loop);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var stage = document.getElementById('stage');

    SCENE.init(stage);
    CRANE.build(SCENE.scene);
    UI.init();
    if (w.AI) w.AI.init();

    stage.addEventListener('pointerdown', function () {
      if (SCENE._view === 'cab') {
        SCENE._view = 'free';
        var dir = new THREE.Vector3();
        SCENE.camera.getWorldDirection(dir);
        SCENE.controls.target.copy(SCENE.camera.position).addScaledVector(dir, 30);
        SCENE.controls.enabled = true;
        SCENE.controls.update();
      }
    });

    var q = new URLSearchParams(location.search);
    var num = function (k, d) {
      var v = parseFloat(q.get(k));
      return isNaN(v) ? d : v;
    };
    if (q.get('alpha')) KT.set('alpha', num('alpha', 40));
    else KT.setRadius(num('radius', 30));
    KT.set('hoist', num('hoist', 1.5));
    KT.set('slew', num('slew', -90));
    KT.set('travel', num('travel', 0));
    KT.set('grab', num('grab', 1));
    if (q.get('speed')) UI.setSpeed(num('speed', 1));
    if (q.get('ai') === '1') {
      var apn = document.getElementById('ai-panel');
      if (apn) apn.classList.remove('hidden');
    }
    if (q.get('code') === '1') {
      var cp = document.getElementById('code-panel');
      if (cp) cp.classList.remove('hidden');
    }
    if (q.get('cam')) {
      var cc = q.get('cam').split(',').map(Number);
      if (cc.length === 6 && cc.every(function (v) { return isFinite(v); })) {
        SCENE.camera.position.set(cc[0], cc[1], cc[2]);
        SCENE.controls.target.set(cc[3], cc[4], cc[5]);
        SCENE.controls.update();
      }
    }
    if (q.get('view')) SCENE.applyView(q.get('view'));
    if (q.get('nostting') === '1') ST.swayOn = false;
    if (q.get('trace') === '1') ST.showTrace = true;
    if (q.get('demo') === '1') DEMO.start();

    KT.snap();
    UI.syncSliders();
    CRANE.update(ST);

    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
