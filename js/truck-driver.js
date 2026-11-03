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

    var dash = new THREE.MeshStandardMaterial({ color: 0x1e2429, roughness: 0.85, metalness: 0.06 });
    var trim = new THREE.MeshStandardMaterial({ color: 0x2b333a, roughness: 0.72, metalness: 0.12 });
    var panel = new THREE.MeshStandardMaterial({ color: 0x3d464e, roughness: 0.78, metalness: 0.10 });
    var seat = new THREE.MeshStandardMaterial({ color: 0x453931, roughness: 0.95, metalness: 0.02 });
    var head = new THREE.MeshStandardMaterial({ color: 0x5a626a, roughness: 0.92, metalness: 0.02 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x151a1f, roughness: 0.86 });
    var glow = new THREE.MeshStandardMaterial({ color: 0x0e3a38, emissive: 0x0b5a52, emissiveIntensity: 0.9, roughness: 0.3 });
    var metal = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.42, metalness: 0.65 });

    function box(sx, sy, sz, px, py, pz, mat) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat || dash);
      m.position.set(px, py, pz);
      g.add(m);
      return m;
    }
    function tilt(sx, sy, sz, px, py, pz, ang, mat) {
      var m = box(sx, sy, sz, px, py, pz, mat);
      m.rotation.z = ang;
      return m;
    }
    function disc(r, thick, px, py, pz, mat) {
      var geo = new THREE.CylinderGeometry(r, r, thick, 20).rotateZ(Math.PI / 2);
      var m = new THREE.Mesh(geo, mat || trim);
      m.position.set(px, py, pz);
      g.add(m);
      return m;
    }

    /* 地板与脚垫 */
    box(1.92, 0.06, 2.20, 4.55, 1.31, 0, dark);
    box(1.24, 0.02, 1.46, 4.72, 1.35, -0.30, trim);

    /* 仪表台：台体、上盖、仪表罩 */
    box(0.55, 0.62, 2.22, 5.20, 2.33, 0, dash);
    box(0.54, 0.08, 2.24, 5.20, 2.62, 0, trim);
    box(0.10, 0.30, 0.94, 4.89, 2.70, -0.58, trim);
    /* 两个圆表 + 指针 */
    [-0.80, -0.42].forEach(function (z, i) {
      disc(0.095, 0.02, 4.835, 2.72, z, dark);
      var nd = box(0.012, 0.072, 0.012, 4.825, 2.745, z, metal);
      nd.rotation.z = 0.5 + i * 0.6;
    });
    box(0.02, 0.05, 0.34, 4.828, 2.52, -0.58, glow);
    /* 中控：收音机、出风口、旋钮 */
    box(0.10, 0.42, 0.62, 4.90, 2.18, 0.30, trim);
    box(0.02, 0.16, 0.34, 4.838, 2.24, 0.30, glow);
    [-0.14, 0.14].forEach(function (dz) { box(0.02, 0.06, 0.05, 4.838, 2.06, 0.30 + dz, metal); });
    [-0.34, 0.34].forEach(function (z) { box(0.04, 0.14, 0.26, 4.88, 2.44, z, dark); });
    /* 仪表台两侧出风口 */
    [-1, 1].forEach(function (s) {
      box(0.03, 0.12, 0.26, 4.90, 2.46, s * 0.92, dark);
    });

    /* 方向盘：三辐 + 转向柱 + 喇叭 */
    var wheel = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.024, 8, 26), dark);
    wheel.position.set(4.60, 2.66, -0.56);
    wheel.rotation.y = Math.PI / 2;
    g.add(wheel);
    for (var sp = 0; sp < 3; sp++) {
      var spoke = box(0.03, 0.03, 0.17, 4.60, 2.66, -0.56, trim);
      spoke.rotation.x = sp * Math.PI * 2 / 3;
      spoke.position.z = -0.56 + Math.sin(sp * Math.PI * 2 / 3) * 0.09;
      spoke.position.y = 2.66 + Math.cos(sp * Math.PI * 2 / 3) * 0.09;
    }
    box(0.06, 0.09, 0.18, 4.60, 2.66, -0.56, trim);
    var column = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.30, 10).rotateZ(Math.PI / 2), trim);
    column.position.set(4.76, 2.62, -0.56);
    column.rotation.z = 0.30;
    g.add(column);

    /* 座椅（驾驶位 + 副驾）：坐垫、靠背、头枕、滑轨 */
    function seatAt(z) {
      box(0.60, 0.16, 0.62, 3.60, 2.00, z, seat);
      tilt(0.18, 0.86, 0.64, 3.34, 2.46, z, 0.14, seat);
      box(0.16, 0.26, 0.40, 3.26, 3.00, z, seat);
      box(0.05, 0.30, 0.05, 3.30, 2.70, z + 0.30, metal);
      box(0.05, 0.30, 0.05, 3.30, 2.70, z - 0.30, metal);
    }
    seatAt(-0.56);
    seatAt(0.62);
    box(0.90, 0.10, 1.86, 3.52, 1.94, 0, dark);

    /* 左/右门内饰板、扶手、把手、摇窗把 */
    [-1, 1].forEach(function (s) {
      box(1.48, 0.96, 0.06, 4.35, 2.22, s * 1.205, panel);
      box(0.56, 0.10, 0.14, 4.42, 1.98, s * 1.13, trim);
      box(0.15, 0.05, 0.05, 4.86, 2.30, s * 1.17, metal);
      box(0.10, 0.10, 0.05, 3.98, 2.06, s * 1.175, trim);
    });

    /* A 柱、风窗框、顶棚、遮阳板、内后视镜 */
    [-1, 1].forEach(function (s) {
      var ap = tilt(0.12, 1.40, 0.10, 5.48, 2.96, s * 1.10, 0.12, panel);
      ap.rotation.x = s * 0.05;
      box(0.10, 0.10, 0.10, 5.58, 2.34, s * 1.10, dark);
    });
    box(0.16, 0.16, 2.22, 5.46, 3.50, 0, trim);
    box(0.08, 0.10, 2.20, 5.56, 2.32, 0, dark);
    box(1.58, 0.05, 2.14, 4.55, 3.62, 0, head);
    [-1, 1].forEach(function (s) {
      var visor = box(0.32, 0.04, 0.86, 5.24, 3.38, s * 0.55, trim);
      visor.rotation.z = 0.18;
    });
    box(0.06, 0.20, 0.10, 5.30, 3.24, 0.02, dark);
    box(0.03, 0.06, 0.26, 5.29, 3.16, 0.02, dark);

    /* 后围、后窗、卧铺搁板 */
    box(0.10, 2.06, 2.30, 3.30, 2.42, 0, panel);
    box(0.04, 0.46, 0.96, 3.35, 3.10, 0, dark);
    box(0.52, 0.06, 2.04, 3.12, 2.14, 0, trim);

    /* 换挡杆、手刹、踏板、水杯座 */
    var lever = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.44, 8), metal);
    lever.position.set(4.58, 2.17, 0.32);
    lever.rotation.z = -0.26;
    g.add(lever);
    var knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), dark);
    knob.position.set(4.52, 2.40, 0.32);
    g.add(knob);
    box(0.18, 0.10, 0.24, 4.62, 1.95, 0.32, dark);
    var brake = box(0.06, 0.28, 0.05, 4.52, 2.12, 0.62, metal);
    brake.rotation.x = 0.35;
    [-0.92, -0.55, -0.18].forEach(function (z, i) {
      var p = box(0.20, 0.05, 0.11, 5.14, 1.60 + i * 0.02, z, i === 2 ? metal : dark);
      p.rotation.z = 0.35;
    });
    box(0.14, 0.18, 0.14, 4.80, 1.92, 0.06, trim);

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

    /* 车轮随车速滚动，前轮跟着方向偏转 */
    if (w.SCENE.truckWheels) {
      var dSpin = T.speed * dt / 0.74;
      for (var i = 0; i < w.SCENE.truckWheels.length; i++) {
        var wh = w.SCENE.truckWheels[i];
        wh.spin += dSpin;
        wh.grp.rotation.set(0, wh.front ? T.steer : 0, wh.spin);
      }
    }

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
