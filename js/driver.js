/* 司机操作模式：座位相机、驾驶室内饰和按住式机构操控。 */
(function (w) {
  'use strict';
  var D = { active: false, emergency: false };
  var keys = {}, pointers = {}, panel, canvas, buttons, interior, previousView = 'iso';
  var yaw = 0, pitch = -0.85, drag = null, saved = null, hiddenShells = [], usingCAD = false;
  var eye = new THREE.Vector3(), direction = new THREE.Vector3(), target = new THREE.Vector3();
  var mapping = {
    KeyA: ['slew', 1], KeyD: ['slew', -1], KeyW: ['alpha', -1], KeyS: ['alpha', 1],
    ArrowUp: ['hoist', 1], ArrowDown: ['hoist', -1], KeyJ: ['grab', -1], KeyK: ['grab', 1],
    KeyZ: ['travel', -1], KeyX: ['travel', 1]
  };

  function seat() {
    var p = w.CRANE_MODEL && w.CRANE_MODEL.ready ? w.CRANE_MODEL.driverEye() : { x: 3.45, y: 2.2, z: 2.6 };
    return eye.set(p.x, p.y, p.z);
  }

  function clearInput() {
    keys = {}; pointers = {}; drag = null;
    if (buttons) buttons.forEach(function (b) { b.classList.remove('held'); });
    if (D.active) w.KT.stopDriver();
  }

  function editable(t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }

  D.stop = function () {
    clearInput(); D.emergency = true;
    panel.classList.add('stopped');
    document.getElementById('driver-state').textContent = '已急停';
    document.getElementById('driver-stop').textContent = '解除急停';
  };

  D.center = function () {
    w.CRANE.upper.updateWorldMatrix(true, false);
    target.copy(w.KT.ST.grabPos); target.y -= w.CFG.grab.height * 0.5;
    w.CRANE.upper.worldToLocal(target);
    direction.copy(target).sub(seat());
    yaw = U.clamp(Math.atan2(direction.z, direction.x), -1.35, 1.35);
    pitch = U.clamp(Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), -1.15, 0.5);
  };

  function buildInterior() {
    var g = new THREE.Group(); g.name = '司机室内饰';
    var frame = new THREE.MeshStandardMaterial({ color: 0x33495d, roughness: 0.65, metalness: 0.35 });
    var trim = new THREE.MeshStandardMaterial({ color: 0x202a34, roughness: 0.85 });
    var screen = new THREE.MeshStandardMaterial({ color: 0x16494a, emissive: 0x123c37, roughness: 0.4 });
    function box(x, y, z, px, py, pz, mat) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat || frame);
      m.position.set(px, py, pz); g.add(m); return m;
    }
    // 视线前方保留落地观察窗，司机可向下观察抓斗；两侧控制台不挡中央视野。
    box(2.8, 0.08, 1.82, -0.7, -1.38, 0, trim);
    box(2.8, 0.08, 1.82, -0.7, 0.72, 0);
    [-0.88, 0.88].forEach(function (z) {
      box(0.07, 2.1, 0.07, 0.67, -0.33, z);
      box(2.8, 0.08, 0.06, -0.7, -1.0, z);
      box(0.95, 0.38, 0.24, -0.1, -0.86, z * 0.83, trim);
      var display = box(0.23, 0.035, 0.18, 0.22, -0.65, z * 0.83, screen);
      display.rotation.z = 0.25;
      box(0.035, 0.19, 0.035, -0.1, -0.57, z * 0.83, trim);
      box(0.075, 0.06, 0.075, -0.1, -0.46, z * 0.83, trim);
    });
    box(0.07, 0.07, 1.82, 0.67, 0.72, 0);
    box(0.07, 0.07, 1.82, 0.67, -1.34, 0);
    box(0.12, 2.1, 1.82, -2.05, -0.33, 0);
    w.CRANE.upper.add(g); g.visible = false; interior = g;
  }

  D.init = function () {
    panel = document.getElementById('driver-panel');
    canvas = w.SCENE.renderer.domElement;
    buttons = Array.from(panel.querySelectorAll('[data-drive]'));
    buttons.forEach(function (b) {
      b.addEventListener('pointerdown', function (e) {
        if (!D.active || D.emergency || e.button !== 0) return;
        e.preventDefault(); b.focus({ preventScroll: true });
        b.setPointerCapture(e.pointerId); pointers[e.pointerId] = b.dataset.drive;
      });
      function release(e) { delete pointers[e.pointerId]; }
      b.addEventListener('pointerup', release); b.addEventListener('pointercancel', release); b.addEventListener('lostpointercapture', release);
      // 聚焦按钮后按住 Enter，同样使用松手停止的持续操纵方式。
      b.addEventListener('keydown', function (e) {
        if (e.code !== 'Enter' || D.emergency) return;
        e.preventDefault(); pointers.enter = b.dataset.drive;
      });
      b.addEventListener('keyup', function (e) { if (e.code === 'Enter') delete pointers.enter; });
    });
    document.getElementById('driver-stop').addEventListener('click', function () {
      if (!D.emergency) { D.stop(); return; }
      clearInput(); D.emergency = false; panel.classList.remove('stopped');
      document.getElementById('driver-state').textContent = '手动控制';
      this.textContent = '急停 · 空格';
    });
    document.getElementById('driver-center').addEventListener('click', D.center);
    document.getElementById('driver-exit').addEventListener('click', function () { w.SCENE.applyView(previousView); });
    w.addEventListener('keydown', function (e) {
      if (!D.active || editable(e.target)) return;
      if (e.code === 'Escape') { e.preventDefault(); w.SCENE.applyView(previousView); return; }
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) D.stop(); return; }
      if (!mapping[e.code] || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.target !== canvas && !panel.contains(e.target)) return;
      e.preventDefault(); if (!D.emergency && !e.repeat) keys[e.code] = true;
    });
    w.addEventListener('keyup', function (e) { delete keys[e.code]; if (e.code === 'Enter') delete pointers.enter; });
    w.addEventListener('blur', clearInput);
    document.addEventListener('visibilitychange', function () { if (document.hidden) clearInput(); });
    document.addEventListener('focusin', function (e) {
      if (D.active && (editable(e.target) || (e.target !== canvas && !panel.contains(e.target)))) clearInput();
    });
    canvas.addEventListener('pointerdown', function (e) {
      if (!D.active || e.button !== 0) return;
      canvas.focus({ preventScroll: true }); drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!D.active || !drag || drag.id !== e.pointerId) return;
      yaw = U.clamp(yaw + (e.clientX - drag.x) * 0.003, -1.35, 1.35);
      pitch = U.clamp(pitch - (e.clientY - drag.y) * 0.003, -1.15, 0.65);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    function endDrag() { drag = null; }
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('lostpointercapture', endDrag);
    buildInterior();
  };

  D.setActive = function (active, from) {
    if (D.active === active || !panel) return;
    if (active) {
      previousView = from === 'free' || from === 'driver' ? 'iso' : from;
      if (w.DEMO) w.DEMO.stop();
      if (w.SCRIPT && w.SCRIPT.running) w.SCRIPT.stop();
      if (w.PY && w.PY.running) w.PY.stop();
      saved = { fov: w.SCENE.camera.fov, near: w.SCENE.camera.near, speed: w.KT.ST.timeScale };
      D.active = true; D.emergency = false; clearInput(); w.KT.enableDriver(true);
      usingCAD = !!(w.CRANE_MODEL && w.CRANE_MODEL.ready);
      w.UI.setSpeed(1);
      w.SCENE.camera.fov = 72; w.SCENE.camera.near = 0.04; w.SCENE.camera.updateProjectionMatrix();
      panel.classList.remove('hidden', 'stopped'); document.body.classList.add('driver-mode');
      document.getElementById('driver-state').textContent = '手动控制';
      document.getElementById('driver-stop').textContent = '急停 · 空格';
      D.center(); D.updateCamera();
    } else {
      clearInput(); w.KT.enableDriver(false); D.active = false;
      panel.classList.add('hidden'); document.body.classList.remove('driver-mode');
      interior.visible = false;
      hiddenShells.forEach(function (s) { s.object.visible = s.visible; }); hiddenShells = [];
      w.SCENE.camera.fov = saved.fov; w.SCENE.camera.near = saved.near; w.SCENE.camera.updateProjectionMatrix();
      w.UI.setSpeed(saved.speed); w.UI.syncSliders();
    }
  };

  D.update = function () {
    var held = {};
    Object.keys(keys).forEach(function (key) { var m = mapping[key]; held[m[0] + ':' + m[1]] = true; });
    Object.keys(pointers).forEach(function (id) { held[pointers[id]] = true; });
    var input = {}, speed = +document.getElementById('driver-speed').value;
    Object.keys(held).forEach(function (id) { var m = id.split(':'); input[m[0]] = (input[m[0]] || 0) + (+m[1]) * speed; });
    buttons.forEach(function (b) { b.classList.toggle('held', !!held[b.dataset.drive] && !D.emergency); });
    w.KT.drive(D.emergency ? {} : input);
  };

  D.updateCamera = function () {
    if (!D.active) return;
    var K = w.CRANE, st = w.KT.ST, cam = w.SCENE.camera;
    var ready = !!(w.CRANE_MODEL && w.CRANE_MODEL.ready);
    if (ready !== usingCAD) { usingCAD = ready; D.center(); }
    var shell = w.SCENE.scene.getObjectByName('CAD_司机室外壳') || K.cab;
    if (shell && !hiddenShells.some(function (s) { return s.object === shell; })) {
      hiddenShells.push({ object: shell, visible: shell.visible }); shell.visible = false;
    }
    interior.position.copy(seat()); interior.visible = true;
    K.upper.updateWorldMatrix(true, false);
    cam.position.copy(eye); K.upper.localToWorld(cam.position);
    direction.set(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
    target.copy(eye).add(direction); K.upper.localToWorld(target); cam.lookAt(target);
    // 与下一次环绕/预设视角衔接，不沿用进入前的环绕中心。
    w.SCENE.controls.target.copy(target);
    document.getElementById('driver-instruments').textContent = '幅度 ' + st.radius.toFixed(1) + ' m  ·  高度 ' + st.height.toFixed(1) +
      ' m  ·  回转 ' + U.deg(st.slew).toFixed(1) + '°  ·  开斗 ' + Math.round(st.grabOpen * 100) + '%  ·  斗内 ' + Math.round(st.load * 100) + '%';
  };

  w.DRIVER = D;
})(window);
