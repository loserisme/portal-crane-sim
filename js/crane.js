/* =============================================================
 * crane.js — 抓斗门机三维模型（象鼻梁 + 大拉杆 + 平衡重 + 抓斗）
 *
 * 层级（世界 y 向上，大车沿 x 行走）：
 *   root                 大车行走平移
 *    ├ portal            门架 + 台车
 *    └ upper             绕 y 回转，原点 = 转台顶面
 *        ├ deck / house / cab
 *        ├ aframe         人字架 + 顶部滑轮 E
 *        ├ jibPivot(A, α) 臂架 AB + 尾部平衡杠杆与圆盘配重
 *        ├ headPivot(B)   象鼻梁 B-C-D，前端滑轮 C
 *        ├ tieRod         D → E 大拉杆
 *        ├ luffRope       变幅拉索
 *        └ ropeEB / ropeBC
 *   grab                 抓斗（世界坐标，含摆动）
 *   ropeCG               C → 抓斗 双股起升绳
 * ============================================================= */
(function (w) {
  'use strict';

  var V3 = THREE.Vector3;
  var UP = new V3(0, 1, 0);
  var DOWN = new V3(0, -1, 0);
  var C = w.CFG, U = w.U;

  var K = { ropeCG: [], viz: {}, mat: {} };

  var _t1 = new V3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

  /* ---------------------------------------------------------
   *  构建
   * --------------------------------------------------------- */
  K.build = function (scene) {
    var col = C.colors;
    K.mat = {
      steel: U.paint(col.steel, { metalness: 0.26, roughness: 0.58 }),
      steelDeep: U.paint(col.steelDeep, { metalness: 0.30, roughness: 0.55 }),
      cool: U.paint(col.steelCool, { metalness: 0.45, roughness: 0.50 }),
      dark: U.paint(col.dark, { metalness: 0.50, roughness: 0.55 }),
      deck: U.paint(col.deck, { metalness: 0.20, roughness: 0.70 }),
      house: U.paint(col.house, { metalness: 0.12, roughness: 0.78 }),
      rope: U.paint(col.rope, { metalness: 0.70, roughness: 0.45 }),
      grab: U.paint(col.grab, { metalness: 0.42, roughness: 0.48 }),
      sand: U.paint(col.sand, { metalness: 0.05, roughness: 0.96 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x2a3b4d, metalness: 0.85, roughness: 0.18,
        transparent: true, opacity: 0.74,
      }),
    };

    var root = new THREE.Group();
    scene.add(root);
    K.root = root;

    var upper = new THREE.Group();
    upper.position.set(0, C.machine.portalHeight + C.machine.slewBearingH, 0);
    root.add(upper);
    K.upper = upper;

    this._gantry(root);
    this._deck(upper);
    this._aframe(upper);
    this._jib(upper);
    this._head(upper);
    this._linkage(upper);
    this._ropes(upper, scene);
    this._grab(scene);
    this._viz(scene);
    return K;
  };

  /* ---------------- 门架与行走台车 ---------------- */
  K._gantry = function (root) {
    var m = C.machine;
    var hs = m.railSpan / 2, hb = m.wheelBase / 2, topY = m.portalHeight;
    var legs = [];

    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sz = -1; sz <= 1; sz += 2) {
        var foot = { x: sx * (hb - 0.15), y: 0.95, z: sz * (hs - 0.55) };
        var top = { x: sx * 3.22, y: topY - 0.05, z: sz * 3.22 };
        legs.push(U.member(foot, top, 0.64, 0.64));
        legs.push(U.box(0.78, 0.55, 0.78,
          (foot.x + top.x) / 2, (foot.y + top.y) / 2, (foot.z + top.z) / 2));
        legs.push(U.member(
          { x: sx * 2.5, y: topY - 1.9, z: sz * 2.45 },
          { x: sx * 1.2, y: topY - 0.25, z: sz * 1.15 }, 0.26, 0.26
        ));
      }
    }
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      var zb = s2 * (hs - 0.55);
      legs.push(U.member(
        { x: -(hb - 0.15), y: 1.05, z: zb },
        { x: (hb - 0.15), y: 1.05, z: zb }, 0.50, 0.62
      ));
      legs.push(U.member(
        { x: -(hb - 0.4), y: 1.45, z: zb },
        { x: 3.15, y: topY - 0.45, z: s2 * 3.05 }, 0.30, 0.30
      ));
      legs.push(U.member(
        { x: (hb - 0.4), y: 1.45, z: zb },
        { x: -3.15, y: topY - 0.45, z: s2 * 3.05 }, 0.30, 0.30
      ));
    }
    for (var x2 = -1; x2 <= 1; x2 += 2) {
      var xb = x2 * (hb - 0.15);
      legs.push(U.member(
        { x: xb, y: 1.05, z: -(hs - 0.55) },
        { x: xb, y: 1.05, z: (hs - 0.55) }, 0.50, 0.62
      ));
    }

    var gRing = new THREE.CylinderGeometry(4.55, 4.78, 0.55, 8);
    gRing.applyMatrix4(new THREE.Matrix4().makeTranslation(0, topY - 0.28, 0));
    legs.push(gRing);

    for (var i = 0; i < 8; i++) {
      var a0 = i * Math.PI / 4, a1 = a0 + Math.PI / 4, r0 = 4.56;
      legs.push(U.tube(
        { x: r0 * Math.cos(a0), y: topY + 0.66, z: r0 * Math.sin(a0) },
        { x: r0 * Math.cos(a1), y: topY + 0.66, z: r0 * Math.sin(a1) }, 0.045, 5
      ));
      legs.push(U.tube(
        { x: r0 * Math.cos(a0), y: topY + 0.02, z: r0 * Math.sin(a0) },
        { x: r0 * Math.cos(a0), y: topY + 0.66, z: r0 * Math.sin(a0) }, 0.04, 5
      ));
    }
    U.mesh(U.merge(legs), K.mat.steel, root);

    /* 台车 */
    var wheelGeoms = [], boxGeoms = [];
    for (var bx = -1; bx <= 1; bx += 2) {
      for (var bz = -1; bz <= 1; bz += 2) {
        var cx = bx * hb, cz = bz * hs;
        boxGeoms.push(U.box(3.2, 0.80, 1.60, cx, 1.12, cz));
        boxGeoms.push(U.box(1.05, 0.42, 1.72, cx, 1.64, cz));
        for (var kk = -1; kk <= 1; kk += 2) {
          for (var jj = -1; jj <= 1; jj += 2) {
            var wg = new THREE.CylinderGeometry(0.52, 0.52, 0.30, 16);
            wg.applyMatrix4(new THREE.Matrix4()
              .makeRotationX(Math.PI / 2)
              .premultiply(new THREE.Matrix4()
                .makeTranslation(cx + kk * 0.98, 0.66, cz + jj * 0.54)));
            wheelGeoms.push(wg);
          }
        }
      }
    }
    U.mesh(U.merge(boxGeoms), K.mat.cool, root);
    U.mesh(U.merge(wheelGeoms), K.mat.dark, root);
  };

  /* ---------------- 转台 / 机房 / 司机室 ---------------- */
  K._deck = function (upper) {
    var geoms = [];
    var ring = new THREE.CylinderGeometry(3.90, 4.02, 0.42, 28);
    ring.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.62, 0));
    geoms.push(ring);
    geoms.push(U.box(11.4, 0.78, 6.8, -1.60, -0.02, 0));
    var nose = new THREE.CylinderGeometry(3.40, 3.40, 0.78, 22, 1, false, -Math.PI / 2, Math.PI);
    nose.applyMatrix4(new THREE.Matrix4().makeTranslation(4.10, -0.02, 0));
    geoms.push(nose);
    U.mesh(U.merge(geoms), K.mat.deck, upper);

    var house = [
      U.box(7.4, 3.5, 6.3, -3.30, 2.15, 0),
      U.box(7.7, 0.20, 6.6, -3.30, 3.95, 0),
      U.box(1.7, 0.60, 1.7, -5.10, 4.32, 1.30),
      U.box(1.3, 0.45, 1.3, -1.30, 4.24, -1.90),
    ];
    U.mesh(U.merge(house), K.mat.house, upper);
    U.mesh(U.box(0.06, 0.90, 5.1, 0.44, 2.70, 0), K.mat.glass, upper, false);

    /* 变幅驱动：小齿轮 + 减速箱（与臂架扇形齿条啮合） */
    var rk2 = C.upper.rack;
    var pg = new THREE.CylinderGeometry(rk2.pinionR, rk2.pinionR, 0.58, 18);
    pg.applyMatrix4(new THREE.Matrix4()
      .makeRotationX(Math.PI / 2)
      .premultiply(new THREE.Matrix4()
        .makeTranslation(rk2.pinionAt.x, rk2.pinionAt.y, 0)));
    U.mesh(pg, K.mat.dark, upper);
    U.mesh(U.merge([
      U.box(1.35, 1.15, 1.30, rk2.pinionAt.x - 0.55, rk2.pinionAt.y - 1.05, 0),
      U.box(1.05, 0.75, 1.05, rk2.pinionAt.x - 1.75, rk2.pinionAt.y - 1.35, 0),
    ]), K.mat.steelDeep, upper);

    var cab = new THREE.Group();
    cab.position.set(2.95, 1.75, 2.60);
    U.mesh(U.box(2.15, 2.05, 2.15, 0, 0, 0), K.mat.house, cab);
    U.mesh(U.box(2.18, 1.15, 2.18, 0, 0.38, 0), K.mat.glass, cab, false);
    U.mesh(U.box(2.35, 0.14, 2.35, 0, 1.10, 0), K.mat.cool, cab);
    U.mesh(U.box(2.0, 0.30, 0.6, 0, -1.15, -0.7), K.mat.steel, cab);
    upper.add(cab);
    K.cab = cab;
  };

  /* ---------------- 塔架 + 人字架 ---------------- */
  K._aframe = function (upper) {
    var apex = C.upper.apex, A = C.upper.pivot;
    var geoms = [];
    var tb = 2.55, tt = 1.85, ty = 11.70;

    /* 塔架四角柱：从转台面直升到臂架铰点标高 */
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sz = -1; sz <= 1; sz += 2) {
        geoms.push(U.member(
          { x: sx * tb, y: 0.34, z: sz * tb },
          { x: sx * tt, y: ty, z: sz * tt }, 0.46, 0.46));
      }
    }
    /* 每层横撑 + 单斜撑 */
    for (var yy = 2.6; yy <= ty - 0.2; yy += 3.02) {
      var k = (yy - 0.34) / (ty - 0.34);
      var hw = U.lerp(tb, tt, k);
      for (var f = 0; f < 4; f++) {
        var s1 = (f % 2 === 0) ? 1 : -1, s2 = (f < 2) ? 1 : -1;
        var p1, p2;
        if (f < 2) {
          p1 = { x: -hw, y: yy, z: s2 * hw }; p2 = { x: hw, y: yy, z: s2 * hw };
        } else {
          p1 = { x: s1 * hw, y: yy, z: -hw }; p2 = { x: s1 * hw, y: yy, z: hw };
        }
        geoms.push(U.tube(p1, p2, 0.085, 5));
      }
    }
    /* 对角斜撑（四个侧面各一根，贯穿两段） */
    for (var fs = -1; fs <= 1; fs += 2) {
      geoms.push(U.member({ x: -tb, y: 0.34, z: fs * tb }, { x: tt * 0.8, y: ty * 0.62, z: fs * tt }, 0.11, 0.11));
      geoms.push(U.member({ x: tb, y: 0.34, z: fs * tb }, { x: -tt * 0.8, y: ty * 0.62, z: fs * tt }, 0.11, 0.11));
      geoms.push(U.member({ x: fs * tb, y: 0.34, z: -tb }, { x: fs * tt, y: ty * 0.62, z: tt * 0.8 }, 0.11, 0.11));
      geoms.push(U.member({ x: fs * tb, y: 0.34, z: tb }, { x: fs * tt, y: ty * 0.62, z: -tt * 0.8 }, 0.11, 0.11));
    }
    /* 塔顶平台 */
    geoms.push(U.box(tt * 2 + 0.9, 0.38, tt * 2 + 0.9, 0, ty + 0.19, 0));
    /* 臂架铰支座：塔顶 → A */
    geoms.push(U.box(1.55, 1.10, 1.85, A.x - 0.15, ty + 0.72, 0));
    /* 铰座两侧耳板 */
    geoms.push(U.box(1.30, 1.35, 0.30, A.x, A.y - 0.05, 1.02));
    geoms.push(U.box(1.30, 1.35, 0.30, A.x, A.y - 0.05, -1.02));

    /* 人字架：塔顶 → apex E（支撑大拉杆铰点） */
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      geoms.push(U.member({ x: 1.30, y: ty + 0.30, z: s2 * 1.30 }, { x: apex.x, y: apex.y, z: s2 * 0.60 }, 0.42, 0.42));
      geoms.push(U.member({ x: -2.05, y: ty + 0.30, z: s2 * 1.30 }, { x: apex.x, y: apex.y, z: s2 * 0.60 }, 0.34, 0.34));
      for (var t = 0.28; t < 0.95; t += 0.22) {
        geoms.push(U.tube(
          { x: U.lerp(1.30, apex.x, t), y: U.lerp(ty + 0.30, apex.y, t), z: s2 * U.lerp(1.30, 0.60, t) },
          { x: U.lerp(-2.05, apex.x, t), y: U.lerp(ty + 0.30, apex.y, t), z: s2 * U.lerp(1.30, 0.60, t) },
          0.07, 5));
      }
    }
    geoms.push(U.tube({ x: apex.x, y: apex.y, z: -0.66 }, { x: apex.x, y: apex.y, z: 0.66 }, 0.22, 12));
    U.mesh(U.merge(geoms), K.mat.steel, upper);

    /* 顶部滑轮 E */
    var pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.38, 20), K.mat.dark);
    pulley.rotation.x = Math.PI / 2;
    pulley.position.set(apex.x, apex.y, 0);
    pulley.castShadow = true;
    upper.add(pulley);
    U.mesh(U.merge([
      U.box(0.18, 1.2, 0.18, apex.x - 0.52, apex.y - 0.38, 0.46),
      U.box(0.18, 1.2, 0.18, apex.x - 0.52, apex.y - 0.38, -0.46),
      U.box(0.55, 0.20, 1.10, apex.x - 0.52, apex.y - 0.98, 0),
    ]), K.mat.steel, upper);
    K.apex = pulley;
  };

  /* ---------------- 桁架生成 ---------------- */
  function truss(len, n, h0, h1, w0, w1, r0, r1) {
    var geoms = [], nodes = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, x = t * len;
      var hh = U.lerp(h0, h1, Math.pow(t, 0.8)) * 0.5;
      var ww = U.lerp(w0, w1, t) * 0.5;
      nodes.push([
        { x: x, y: hh, z: ww }, { x: x, y: hh, z: -ww },
        { x: x, y: -hh, z: ww }, { x: x, y: -hh, z: -ww },
      ]);
    }
    for (var c = 0; c < 4; c++) {
      for (var j = 0; j < n; j++) {
        geoms.push(U.tube(nodes[j][c], nodes[j + 1][c], U.lerp(r0, r1, j / n), 5));
      }
    }
    for (var i2 = 0; i2 < n; i2++) {
      var a1 = nodes[i2], b1 = nodes[i2 + 1];
      geoms.push(U.tube(a1[0], b1[2], 0.052, 4));
      geoms.push(U.tube(a1[2], b1[0], 0.052, 4));
      geoms.push(U.tube(a1[1], b1[3], 0.052, 4));
      geoms.push(U.tube(a1[3], b1[1], 0.052, 4));
      geoms.push(U.tube(a1[0], b1[1], 0.046, 4));
      geoms.push(U.tube(a1[2], b1[3], 0.046, 4));
    }
    return geoms;
  }

  /* ---------------- 臂架 + 齿条 + 平衡机构 ---------------- */
  K._jib = function (upper) {
    var up = C.upper;
    var pivot = new THREE.Group();
    pivot.position.set(up.pivot.x, up.pivot.y, 0);
    upper.add(pivot);
    K.boomPivot = pivot;
    K.jibPivot = pivot;

    var g1 = truss(up.jibLength, 12, 2.30, 1.05, 1.70, 1.00, 0.105, 0.085);
    /* 根部铰座：包住 A 点，向上下延伸，遮住与转台的缝 */
    g1.push(U.tube({ x: 0, y: 0, z: -1.05 }, { x: 0, y: 0, z: 1.05 }, 0.26, 12));
    g1.push(U.box(1.85, 1.30, 0.34, 0.78, 0, 0.94));
    g1.push(U.box(1.85, 1.30, 0.34, 0.78, 0, -0.94));
    g1.push(U.box(0.55, 2.10, 1.55, 0.10, 0, 0));
    /* 头部铰座（象鼻梁铰点 B）：双耳板 + 销轴 */
    g1.push(U.box(0.85, 0.95, 0.26, up.jibLength - 0.34, 0, 1.02));
    g1.push(U.box(0.85, 0.95, 0.26, up.jibLength - 0.34, 0, -1.02));
    g1.push(U.tube({ x: up.jibLength, y: 0, z: -1.16 }, { x: up.jibLength, y: 0, z: 1.16 }, 0.17, 10));
    U.mesh(U.merge(g1), K.mat.steel, pivot);

    /* 齿条扇形：以 A 为圆心，覆盖臂架 26°~50° 行程 */
    var rk = up.rack;
    var a0 = U.rad(180 - rk.span / 2), aL = U.rad(rk.span);
    var secG = new THREE.CylinderGeometry(rk.radius, rk.radius, 0.72, 28, 1, false, a0, aL);
    secG.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    var sect = [secG];
    for (var kt = 0; kt <= 14; kt++) {
      var ang = a0 + aL * kt / 14;
      var tg = new THREE.BoxGeometry(0.19, 0.34, 0.76);
      tg.applyMatrix4(new THREE.Matrix4()
        .makeRotationZ(ang + Math.PI / 2)
        .premultiply(new THREE.Matrix4()
          .makeTranslation((rk.radius + 0.13) * Math.cos(ang), (rk.radius + 0.13) * Math.sin(ang), 0)));
      sect.push(tg);
    }
    /* 齿条腹板：把扇形与臂架根部连起来，避免悬空 */
    sect.push(U.box(rk.radius * 0.62, 0.42, 0.26, -rk.radius * 0.32, 0, 0));
    U.mesh(U.merge(sect), K.mat.steelDeep, pivot);

    /* ---- 平衡机构：转台后上方摆动杠杆 ---- */
    var cw = up.counterweight;
    var bal = new THREE.Group();
    bal.position.set(cw.pivotX, cw.pivotY, 0);
    upper.add(bal);
    K.balance = bal;

    var bg = [];
    bg.push(U.tube({ x: 0, y: 0, z: -0.86 }, { x: 0, y: 0, z: 0.86 }, 0.26, 12));
    for (var sb = -1; sb <= 1; sb += 2) {
      bg.push(U.member({ x: 0, y: 0, z: sb * 0.62 }, { x: -cw.armLength, y: 0, z: sb * 0.62 }, 0.30, 0.40));
    }
    bg.push(U.tube({ x: -cw.armLength, y: 0, z: -1.02 }, { x: -cw.armLength, y: 0, z: 1.02 }, 0.20, 12));
    U.mesh(U.merge(bg), K.mat.steelDeep, bal);

    var cwG = new THREE.CylinderGeometry(cw.radius, cw.radius, cw.width, 26);
    cwG.applyMatrix4(new THREE.Matrix4()
      .makeRotationX(Math.PI / 2)
      .premultiply(new THREE.Matrix4().makeTranslation(-cw.armLength, 0, 0)));
    var cwMesh = new THREE.Mesh(cwG, K.mat.cool);
    cwMesh.castShadow = true; cwMesh.receiveShadow = true;
    bal.add(cwMesh);
    K.counterweight = cwMesh;

    var cap = [];
    for (var sc = -1; sc <= 1; sc += 2) {
      var cg2 = new THREE.CylinderGeometry(cw.radius * 0.85, cw.radius * 0.85, 0.12, 26);
      cg2.applyMatrix4(new THREE.Matrix4()
        .makeRotationX(Math.PI / 2)
        .premultiply(new THREE.Matrix4()
          .makeTranslation(-cw.armLength, 0, sc * (cw.width / 2 + 0.07))));
      cap.push(cg2);
    }
    U.mesh(U.merge(cap), K.mat.dark, bal);

    /* 杠杆铰座（固定在转台上） */
    U.mesh(U.merge([
      U.box(1.15, 0.55, 1.30, cw.pivotX, cw.pivotY - 0.62, 0),
      U.box(0.55, 1.20, 0.55, cw.pivotX + 0.55, cw.pivotY - 1.30, 0.55),
      U.box(0.55, 1.20, 0.55, cw.pivotX + 0.55, cw.pivotY - 1.30, -0.55),
    ]), K.mat.steel, upper);

    /* 平衡连杆（双根） */
    K.balLink = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 1, 8), K.mat.steel);
    K.balLink.castShadow = true;
    upper.add(K.balLink);
    K.balLink2 = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 1, 8), K.mat.steel);
    K.balLink2.castShadow = true;
    upper.add(K.balLink2);
  };

  /* ---------------- 象鼻梁 ---------------- */
  K._head = function (upper) {
    var hd = C.upper.head;
    var g = new THREE.Group();
    upper.add(g);
    K.headPivot = g;

    var rc = hd.rc, rd = hd.rd;
    var beta = U.rad(hd.beta);
    var dx = rd * Math.cos(-beta), dy = rd * Math.sin(-beta);

    var geoms = truss(rc, 8, 1.10, 0.60, 1.00, 0.62, 0.085, 0.06);

    /* B 点：插入臂架双耳板之间的单耳板 + 同轴销孔 */
    geoms.push(U.box(0.80, 0.86, 0.42, 0.10, 0, 0));

    /* 象鼻梁三角形 B-C-D：B 侧斜撑 + D→C 上弦，形成闭合三角 */
    for (var sz2 = -1; sz2 <= 1; sz2 += 2) {
      geoms.push(U.tube({ x: 0.30, y: 0.40, z: sz2 * 0.44 }, { x: dx, y: dy, z: sz2 * 0.44 }, 0.13, 5));
      geoms.push(U.tube({ x: 0.30, y: -0.40, z: sz2 * 0.44 }, { x: dx, y: dy, z: sz2 * 0.44 }, 0.13, 5));
      geoms.push(U.tube({ x: dx, y: dy, z: sz2 * 0.44 }, { x: rc * 0.62, y: 0.34, z: sz2 * 0.40 }, 0.12, 5));
      geoms.push(U.tube({ x: dx, y: dy, z: sz2 * 0.44 }, { x: rc - 0.55, y: 0.18, z: sz2 * 0.34 }, 0.11, 5));
      /* 竖向缀条 */
      geoms.push(U.tube({ x: rc * 0.30, y: 0.42, z: sz2 * 0.44 }, { x: rc * 0.30, y: U.lerp(0.44, dy, 0.30), z: sz2 * 0.44 }, 0.06, 4));
    }
    /* D 点耳板 + 销轴 */
    geoms.push(U.box(0.62, 0.56, 1.02, dx, dy, 0));
    geoms.push(U.tube({ x: dx, y: dy, z: -0.56 }, { x: dx, y: dy, z: 0.56 }, 0.16, 10));

    var hp = new THREE.CylinderGeometry(0.64, 0.64, 1.02, 18);
    hp.applyMatrix4(new THREE.Matrix4()
      .makeRotationX(Math.PI / 2)
      .premultiply(new THREE.Matrix4().makeTranslation(rc - 0.38, 0, 0)));
    geoms.push(hp);
    geoms.push(U.box(0.82, 0.28, 1.22, rc - 0.95, 0, 0));
    U.mesh(U.merge(geoms), K.mat.steel, g);

    var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.94, 20), K.mat.dark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(rc, 0, 0);
    wheel.castShadow = true;
    g.add(wheel);
    K.headWheel = wheel;
    K.headD = { x: dx, y: dy };
  };

  /* ---------------- 大拉杆 D→E ---------------- */
  K._linkage = function (upper) {
    K.tieRods = [];
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 1, 8), K.mat.steelDeep);
      m.castShadow = true;
      upper.add(m);
      K.tieRods.push({ mesh: m, side: s2 });
    }
  };

  /* ---------------- 钢丝绳 ---------------- */
  K._ropes = function (upper, scene) {
    for (var j = 0; j < 2; j++) {
      var m2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.048, 1, 6), K.mat.rope
      );
      m2.castShadow = false;
      scene.add(m2);
      K.ropeCG.push(m2);         // C → 抓斗
    }
  };

  /* ---------------- 抓斗 ---------------- */
  K._grab = function (scene) {
    var g = C.grab;
    var grp = new THREE.Group();
    scene.add(grp);
    K.grab = grp;

    var body = new THREE.Group();      // 随摆动倾斜
    grp.add(body);
    K.grabBody = body;

    /* 顶部横梁 */
    var top = [];
    top.push(U.box(1.9, 0.26, 0.75, 0, -0.13, 0));
    top.push(U.box(0.30, 0.9, 0.30, 0, 0.45, 0.28));
    top.push(U.box(0.30, 0.9, 0.30, 0, 0.45, -0.28));
    top.push(U.tube({ x: 0, y: 0.92, z: -0.35 }, { x: 0, y: 0.92, z: 0.35 }, 0.14, 10));
    U.mesh(U.merge(top), K.mat.cool, body);

    /* 两个颚板 */
    K.jaws = [];
    for (var s = -1; s <= 1; s += 2) {
      var jaw = new THREE.Group();
      jaw.position.set(s * 0.28, -0.28, 0);
      body.add(jaw);
      K.jaws.push({ grp: jaw, side: s });

      var jg = [];
      /* 主颚板（向下略内收） */
      jg.push(U.box(0.62, g.height * 0.86, g.width * 0.94, s * 0.30, -g.height * 0.44, 0));
      /* 弧底 */
      jg.push(U.box(0.95, 0.30, g.width * 0.92, s * 0.28, -g.height * 0.86, 0));
      /* 侧板加强 */
      jg.push(U.box(0.14, g.height * 0.9, 0.12, s * 0.30, -g.height * 0.45, g.width * 0.48));
      jg.push(U.box(0.14, g.height * 0.9, 0.12, s * 0.30, -g.height * 0.45, -g.width * 0.48));
      /* 铰点耳板 */
      jg.push(U.box(0.5, 0.45, 0.4, s * 0.1, -0.05, 0));
      U.mesh(U.merge(jg), K.mat.grab, jaw);
    }

    /* 斗内物料 */
    var sand = new THREE.Mesh(
      new THREE.BoxGeometry(g.width * 0.80, g.height * 0.55, g.width * 0.80),
      K.mat.sand
    );
    sand.position.set(0, -g.height * 0.55, 0);
    sand.castShadow = true;
    body.add(sand);
    K.grabSand = sand;

    /* 卸料沙流 */
    var flow = new THREE.Mesh(
      new THREE.CylinderGeometry(g.width * 0.26, g.width * 0.34, 1, 10, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xc9ab74, roughness: 0.95, side: THREE.DoubleSide,
        transparent: true, opacity: 0.85,
      })
    );
    flow.visible = false;
    scene.add(flow);
    K.sandFlow = flow;
  };

  /* ---------------- 可视化 ---------------- */
  K._viz = function (scene) {
    var rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    var rline = new THREE.Line(rg, new THREE.LineDashedMaterial({
      color: 0xcf4a34, dashSize: 0.85, gapSize: 0.55,
      transparent: true, opacity: 0.9,
    }));
    rline.frustumCulled = false;
    scene.add(rline);
    K.viz.radius = rline;

    var vg = new THREE.BufferGeometry().setFromPoints([
      new V3(0, 0, 0), new V3(0, C.machine.portalHeight, 0),
    ]);
    var vline = new THREE.Line(vg, new THREE.LineDashedMaterial({
      color: 0x2b6fb0, dashSize: 0.7, gapSize: 0.55,
      transparent: true, opacity: 0.55,
    }));
    vline.computeLineDistances();
    scene.add(vline);
    K.viz.axis = vline;

    var MAXP = 1400;
    var pos = new Float32Array(MAXP * 3);
    var tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    tg.setDrawRange(0, 0);
    var tl = new THREE.Line(tg, new THREE.LineBasicMaterial({
      color: 0x2e8b57, transparent: true, opacity: 0.8,
    }));
    tl.frustumCulled = false;
    scene.add(tl);
    K.viz.trace = tl;
    K.viz.traceN = 0;
    K.viz.traceMax = MAXP;
    K.viz.tracePos = pos;

    var mkMat = new THREE.LineBasicMaterial({
      color: 0xcf4a34, transparent: true, opacity: 0.6,
    });
    var mk = new THREE.Group();
    mk.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new V3(-1.8, 0, 0), new V3(1.8, 0, 0)]), mkMat));
    mk.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new V3(0, 0, -1.8), new V3(0, 0, 1.8)]), mkMat));
    scene.add(mk);
    K.viz.mark = mk;
  };

  /* ---------------------------------------------------------
   *  姿态更新
   * --------------------------------------------------------- */
  function setSeg(mesh, ax, ay, az, bx, by, bz) {
    _t1.set(bx - ax, by - ay, bz - az);
    var len = _t1.length();
    mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _q1.setFromUnitVectors(UP, _t1.normalize());
    mesh.quaternion.copy(_q1);
    mesh.scale.set(1, Math.max(len, 0.001), 1);
  }

  K.update = function (st) {
    var alpha = st.alpha;
    var up = C.upper;
    var cw = up.counterweight;
    var apex = up.apex;

    K.root.position.x = st.travel;
    K.upper.rotation.y = st.slew;

    /* 臂架俯仰 + 象鼻梁姿态（四连杆输出） */
    K.boomPivot.rotation.z = alpha;
    K.headPivot.position.set(st.B.x, st.B.y, 0);
    K.headPivot.rotation.z = st.phiBC;

    /* 大拉杆 D → E（双杆，端点落在耳板上） */
    var dh = K.headD;
    var cosP = Math.cos(st.phiBC), sinP = Math.sin(st.phiBC);
    var Dx = st.B.x + dh.x * cosP - dh.y * sinP;
    var Dy = st.B.y + dh.x * sinP + dh.y * cosP;
    for (var i = 0; i < K.tieRods.length; i++) {
      var tr = K.tieRods[i];
      setSeg(tr.mesh, Dx, Dy, tr.side * 0.50, apex.x, apex.y, tr.side * 0.66);
    }

    /* 平衡杠杆摆动 + 连杆接臂架根部 */
    var th = -alpha * 0.50 + U.rad(18);
    K.balance.rotation.z = th;
    var lx = cw.pivotX - cw.armLength * Math.cos(th);
    var ly = cw.pivotY - cw.armLength * Math.sin(th);
    var rx = up.pivot.x - cw.linkAt * Math.cos(alpha) + 0.62 * Math.sin(alpha);
    var ry = up.pivot.y - cw.linkAt * Math.sin(alpha) - 0.62 * Math.cos(alpha);
    setSeg(K.balLink, lx, ly, 0.70, rx, ry, 0.62);
    setSeg(K.balLink2, lx, ly, -0.70, rx, ry, -0.62);

    /* 抓斗悬挂点 C（象鼻梁前端） */
    var Cx = st.Cl.x, Cy = st.Cl.y;
    var y0 = C.machine.portalHeight + C.machine.slewBearingH;
    var cwv = Math.cos(st.slew), swv = Math.sin(st.slew);
    var Cwx = st.travel + Cx * cwv;
    var Cwz = -Cx * swv;
    var Cwy = Cy + y0;

    var gp = st.grabPos;
    for (var m = 0; m < K.ropeCG.length; m++) {
      var off = (m === 0 ? -0.28 : 0.28);
      setSeg(K.ropeCG[m], Cwx, Cwy, Cwz + off, gp.x, gp.y + 0.9, gp.z + off);
    }

    /* 抓斗姿态与开合 */
    K.grab.position.copy(gp);
    _q2.setFromAxisAngle(UP, st.slew);
    _q1.setFromUnitVectors(DOWN, st.swayDir);
    _q2.multiply(_q1);
    K.grab.quaternion.copy(_q2);

    var open = st.grabOpen;
    var ang = U.rad(2 + open * 32);
    for (var n = 0; n < K.jaws.length; n++) {
      K.jaws[n].grp.rotation.z = K.jaws[n].side * ang;
    }

    var lv = st.load;
    K.grabSand.visible = lv > 0.02;
    if (lv > 0.02) {
      K.grabSand.scale.set(1, Math.max(lv, 0.05), 1);
      K.grabSand.position.y = -C.grab.height * (0.30 + 0.30 * lv);
    }

    var flowOn = st.sandFlow > 0.02;
    K.sandFlow.visible = flowOn;
    if (flowOn) {
      var fh = st.sandFlowLen;
      K.sandFlow.position.set(gp.x, gp.y - C.grab.height - fh / 2, gp.z);
      K.sandFlow.scale.set(1, Math.max(fh, 0.1), 1);
    }

    /* 幅度标尺 */
    K.viz.radius.visible = st.showRadius;
    K.viz.mark.visible = st.showRadius;
    K.viz.axis.visible = st.showRadius;
    if (st.showRadius) {
      var arr = K.viz.radius.geometry.attributes.position.array;
      arr[0] = 0; arr[1] = 0.07; arr[2] = 0;
      arr[3] = gp.x; arr[4] = 0.07; arr[5] = gp.z;
      K.viz.radius.geometry.attributes.position.needsUpdate = true;
      K.viz.radius.geometry.computeBoundingSphere();
      K.viz.radius.computeLineDistances();
      K.viz.mark.position.set(gp.x, 0.02, gp.z);
      K.viz.axis.position.x = st.travel;
    }

    K.viz.trace.visible = st.showTrace;
    if (st.showTrace && st.traceDirty) {
      var pa = K.viz.tracePos, idx = K.viz.traceN;
      if (idx >= K.viz.traceMax) { K.viz.traceN = 0; idx = 0; }
      pa[idx * 3] = gp.x; pa[idx * 3 + 1] = gp.y; pa[idx * 3 + 2] = gp.z;
      K.viz.traceN = idx + 1;
      K.viz.trace.geometry.setDrawRange(0, K.viz.traceN);
      K.viz.trace.geometry.attributes.position.needsUpdate = true;
      K.viz.trace.geometry.computeBoundingSphere();
    }
  };

  K.resetTrace = function () {
    K.viz.traceN = 0;
    K.viz.trace.geometry.setDrawRange(0, 0);
  };

  K.anchors = function (st) {
    var y0 = C.machine.portalHeight + C.machine.slewBearingH;
    var tmp = new V3();
    var toW = function (x, y) {
      tmp.set(x, y, 0);
      tmp.applyAxisAngle(UP, st.slew);
      tmp.x += st.travel;
      tmp.y += y0;
      return tmp.clone();
    };
    var up = C.upper;
    return {
      apex: toW(up.apex.x, up.apex.y),
      boom: toW(up.pivot.x + up.jibLength * 0.5 * Math.cos(st.alpha),
                up.pivot.y + up.jibLength * 0.5 * Math.sin(st.alpha)),
      jib: toW((st.B.x + st.Cl.x) * 0.5, (st.B.y + st.Cl.y) * 0.5),
      hook: st.grabPos.clone(),
      slew: new V3(st.travel, C.machine.portalHeight + 0.4, 0),
      gantry: new V3(st.travel + 4.4, 6.0, 5.6),
    };
  };

  w.CRANE = K;
})(window);
