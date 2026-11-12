/* =============================================================
 * kinematics.js — 四连杆变幅运动学 + 抓斗开合 + 吊物摆动
 *
 * 机构链：
 *   α（臂架仰角）
 *     → B = A + L1·u(α)                     臂架头
 *     → D：|DB|=rd、|DE|=L3 的两圆交点       大拉杆连接点
 *     → C = B + rc·u(φ_BD + β)               象鼻梁前端抓斗滑轮
 *   C 点高度在 30°~50° 全程仅变化 0.05 m —— 水平变幅完全由四连杆
 *   几何实现，不依赖卷筒补偿。
 *
 * 摆动：θ̈ = −(g/l)θ − 2ζ√(g/l)θ̇ − a_C/l，1/240 s 定步长。
 * ============================================================= */
(function (w) {
  'use strict';

  var V3 = THREE.Vector3;
  var C = w.CFG;
  var G = 9.81;
  var SUB = 1 / 240;

  var KT = {};

  /* ---------------- 状态 ---------------- */
  var ST = {
    cmd: { slew: 0, alpha: 40, hoist: 12, travel: 0, grab: 0 },

    slew: 0, alpha: U.rad(40), travel: 0, hoist: 12,
    grabOpen: 0,          // 0 闭合 ~ 1 全开
    load: 0,              // 斗内物料 0~1
    releasedLoad: 0,      // 本帧实际流出的物料（满斗当量），供接料计量使用
    holdLevel: 2.55,      // 舱内料面高度（世界 y），随抓取下降
    holdRemain: 1,        // 舱内剩余比例
    grabPrev: 1,          // 上一帧开度
    grabMaxOpen: 1,       // 本次张开动作达到的最大开度
    grabDone: false,      // 本次闭斗是否已判定
    grabRate: 0,          // 本次抓取的填充率（显示用）
    lastGrabInfo: '—',

    /* 四连杆解（局部坐标，相对转台顶面） */
    B: { x: 0, y: 0 },
    D: { x: 0, y: 0 },
    Cl: { x: 0, y: 0 },
    phiBD: 0,
    phiBC: 0,

    Cworld: new V3(25, 34, 0),
    grabPos: new V3(25, 12, 0),   // 抓斗顶部吊点
    swayDir: new V3(0, -1, 0),
    ropeLen: 20,
    radius: 25,
    height: 12,

    thx: 0, thz: 0, thvx: 0, thvz: 0,

    vRope: 0, vTip: 0, vLuff: 0, vSlew: 0, vTravel: 0, vGrab: 0,

    timeScale: 1,         // 仿真倍速（时间缩放）
    rateMode: false,      // 回转角速度直控（轨迹规划实验用）
    rateCmd: 0,           // 直控角速度 rad/s
    driverMode: false,

    /* showTags：标注常显开关。默认关闭 —— 部件名称只在鼠标悬停到该部件时才出现 */
    showRadius: true, showTrace: false, showTags: false, showGrid: true,
    traceDirty: false,
    swayOn: true,
  };
  KT.ST = ST;

  var vel = { slew: 0, alpha: 0, travel: 0, hoist: 0, grab: 0 };
  var bPrev1 = new V3(), bPrev2 = new V3(), bInit = 0;
  var aFx = 0, aFz = 0;
  var acc = 0;
  var driverInput = { slew: 0, alpha: 0, hoist: 0, travel: 0, grab: 0 };
  var driverAxes = Object.keys(driverInput);
  var driverBounds = {
    slew: [-Math.PI, Math.PI], alpha: [U.rad(C.upper.alphaMin), U.rad(C.upper.alphaMax)],
    hoist: [C.hoist.minHeight, C.hoist.maxHeight], travel: [C.travel.min, C.travel.max], grab: [0, 1]
  };

  KT.drive = function (input) {
    driverAxes.forEach(function (key) { driverInput[key] = U.clamp(input[key] || 0, -1, 1); });
  };

  KT.stopDriver = function () {
    KT.drive({});
    Object.keys(vel).forEach(function (key) { vel[key] = 0; });
    ST.rateMode = false; ST.rateCmd = 0;
    ST.cmd.slew = U.deg(ST.slew); ST.cmd.alpha = U.deg(ST.alpha);
    ST.cmd.hoist = ST.hoist; ST.cmd.travel = ST.travel; ST.cmd.grab = ST.grabOpen;
  };

  KT.enableDriver = function (active) {
    if (active) ST.slew = Math.atan2(Math.sin(ST.slew), Math.cos(ST.slew));
    KT.stopDriver();
    ST.driverMode = active;
  };

  var tau = { slew: 1.10, alpha: 0.85, travel: 1.20, hoist: 0.42, grab: 0.30 };
  var VMAX = (function () {
    var s = C.speed;
    return {
      slew: s.slew * 2 * Math.PI / 60,
      alpha: s.luff * Math.PI / 180 * 2.2,
      travel: s.travel,
      hoist: s.hoist,
      grab: 1 / s.grab,
    };
  })();

  /* ---------------- 四连杆解算 ---------------- */
  var _C = { x: 0, y: 0 };

  function solve(alpha) {
    var up = C.upper;
    var bx = up.pivot.x + up.jibLength * Math.cos(alpha);
    var by = up.pivot.y + up.jibLength * Math.sin(alpha);

    var ex = up.apex.x, ey = up.apex.y;
    var r1 = up.head.rd, r2 = up.tieRod;
    var dx = ex - bx, dy = ey - by;
    var d = Math.hypot(dx, dy);
    var ok = !(d < 1e-6 || d > r1 + r2 || d < Math.abs(r1 - r2));

    if (ok) {
      var k = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
      var h = Math.sqrt(Math.max(r1 * r1 - k * k, 0));
      var dxn = dx / d, dyn = dy / d;
      var mx = bx + k * dxn, my = by + k * dyn;
      var px = mx - dyn * h, py = my + dxn * h;
      var qx = mx + dyn * h, qy = my - dxn * h;
      if (py >= qy) { ST.D.x = px; ST.D.y = py; }
      else { ST.D.x = qx; ST.D.y = qy; }
    } else {
      ST.D.x = bx; ST.D.y = by + r1;
    }

    ST.B.x = bx; ST.B.y = by;
    ST.phiBD = Math.atan2(ST.D.y - by, ST.D.x - bx);
    ST.phiBC = ST.phiBD + U.rad(up.head.beta);

    _C.x = bx + up.head.rc * Math.cos(ST.phiBC);
    _C.y = by + up.head.rc * Math.sin(ST.phiBC);
    ST.Cl.x = _C.x; ST.Cl.y = _C.y;
    return _C;
  }

  KT.solve = solve;
  KT.clocal = function () { return ST.Cl; };

  /* 由幅度反解臂架仰角 */
  KT.alphaForRadius = function (R) {
    var lo = U.rad(C.upper.alphaMin), hi = U.rad(C.upper.alphaMax);
    var f = function (a) { solve(a); return ST.Cl.x - R; };
    if (f(lo) * f(hi) > 0) return R > ST.Cl.x ? lo : hi;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  };

  KT.amplitude = function (alpha) {
    solve(alpha);
    return ST.Cl.x;
  };

  KT.ratedLoad = function (r) {
    var t = C.loadCurve;
    if (r <= t[0][0]) return t[0][1];
    for (var i = 0; i < t.length - 1; i++) {
      if (r <= t[i + 1][0]) {
        var k = (r - t[i][0]) / (t[i + 1][0] - t[i][0]);
        return U.lerp(t[i][1], t[i + 1][1], k);
      }
    }
    return t[t.length - 1][1];
  };

  /* ---------------- 命令 ---------------- */
  KT.set = function (key, val) {
    if (key === 'alpha') {
      ST.cmd.alpha = U.clamp(val, C.upper.alphaMin, C.upper.alphaMax);
    } else if (key === 'slew') {
      ST.cmd.slew = val;
    } else if (key === 'travel') {
      ST.cmd.travel = U.clamp(val, C.travel.min, C.travel.max);
    } else if (key === 'hoist') {
      ST.cmd.hoist = U.clamp(val, C.hoist.minHeight, C.hoist.maxHeight);
    } else if (key === 'grab') {
      ST.cmd.grab = U.clamp(val, 0, 1);
    }
  };

  KT.setRadius = function (R) {
    ST.cmd.alpha = U.deg(KT.alphaForRadius(R));
  };

  KT.setLoad = function (v) { ST.load = v; };

  /* 舱内料面：随剩余量下降（满载 2.55 m → 见底 1.05 m） */
  function updateHoldLevel() {
    ST.holdLevel = U.lerp(1.05, C.scene.ship.holdY, Math.pow(ST.holdRemain, 0.7));
  }
  KT.updateHoldLevel = updateHoldLevel;

  /* 闭斗抓取：填充率由插入深度、闭斗瞬间开度、舱内余量共同决定 */
  KT.settleGrab = function () {
    var g = C.grab;
    var bottom = ST.grabPos.y - g.height;        // 抓斗底高度
    var depth = ST.holdLevel - bottom;           // 插入料面的深度
    var openF = U.clamp((ST.grabMaxOpen - 0.25) / 0.68, 0, 1); // 半开闭斗兜得少
    var depthF = U.clamp(depth / 1.15, 0, 1);    // 插入 1.15 m 即满斗
    var soilF = U.clamp(ST.holdRemain * 1.6, 0.12, 1);        // 见底时抓不满
    var fill = U.clamp(depthF * openF * soilF, 0, 1);

    ST.load = fill;
    ST.grabRate = fill;

    var cap = C.scene.ship.capacity;             // 舱容（斗数）
    ST.holdRemain = Math.max(0, ST.holdRemain - fill / cap);
    updateHoldLevel();

    ST.lastGrabInfo = '插深 ' + depth.toFixed(2) + ' m · 开度 ' +
      Math.round(ST.grabMaxOpen * 100) + '% · 填充 ' + Math.round(fill * 100) + '%';
    return fill;
  };

  /* 每帧检测闭斗瞬间；张开时物料自然流出 */
  KT.updateGrab = function (dt) {
    ST.releasedLoad = 0;
    ST.sandFlow = 0;
    if (dt <= 0) return;
    /* 完全闭合后为下一次张开重置记录 */
    if (ST.grabOpen < 0.05 && ST.grabPrev >= 0.05) {
      ST.grabMaxOpen = 0;
      ST.grabDone = false;
    }
    if (ST.grabOpen > ST.grabMaxOpen) ST.grabMaxOpen = ST.grabOpen;

    /* 闭斗瞬间判定一次 */
    if (!ST.grabDone && ST.grabPrev >= 0.55 && ST.grabOpen < 0.55 && ST.load < 0.15) {
      ST.grabDone = true;
      KT.settleGrab();
    }
    /* 开口保持张开时继续流料；闭斗时停止。不能只在开度变化的帧卸料，
       否则到达全开后会残留物料。 */
    var opening = ST.grabOpen > ST.grabPrev + 1e-4;
    var heldOpen = ST.driverMode ? vel.grab >= -1e-4 && driverInput.grab >= 0 : ST.cmd.grab >= ST.grabOpen - 1e-4;
    if ((opening || heldOpen) && ST.grabOpen > 0.35 && ST.load > 0) {
      ST.releasedLoad = Math.min(ST.load, dt / 0.9);
      ST.load = Math.max(0, ST.load - ST.releasedLoad);
      ST.sandFlow = U.clamp(ST.releasedLoad * 0.9 / dt, 0, 1);
    }
    ST.grabPrev = ST.grabOpen;
  };

  /* 与抓斗渲染相同的回转/摆动姿态，返回斗底出料口的世界坐标。 */
  KT.grabOutlet = function (out) {
    var d = ST.swayDir, h = C.grab.height, cs = Math.cos(ST.slew), sn = Math.sin(ST.slew);
    return out.set(ST.grabPos.x + h * (d.x * cs + d.z * sn),
      ST.grabPos.y + h * d.y, ST.grabPos.z + h * (-d.x * sn + d.z * cs));
  };

  /* ---------------- 跟随 ---------------- */
  function follow(key, target, vmax, tc, h, stateKey) {
    stateKey = stateKey || key;
    var d = target - ST[stateKey];
    var vDes = U.clamp(d * 4, -vmax, vmax);
    vel[key] = U.smooth(vel[key], vDes, tc, h);
    var next = ST[stateKey] + vel[key] * h;
    if ((target - next) * d <= 0) { next = target; vel[key] = 0; }
    ST[stateKey] = next;
  }

  /* ---------------- 主更新 ---------------- */
  /* 倍速：只压缩时间轴，物理子步长恒定，因此摆动等动力学仍然稳定 */
  KT.setTimeScale = function (v) {
    ST.timeScale = U.clamp(v, 0.1, 8);
  };

  /* 直接给定回转角速度（°/s），负值反转；用于轨迹规划对比实验 */
  KT.setSlewRate = function (dps) {
    ST.rateMode = true;
    ST.rateCmd = U.rad(U.clamp(Number(dps) || 0, -30, 30));
  };

  /* 退出直控：把当前实际角写回目标，避免松手瞬间回弹 */
  KT.releaseSlewRate = function () {
    if (!ST.rateMode) return;
    ST.rateMode = false;
    ST.rateCmd = 0;
    ST.cmd.slew = U.deg(ST.slew);
    vel.slew = 0;
  };

  KT.update = function (dt) {
    /* dt 已由调用方乘过倍速；上限按 4×@20fps 留余量 */
    dt = Math.min(dt, 0.22);
    acc += dt;
    var guard = 0;
    while (acc >= SUB && guard < 56) {
      substep(SUB);
      acc -= SUB;
      guard++;
    }
    if (guard >= 56) acc = 0;
    finalize();
  };

  function substep(h) {
    if (ST.driverMode) {
      driverAxes.forEach(function (key) {
        var stateKey = key === 'grab' ? 'grabOpen' : key;
        vel[key] = U.smooth(vel[key], driverInput[key] * VMAX[key], tau[key], h);
        var next = ST[stateKey] + vel[key] * h;
        ST[stateKey] = U.clamp(next, driverBounds[key][0], driverBounds[key][1]);
        if (next !== ST[stateKey]) vel[key] = 0;
        ST.cmd[key] = key === 'slew' || key === 'alpha' ? U.deg(ST[stateKey]) : ST[stateKey];
      });
    } else {
      if (ST.rateMode) {
        /* 直控模式：按给定角速度积分，用于复现手动/梯形/S 型/优化 S 型轨迹 */
        ST.slew += ST.rateCmd * h;
        vel.slew = ST.rateCmd;
      } else {
        follow('slew', U.rad(ST.cmd.slew), VMAX.slew, tau.slew, h);
      }
      follow('alpha', U.rad(ST.cmd.alpha), VMAX.alpha, tau.alpha, h);
      follow('travel', ST.cmd.travel, VMAX.travel, tau.travel, h);
      follow('hoist', ST.cmd.hoist, VMAX.hoist, tau.hoist, h);
      follow('grab', ST.cmd.grab, VMAX.grab, tau.grab, h, 'grabOpen');
    }

    var c = solve(ST.alpha);

    var y0 = C.machine.portalHeight + C.machine.slewBearingH;
    var cw = Math.cos(ST.slew), sw = Math.sin(ST.slew);
    var Cx = ST.travel + c.x * cw;
    var Cz = -c.x * sw;
    var Cy = c.y + y0;

    var gH = C.grab.height;
    ST.ropeLen = Math.max(Cy - ST.hoist - gH, 1.4);
    var l = ST.ropeLen;

    /* 吊点加速度（二阶差分 + 低通） */
    if (bInit < 2) {
      bPrev2.set(Cx, Cy, Cz); bPrev1.set(Cx, Cy, Cz); bInit++;
      aFx = 0; aFz = 0;
    } else {
      var ax = (Cx - 2 * bPrev1.x + bPrev2.x) / (h * h);
      var az = (Cz - 2 * bPrev1.z + bPrev2.z) / (h * h);
      var kk = 1 - Math.exp(-h / 0.05);
      aFx += (ax - aFx) * kk;
      aFz += (az - aFz) * kk;
      bPrev2.copy(bPrev1);
      bPrev1.set(Cx, Cy, Cz);
    }

    /* 摆动积分 */
    if (ST.swayOn) {
      var w2 = G / Math.max(l, 2.0);
      var damp = 2 * C.sway.damping * Math.sqrt(w2);
      var wind = w.WEATHER ? w.WEATHER.acceleration() : { x: 0, z: 0 };
      ST.thvx += (-w2 * ST.thx - damp * ST.thvx + (wind.x - aFx) / l) * h;
      ST.thvz += (-w2 * ST.thz - damp * ST.thvz + (wind.z - aFz) / l) * h;
      ST.thx += ST.thvx * h;
      ST.thz += ST.thvz * h;
      var lim = C.sway.maxAngle;
      if (ST.thx > lim) { ST.thx = lim; ST.thvx = Math.min(ST.thvx, 0); }
      if (ST.thx < -lim) { ST.thx = -lim; ST.thvx = Math.max(ST.thvx, 0); }
      if (ST.thz > lim) { ST.thz = lim; ST.thvz = Math.min(ST.thvz, 0); }
      if (ST.thz < -lim) { ST.thz = -lim; ST.thvz = Math.max(ST.thvz, 0); }
    } else {
      ST.thx = ST.thz = ST.thvx = ST.thvz = 0;
      aFx = aFz = 0;
    }

    var nrm = Math.sqrt(ST.thx * ST.thx + ST.thz * ST.thz + 1);
    var dx = ST.thx / nrm, dy = -1 / nrm, dz = ST.thz / nrm;
    ST.swayDir.set(dx, dy, dz);

    ST.Cworld.set(Cx, Cy, Cz);
    ST.grabPos.set(
      Cx + l * dx,
      Math.max(Cy + l * dy, gH + 0.2),
      Cz + l * dz
    );
  }

  function finalize() {
    var gp = ST.grabPos;
    ST.height = gp.y - C.grab.height;
    ST.radius = Math.hypot(gp.x - ST.travel, gp.z);
    ST.traceDirty = true;
  }

  /* 速度测量（显示用） */
  var last = { alpha: 0, slew: 0, travel: 0, rope: 0, grab: 0 };
  KT.measure = function (dt) {
    if (dt <= 0) return;
    ST.vLuff = (ST.alpha - last.alpha) / dt * 180 / Math.PI;
    ST.vSlew = (ST.slew - last.slew) / dt * 180 / Math.PI;
    ST.vTravel = (ST.travel - last.travel) / dt;
    ST.vRope = -(ST.ropeLen - last.rope) / dt;
    ST.vGrab = (ST.grabOpen - last.grab) / dt;
    ST.vTip = Math.abs(ST.vSlew) * Math.PI / 180 * ST.radius;
    last.alpha = ST.alpha; last.slew = ST.slew;
    last.travel = ST.travel; last.rope = ST.ropeLen;
    last.grab = ST.grabOpen;
  };

  KT.reset = function () {
    ST.cmd.slew = 0; ST.cmd.alpha = 40; ST.cmd.hoist = 12;
    ST.rateMode = false; ST.rateCmd = 0;
    ST.cmd.travel = 0; ST.cmd.grab = 0;
    ST.thx = ST.thz = ST.thvx = ST.thvz = 0;
    ST.load = 0;
    ST.releasedLoad = 0; ST.sandFlow = 0;
    ST.grabPrev = ST.grabOpen; ST.grabDone = false; ST.grabMaxOpen = ST.grabOpen;
    if (w.DEMO && w.DEMO.resetCargo) w.DEMO.resetCargo();
    ST.holdRemain = 1;
    ST.grabRate = 0;
    updateHoldLevel();
    aFx = aFz = 0; bInit = 0;
  };

  KT.snap = function () {
    ST.slew = U.rad(ST.cmd.slew);
    ST.alpha = U.rad(ST.cmd.alpha);
    ST.travel = ST.cmd.travel;
    ST.hoist = ST.cmd.hoist;
    ST.grabOpen = ST.cmd.grab;
    ST.thx = ST.thz = ST.thvx = ST.thvz = 0;
    aFx = aFz = 0; bInit = 0;
    vel.slew = vel.alpha = vel.travel = vel.hoist = vel.grab = 0;
    substep(SUB);
    substep(SUB);
    finalize();
  };

  w.KT = KT;
})(window);
