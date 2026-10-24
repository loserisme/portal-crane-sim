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

    showRadius: true, showTrace: false, showTags: true, showGrid: true,
    traceDirty: false,
    swayOn: true,
  };
  KT.ST = ST;

  var vel = { slew: 0, alpha: 0, travel: 0, hoist: 0, grab: 0 };
  var bPrev1 = new V3(), bPrev2 = new V3(), bInit = 0;
  var aFx = 0, aFz = 0;
  var acc = 0;

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
    /* 只有张开动作才卸料；闭斗过程不流料 */
    var opening = ST.grabOpen > ST.grabPrev + 1e-4;
    if (opening && ST.grabOpen > 0.35 && ST.load > 0) {
      ST.load = Math.max(0, ST.load - dt / 0.9);
    }
    ST.grabPrev = ST.grabOpen;
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
    follow('slew', U.rad(ST.cmd.slew), VMAX.slew, tau.slew, h);
    follow('alpha', U.rad(ST.cmd.alpha), VMAX.alpha, tau.alpha, h);
    follow('travel', ST.cmd.travel, VMAX.travel, tau.travel, h);
    follow('hoist', ST.cmd.hoist, VMAX.hoist, tau.hoist, h);
    follow('grab', ST.cmd.grab, VMAX.grab, tau.grab, h, 'grabOpen');

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
      ST.thvx += (-w2 * ST.thx - damp * ST.thvx - aFx / l) * h;
      ST.thvz += (-w2 * ST.thz - damp * ST.thvz - aFz / l) * h;
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
    ST.cmd.travel = 0; ST.cmd.grab = 0;
    ST.thx = ST.thz = ST.thvx = ST.thvz = 0;
    ST.load = 0;
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
