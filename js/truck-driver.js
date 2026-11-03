/* =============================================================
 * truck-driver.js — 货车驾驶模式
 *
 * 与门机「司机操作」并列的第一视角：镜头坐在货车驾驶位，
 * WASD 驾驶、空格制动、拖动环视；整车按单车模型平移/转向，
 * 车斗与落料判定随车位姿更新，仍可正常接料。
 * ============================================================= */
(function (w) {
  'use strict';

  var T = { active: false, moving: false, speed: 0, steer: 0, heading: 0, x: 0, z: 0 };

  var panel, canvas, interior, previousView = 'iso', saved = null;
  var keys = {}, lookYaw = 0, lookPitch = -0.03, drag = null;
  var eye = new THREE.Vector3(), dir = new THREE.Vector3(), target = new THREE.Vector3();

  /* 车辆与驾驶手感参数 */
  var WHEELBASE = 6.6;        // 前/后轴距 m
  var MAX_SPEED = 9.0;        // 前进最高 32 km/h
  var MAX_REVERSE = 4.0;
  var ACCEL = 3.2;
  var BRAKE = 9.5;
  var ROLL = 1.25;            // 松踏板后的滚动阻力
  var STEER_MAX = 0.55;       // 前轮最大转角 rad
  var STEER_RATE = 1.9;

  /* 可行驶范围：港区陆域，z 方向留出码头前沿 */
  var BOUNDS = { x0: -150, x1: 160, z0: -140, z1: 12.2 };

  var DRIVE_KEYS = {
    KeyW: 1, KeyS: 1, KeyA: 1, KeyD: 1, Space: 1,
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1
  };

  var hudT = 0;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function editable(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  function clearInput() {
    keys = {};
    drag = null;
  }

  function wrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /* ---------------- 驾驶室内饰 ---------------- */
  function buildInterior() {
    var g = new THREE.Group();
    g.name = '货车驾驶室内饰';
    var shell = new THREE.MeshStandardMaterial({ color: 0x2b3a48, roughness: 0.72, metalness: 0.18 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x1b232b, roughness: 0.85 });
    var glow = new THREE.MeshStandardMaterial({ color: 0x123a3a, emissive: 0x0f4b46, roughness: 0.35 });

    function box(sx, sy, sz, px, py, pz, mat) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat || shell);
      m.position.set(px, py, pz);
      g.add(m);
      return m;
    }

    /* 仪表台：上缘压低，保留前方观察窗 */
    box(0.55, 0.32, 2.18, 5.24, 2.50, 0, shell);
    box(0.14, 0.20, 0.60, 5.06, 2.68, -0.56, glow);
    /* 方向盘（法向朝驾驶位） */
    var wheel = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.026, 8, 24), dark);
    wheel.position.set(4.72, 2.80, -0.56);
    wheel.rotation.y = Math.PI / 2;
    g.add(wheel);
    box(0.06, 0.06, 0.32, 4.72, 2.80, -0.56, dark);
    /* A 柱、风窗上沿（代替车顶遮挡上方）、遮阳板 */
    [-1, 1].forEach(function (s) { box(0.12, 1.82, 0.10, 5.50, 2.96, s * 1.16, shell); });
    box(0.12, 0.16, 2.30, 5.60, 3.56, 0, shell);
    box(0.46, 0.05, 1.36, 5.30, 3.42, -0.56, dark);
    /* 左侧门板、扶手与后视镜 */
    box(1.05, 0.52, 0.08, 4.55, 2.14, -1.18, shell);
    box(0.10, 0.32, 0.19, 5.60, 3.04, 1.28, dark);
    box(0.10, 0.32, 0.19, 5.60, 3.04, -1.32, dark);
    /* 雨刷 */
    box(0.03, 0.03, 0.86, 5.56, 2.42, 0.12, dark);

    g.visible = false;
    w.SCENE.truck.add(g);
    return g;
  }

  /* ---------------- 进入 / 退出 ---------------- */
  T.setActive = function (active, from) {
    if (!panel) return;
    if (active === T.active) return;

    if (active) {
      previousView = (from === 'free' || from === 'driver' || from === 'truck') ? 'iso' : from;
      if (w.DEMO) w.DEMO.stop();
      if (w.SCRIPT && w.SCRIPT.running) w.SCRIPT.stop();
      if (w.PY && w.PY.running) w.PY.stop();

      saved = {
        fov: w.SCENE.camera.fov,
        near: w.SCENE.camera.near,
        order: w.SCENE.camera.rotation.order,
      };
      T.active = true;
      clearInput();
      var p = w.SCENE.truckPose;
      T.x = p.x; T.z = p.z; T.heading = p.heading;
      T.speed = 0; T.steer = 0;
      lookYaw = 0; lookPitch = -0.03;

      w.SCENE.controls.enabled = false;
      w.SCENE.camera.fov = 72;
      w.SCENE.camera.near = 0.04;
      w.SCENE.camera.rotation.order = 'YXZ';
      w.SCENE.camera.updateProjectionMatrix();

      panel.classList.remove('hidden');
      document.body.classList.add('truck-mode');
      interior.visible = true;
      if (w.SCENE.truckGlass) {
        w.SCENE.truckGlass.forEach(function (m) { m.visible = false; });
      }
      /* 外壳从车内看会挡住视线（车顶底面等），驾驶时隐藏，仅保留内饰 */
      if (w.SCENE.truckCabShell) w.SCENE.truckCabShell.visible = false;
      document.getElementById('truck-state').textContent = '停放';
      T.updateCamera();
    } else {
      clearInput();
      T.active = false;
      T.speed = 0; T.steer = 0;
      panel.classList.add('hidden');
      document.body.classList.remove('truck-mode');
      interior.visible = false;
      if (w.SCENE.truckGlass) {
        w.SCENE.truckGlass.forEach(function (m) { m.visible = true; });
      }
      if (w.SCENE.truckCabShell) w.SCENE.truckCabShell.visible = true;
      if (saved) {
        w.SCENE.camera.fov = saved.fov;
        w.SCENE.camera.near = saved.near;
        w.SCENE.camera.rotation.order = saved.order;
        w.SCENE.camera.updateProjectionMatrix();
      }
    }
  };

  /* ---------------- 车位姿复位 ---------------- */
  T.reset = function () {
    w.SCENE.resetTruck();
    T.x = w.CFG.scene.truck.x;
    T.z = w.CFG.scene.truck.z;
    T.heading = 0;
    T.speed = 0; T.steer = 0;
    lookYaw = 0; lookPitch = -0.03;
    T.update(0.0001);
    T.updateCamera();
  };

  /* ---------------- 视线中心（看向抓斗） ---------------- */
  T.center = function () {
    var gp = w.KT.ST.grabPos;
    eye.set(w.SCENE.truckCab.x, w.SCENE.truckCab.y, w.SCENE.truckCab.z);
    w.SCENE.truck.localToWorld(eye);
    var dx = gp.x - eye.x, dy = gp.y - eye.y, dz = gp.z - eye.z;
    lookYaw = wrap(Math.atan2(-dz, dx) - T.heading);
    lookPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.0, 0.7);
  };

  /* ---------------- 每帧驾驶 ---------------- */
  T.update = function (dt) {
    if (!T.active) return;
    dt = Math.min(dt, 0.05);

    var up = keys.KeyW || keys.ArrowUp;
    var down = keys.KeyS || keys.ArrowDown;
    var left = keys.KeyA || keys.ArrowLeft;
    var right = keys.KeyD || keys.ArrowRight;
    var brake = keys.Space;

    if (up) T.speed += ACCEL * dt;
    if (down) T.speed -= ACCEL * dt;
    if (brake) {
      T.speed -= Math.sign(T.speed) * Math.min(Math.abs(T.speed), BRAKE * dt);
    } else if (!up && !down) {
      T.speed -= Math.sign(T.speed) * Math.min(Math.abs(T.speed), ROLL * dt);
    }
    T.speed = clamp(T.speed, -MAX_REVERSE, MAX_SPEED);

    /* 前轮转角一阶趋近，松手自动回正 */
    var steerIn = (left ? 1 : 0) - (right ? 1 : 0);
    var steerTo = steerIn * STEER_MAX;
    var step = STEER_RATE * dt;
    T.steer += clamp(steerTo - T.steer, -step, step);

    if (Math.abs(T.speed) > 0.02 && Math.abs(T.steer) > 1e-4) {
      T.heading = wrap(T.heading + (T.speed / WHEELBASE) * Math.tan(T.steer) * dt);
    }

    var nx = T.x + Math.cos(T.heading) * T.speed * dt;
    var nz = T.z - Math.sin(T.heading) * T.speed * dt;

    /* 港区边界：撞到边界就卸掉速度，避免穿到海里或场外 */
    if (nx < BOUNDS.x0 || nx > BOUNDS.x1) { nx = clamp(nx, BOUNDS.x0, BOUNDS.x1); T.speed *= 0.2; }
    if (nz < BOUNDS.z0 || nz > BOUNDS.z1) { nz = clamp(nz, BOUNDS.z0, BOUNDS.z1); T.speed *= 0.2; }

    T.x = nx; T.z = nz;
    w.SCENE.setTruckPose(T.x, T.z, T.heading);

    T.moving = Math.abs(T.speed) > 0.3;

    hudT += dt;
    if (hudT > 0.1) { hudT = 0; updateHud(); }
  };

  function updateHud() {
    var vol = w.DEMO ? w.DEMO.truckVolume : 0;
    var cap = w.CFG.scene.truck.capacity;
    var d = Math.hypot(T.x - w.CFG.scene.truck.x, T.z - w.CFG.scene.truck.z);
    var gear = T.speed > 0.3 ? '前进' : (T.speed < -0.3 ? '倒车' : '驻车');
    var el = document.getElementById('truck-instruments');
    if (el) {
      el.textContent = '车速 ' + Math.abs(T.speed * 3.6).toFixed(1) + ' km/h · ' + gear +
        ' · 车斗 ' + vol.toFixed(1) + ' / ' + cap + ' 斗' +
        ' · 位置 X ' + T.x.toFixed(1) + ' / Z ' + T.z.toFixed(1) +
        ' · 距卸料位 ' + d.toFixed(1) + ' m';
    }
    var st = document.getElementById('truck-state');
    if (st) st.textContent = T.moving ? '行驶中' : (T.speed === 0 ? '停放' : '怠速');
  }

  /* ---------------- 驾驶位相机 ---------------- */
  T.updateCamera = function () {
    if (!T.active) return;
    var cam = w.SCENE.camera;
    var truck = w.SCENE.truck;
    truck.updateMatrixWorld(true);

    eye.set(w.SCENE.truckCab.x, w.SCENE.truckCab.y, w.SCENE.truckCab.z);
    truck.localToWorld(eye);
    cam.position.copy(eye);

    var yaw = T.heading + lookYaw;
    cam.rotation.set(lookPitch, yaw - Math.PI / 2, 0, 'YXZ');

    dir.set(-Math.sin(yaw), Math.sin(lookPitch), -Math.cos(yaw)).normalize();
    target.copy(eye).addScaledVector(dir, 30);
    w.SCENE.controls.target.copy(target);
  };

  /* ---------------- 输入 ---------------- */
  function onKeyDown(e) {
    if (!T.active || editable(e.target)) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      w.SCENE.applyView(previousView);
      return;
    }
    if (e.code === 'KeyR') {
      e.preventDefault();
      T.reset();
      return;
    }
    if (!DRIVE_KEYS[e.code] || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target !== canvas && !panel.contains(e.target)) return;
    e.preventDefault();
    keys[e.code] = true;
  }

  function onKeyUp(e) {
    delete keys[e.code];
  }

  function onPointerDown(e) {
    if (!T.active || e.button !== 0) return;
    canvas.focus({ preventScroll: true });
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!T.active || !drag || drag.id !== e.pointerId) return;
    lookYaw = clamp(lookYaw - (e.clientX - drag.x) * 0.003, -2.4, 2.4);
    lookPitch = clamp(lookPitch - (e.clientY - drag.y) * 0.003, -1.0, 0.7);
    drag.x = e.clientX;
    drag.y = e.clientY;
  }

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
  }

  T.init = function () {
    panel = document.getElementById('truck-panel');
    canvas = w.SCENE.renderer.domElement;
    if (!panel || !canvas || !w.SCENE.truck) return;
    interior = buildInterior();

    document.getElementById('truck-exit').addEventListener('click', function () {
      w.SCENE.applyView(previousView);
    });
    document.getElementById('truck-reset').addEventListener('click', function () {
      T.reset();
      canvas.focus({ preventScroll: true });
    });
    document.getElementById('truck-center').addEventListener('click', function () {
      T.center();
      canvas.focus({ preventScroll: true });
    });

    w.addEventListener('keydown', onKeyDown);
    w.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    w.addEventListener('blur', clearInput);
    document.addEventListener('visibilitychange', function () { if (document.hidden) clearInput(); });
    document.addEventListener('focusin', function (e) {
      if (T.active && (editable(e.target) || (e.target !== canvas && !panel.contains(e.target)))) clearInput();
    });
  };

  w.TRUCK_DRIVER = T;
})(window);
