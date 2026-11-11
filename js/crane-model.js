/* =============================================================
 * crane-model.js — 高精度 GLB 门机模型加载与运动重定向
 *
 * 源模型为独立顶层部件。加载后按结构拆成：
 *   门架/行走机构（root）、转台以上（upper）、主臂、象鼻梁、
 *   大拉杆和抓斗。运动部件用源铰点→仿真铰点的矩阵重定向，
 *   因此仍由原四连杆解算驱动，而不是仅替换静态外壳。
 *
 * 标定约定：SRC_* 是 GLB 的 CAD 坐标（模型单位），乘以 S 后与 config.js
 * 的四连杆参数一一对应。换模型或改机型时，先改 SRC_*，再用
 * CM.calibration 核对 config.js；两者不一致会被 verifyCalibration() 报警。
 * ============================================================= */
(function (w) {
  'use strict';

  var C = w.CFG;
  var CM = { ready: false, loading: false, K: null };
  var S = 0.82;                       // 源模型 → 仿真尺寸
  /* 主臂铰点 A：取“臂架-动画3”包围盒根端 */
  var SRC_A = { x: 0.065, y: 28.784, z: -0.506 };
  /* 象鼻梁三角：B=主臂铰点，D=大拉杆铰点，C=起升滑轮 */
  var SRC_B = { x: 21.501, y: 48.800, z: -0.502 };
  var SRC_D = { x: 17.979, y: 53.114, z: -0.502 };
  var SRC_C = { x: 36.150, y: 41.591, z: -0.502 };
  var SRC_E = { x: -5.138, y: 41.100, z: -0.487 };
  var SRC_GRAB_TOP = { x: 35.782, y: 34.209, z: -0.484 };
  var SRC_GRAB_BOTTOM = 28.185522; // 两片颚板闭合后的最低点，包含完整斗体
  /* Line029/Line038 才是真正的两侧颚板，铰轴位于二者上缘 */
  var SRC_JAW_HINGE = { x: 35.804, y: 31.795, z: -0.4655 };
  /* 三个部件共用主臂耳板上的销轴。取 CAD 销轴中心，不取网格表面的最近顶点。 */
  var SRC_LUFF_PIN = { x: 4.097271, y: 36.617208, z: -0.511139 };
  var SRC_AFRAME_TOP = { x: -1.184304, y: 41.714724, z: -0.537142 };
  var SRC_RACK_PIN = { x: 3.672151, y: 36.123840, z: -0.494297 };
  var SRC_RACK_DRIVE = { x: -2.783760, y: 36.123840, z: -0.494297 };
  var OFFSET = {
    x: 0,
    y: C.machine.portalHeight + C.machine.slewBearingH + C.upper.pivot.y - S * SRC_A.y,
    z: -S * SRC_A.z,
  };

  /* ---------------- 源模型标定结果（S 缩放后，应与 config.js 完全一致） ---------------- */
  function srcDist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }

  var CAL = {
    scale: S,
    jibLength: S * srcDist(SRC_A, SRC_B),           // 24.049
    rc: S * srcDist(SRC_B, SRC_C),                  // 13.388
    rd: S * srcDist(SRC_B, SRC_D),                  // 4.567
    tieRod: S * srcDist(SRC_D, SRC_E),              // 21.363
    beta: (Math.atan2(SRC_C.y - SRC_B.y, SRC_C.x - SRC_B.x) -
      Math.atan2(SRC_D.y - SRC_B.y, SRC_D.x - SRC_B.x)) * 180 / Math.PI, // -155.43
    apex: {
      x: C.upper.pivot.x + S * (SRC_E.x - SRC_A.x),
      y: C.upper.pivot.y + S * (SRC_E.y - SRC_A.y),
    },
  };
  CM.calibration = CAL;

  /* 换模型后若忘记同步 config.js，这里报出偏差；只告警，不阻断运行 */
  function verifyCalibration() {
    var up = C.upper, bad = [];
    function chk(label, model, cfg, tol) {
      if (Math.abs(model - cfg) > (tol || 1e-3)) {
        bad.push(label + '：config=' + cfg.toFixed(4) + ' / 模型=' + model.toFixed(4));
      }
    }
    chk('臂架 AB', CAL.jibLength, up.jibLength);
    chk('|BC|', CAL.rc, up.head.rc);
    chk('|BD|', CAL.rd, up.head.rd);
    chk('|DE|', CAL.tieRod, up.tieRod);
    chk('∠CBD', CAL.beta, up.head.beta, 0.05);
    chk('E.x', CAL.apex.x, up.apex.x);
    chk('E.y', CAL.apex.y, up.apex.y);
    if (bad.length) {
      console.warn('[crane-model] 四连杆参数与 GLB 标定不一致，模型会被拉伸：\n  ' + bad.join('\n  '));
    }
    return bad;
  }
  CM.verifyCalibration = verifyCalibration;

  var groups = null;
  var grabContents = [], lastFill = -1;
  var luffPin = new THREE.Vector3();
  var aframeTop = null, rackDrivePivot = null;
  var _luffMid = new THREE.Vector3();
  var _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
  var _t = new THREE.Matrix4(), _sc = new THREE.Matrix4();

  function isLower(name) {
    return name === '门架总成' || name === 'xingzouzu' || name === '下接料板' || name === '头部落料管' ||
      name === '高压电器房' || name === 'dianlanj' || name === 'dianlanx' ||
      name === '电缆卷筒—制动器' || name === '全球摄像机' || name === '大车行走枪机005' ||
      /^(皮带机|传送带|溜筒|落料|漏斗|抖动给料|伸缩机构)/.test(name);
  }

  function isRope(name) {
    return name === '钢丝绳1' || name === '钢丝绳3' || name === '钢丝绳4' || name === '对象079';
  }

  function isGrabPart(name) {
    return name === '抓斗' || name === 'Circle004' || name === '对象078' ||
      name === 'Line029' || name === 'Line038';
  }

  /* 合并组内同材质网格，保留组本身的运动变换 */
  function mergeGroup(group) {
    group.updateWorldMatrix(true, true);
    var inv = group.matrixWorld.clone().invert();
    var bins = Object.create(null);
    var originals = [];
    group.traverse(function (o) {
      if (!o.isMesh || Array.isArray(o.material)) return;
      var key = o.material.uuid;
      if (!bins[key]) bins[key] = { material: o.material, geometries: [] };
      var g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      Object.keys(g.attributes).forEach(function (a) {
        if (a !== 'position' && a !== 'normal' && a !== 'uv') g.deleteAttribute(a);
      });
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      if (!g.index) {
        var n = g.attributes.position.count;
        var idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
        for (var i = 0; i < n; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      g.clearGroups();
      bins[key].geometries.push(g);
      originals.push(o.geometry);
    });
    while (group.children.length) group.remove(group.children[0]);
    Object.keys(bins).forEach(function (key) {
      var b = bins[key];
      var merged = b.geometries.length === 1 ? b.geometries[0]
        : THREE.BufferGeometryUtils.mergeBufferGeometries(b.geometries, false);
      if (!merged) return;
      var mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    originals.forEach(function (g) { g.dispose(); });
  }

  function rotateJaw(group, angle) {
    var h = SRC_JAW_HINGE;
    group.matrix.copy(_m.makeTranslation(h.x, h.y, h.z));
    group.matrix.multiply(_r.makeRotationX(angle));
    group.matrix.multiply(_t.makeTranslation(-h.x, -h.y, -h.z));
    group.matrixWorldNeedsUpdate = true;
  }

  /* 源 CAD 颚板内腔的保守截面（z 距中缝、y 高度）。料面随载荷降低，
     下边界始终沿斗底，不把矩形料块压缩到弧底外。两半分别跟随各自颚板。 */
  function contentsGeometry(side, fill) {
    var top = 28.40 + 1.10 * Math.sqrt(fill);
    var outline = [[0.025, 28.40], [0.60, 28.64], [1.12, 29.02], [1.38, 29.38], [1.38, 29.50], [0.025, 29.50]];
    var clipped = [];
    for (var i = 0; i < outline.length; i++) {
      var a = outline[i], b = outline[(i + 1) % outline.length];
      if (a[1] <= top) clipped.push(a);
      if ((a[1] <= top) !== (b[1] <= top)) {
        var t = (top - a[1]) / (b[1] - a[1]);
        clipped.push([a[0] + (b[0] - a[0]) * t, top]);
      }
    }
    var shape = new THREE.Shape();
    clipped.forEach(function (p, i) {
      var z = -0.479 + side * p[0];
      if (i) shape.lineTo(z, p[1]); else shape.moveTo(z, p[1]);
    });
    shape.closePath();
    var geometry = new THREE.ExtrudeGeometry(shape, { depth: 2.68, bevelEnabled: false, steps: 1 });
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(SRC_JAW_HINGE.x + 1.34, 0, 0);
    return geometry;
  }

  function updateContents(st) {
    var fill = Math.round(U.clamp(st.load, 0, 1) * 100) / 100;
    if (fill === lastFill) return;
    lastFill = fill;
    grabContents.forEach(function (mesh, i) {
      mesh.visible = fill > 0;
      if (fill > 0) {
        mesh.geometry.dispose();
        mesh.geometry = contentsGeometry(i ? 1 : -1, fill);
      }
    });
  }

  /* 齿条及端部销轴随齿条滑动；电机、减速器、摇架留在驱动端。 */
  function splitRack(node, drive, slider) {
    var moving = ['变幅机构-齿条总成', '变幅机构-钩接式油嘴',
      '变幅机构-轴承', '变幅机构-齿条轴', '变幅机构-通盖', '变幅机构-轴套1\\2'];
    var driveSource = node.clone(false), sliderSource = node.clone(false);
    node.children.slice().forEach(function (part) {
      (moving.indexOf(part.name) >= 0 ? sliderSource : driveSource).add(part);
    });
    drive.add(driveSource);
    slider.add(sliderSource);
  }

  /* 主臂经尺寸标定后，原齿条在最大幅度时过短。只延长直段，保留端部销孔及附件尺寸。 */
  function extendRackTail(slider) {
    var shoulder = SRC_RACK_PIN.x - 0.6;
    slider.children.forEach(function (mesh) {
      if (!mesh.isMesh) return;
      var p = mesh.geometry.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i);
        if (x < shoulder) p.setX(i, shoulder + (x - shoulder) * 1.35);
      }
      p.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    });
  }

  function tuneMaterials(root) {
    var seen = Object.create(null);
    root.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      var m = o.material;
      if (!m || seen[m.uuid]) return;
      seen[m.uuid] = true;
      if (m.map) {
        m.map.encoding = THREE.sRGBEncoding;
        m.map.anisotropy = 2;
      }
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.24);
      if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.48);
      m.needsUpdate = true;
    });
  }

  function upperLocal(src) {
    return {
      x: OFFSET.x + S * src.x,
      y: OFFSET.y - (C.machine.portalHeight + C.machine.slewBearingH) + S * src.y,
      z: OFFSET.z + S * src.z,
    };
  }

  function lowerLocal(src) {
    /* 与底座整体 90° 旋转一致：x' = z, z' = -x */
    return { x: S * src.z, y: S * src.y, z: -S * src.x };
  }

  /* M = T(dstA)·R(dstAng)·S(lenRatio,cross,cross)·R(-srcAng)·T(-srcA) */
  function retarget(group, srcA, srcB, dstA, dstB, cross) {
    var sx = srcB.x - srcA.x, sy = srcB.y - srcA.y;
    var dx = dstB.x - dstA.x, dy = dstB.y - dstA.y;
    var sl = Math.hypot(sx, sy), dl = Math.hypot(dx, dy);
    var sa = Math.atan2(sy, sx), da = Math.atan2(dy, dx);
    group.matrix.copy(_m.makeTranslation(dstA.x, dstA.y, dstA.z || 0));
    group.matrix.multiply(_r.makeRotationZ(da));
    group.matrix.multiply(_sc.makeScale(dl / sl, cross, cross));
    group.matrix.multiply(_r.makeRotationZ(-sa));
    group.matrix.multiply(_t.makeTranslation(-srcA.x, -srcA.y, -(srcA.z || 0)));
    /* CAD 两端轴心可能有细微 z 偏差，沿杆长插值修正，保证两端均严格落在目标铰点。 */
    var zSlope = ((dstB.z || 0) - (dstA.z || 0) - cross * ((srcB.z || 0) - (srcA.z || 0))) / (sl * sl);
    var e = group.matrix.elements;
    e[2] = zSlope * sx;
    e[6] = zSlope * sy;
    e[14] = (dstA.z || 0) - cross * (srcA.z || 0) - e[2] * srcA.x - e[6] * srcA.y;
    group.matrixWorldNeedsUpdate = true;
  }

  /* 保持齿条、销轴及驱动总成的尺寸，靠转向与齿条滑动满足共同铰点约束。 */
  function placeRackPart(group, src, dst, angle) {
    group.matrix.copy(_m.makeTranslation(dst.x, dst.y, dst.z));
    group.matrix.multiply(_r.makeRotationZ(angle));
    group.matrix.multiply(_sc.makeScale(S, S, S));
    group.matrix.multiply(_t.makeTranslation(-src.x, -src.y, -src.z));
    group.matrixWorldNeedsUpdate = true;
  }

  /* 象鼻梁用 B/D/C 三点求二维仿射矩阵，保证三个铰点同时闭合 */
  function headTransform(st) {
    var s1x = SRC_D.x - SRC_B.x, s1y = SRC_D.y - SRC_B.y;
    var s2x = SRC_C.x - SRC_B.x, s2y = SRC_C.y - SRC_B.y;
    var d1x = st.D.x - st.B.x, d1y = st.D.y - st.B.y;
    var d2x = st.Cl.x - st.B.x, d2y = st.Cl.y - st.B.y;
    var det = s1x * s2y - s2x * s1y;
    var a = (d1x * s2y - d2x * s1y) / det;
    var b = (d2x * s1x - d1x * s2x) / det;
    var d = (d1y * s2y - d2y * s1y) / det;
    var e = (d2y * s1x - d1y * s2x) / det;
    return {
      a: a, b: b, d: d, e: e,
      tx: st.B.x - a * SRC_B.x - b * SRC_B.y,
      ty: st.B.y - d * SRC_B.x - e * SRC_B.y,
    };
  }

  function applyHeadTransform(group, st) {
    var h = headTransform(st);
    group.matrix.set(
      h.a, h.b, 0, h.tx,
      h.d, h.e, 0, h.ty,
      0, 0, S, -S * SRC_B.z,
      0, 0, 0, 1
    );
    group.matrixWorldNeedsUpdate = true;
  }

  function hideProcedural(K) {
    K.root.children.forEach(function (o) { if (o !== K.upper) o.visible = false; });
    K.upper.children.forEach(function (o) {
      if (o.isMesh || o === K.boomPivot || o === K.headPivot || o === K.balance) o.visible = false;
    });
    if (K.balLink) K.balLink.visible = false;
    if (K.balLink2) K.balLink2.visible = false;
    if (K.grabBody) {
      K.grabBody.children.forEach(function (o) { o.visible = false; });
    }
  }

  function setHotBox(K, key, pos, size, occurrence) {
    var seen = 0;
    for (var i = 0; i < K.hotspots.length; i++) {
      var h = K.hotspots[i];
      if (!h.userData || h.userData.key !== key) continue;
      if (occurrence !== undefined && seen++ !== occurrence) continue;
      h.position.set(pos.x, pos.y, pos.z);
      var p = h.geometry.parameters || {};
      h.scale.set(
        p.width ? size.x / p.width : 1,
        p.height ? size.y / p.height : 1,
        p.depth ? size.z / p.depth : 1
      );
      if (occurrence === undefined) return;
    }
  }

  function adjustHotspots(K) {
    var gp = lowerLocal({ x: 0.135, y: 12.85, z: 0.786 });
    setHotBox(K, 'gantry', gp, { x: 11.4, y: 20.9, z: 13.8 });
    for (var sx = -1, i = 0; sx <= 1; sx += 2) {
      for (var sz = -1; sz <= 1; sz += 2) {
        setHotBox(K, 'bogie', { x: sx * 2.6, y: 1.75, z: sz * 9.5 },
          { x: 6.0, y: 3.3, z: 4.0 }, i++);
      }
    }
    setHotBox(K, 'tower', upperLocal({ x: -3.6, y: 37.2, z: -0.15 }), { x: 5.4, y: 8.2, z: 5.5 });
    setHotBox(K, 'aframe', upperLocal({ x: 1.48, y: 39.14, z: -0.58 }), { x: 5.0, y: 5.0, z: 3.2 });
    setHotBox(K, 'slew', upperLocal({ x: -1.97, y: 27.0, z: 1.38 }), { x: 13.0, y: 4.0, z: 11.0 });
    setHotBox(K, 'cab', upperLocal({ x: 6.15, y: 34.15, z: 6.49 }), { x: 3.2, y: 2.5, z: 2.2 });
    setHotBox(K, 'rack', upperLocal({ x: 0.17, y: 35.92, z: -0.52 }), { x: 7.0, y: 1.8, z: 3.0 });
    setHotBox(K, 'cw', upperLocal({ x: -6.25, y: 43.11, z: -0.40 }), { x: 8.7, y: 3.3, z: 5.0 });
  }

  function wrapAnchors(K) {
    var original = K.anchors;
    var up = C.upper;
    function pointUpper(src, st) {
      var p = upperLocal(src);
      var cs = Math.cos(st.slew), sn = Math.sin(st.slew);
      return new THREE.Vector3(
        st.travel + p.x * cs + p.z * sn,
        C.machine.portalHeight + C.machine.slewBearingH + p.y,
        -p.x * sn + p.z * cs
      );
    }
    function pointLower(src, st) {
      var p = lowerLocal(src);
      return new THREE.Vector3(p.x + st.travel, p.y, p.z);
    }
    K.anchors = function (st) {
      var a = original(st);
      a.gantry = pointLower({ x: 0.135, y: 12.85, z: 0.786 }, st);
      a.bogie = pointLower({ x: 0.06, y: 2.09, z: 9.5 }, st);
      a.slew = pointUpper({ x: -1.97, y: 27.0, z: 1.38 }, st);
      a.tower = pointUpper({ x: -3.6, y: 37.2, z: -0.15 }, st);
      a.aframe = K.upper.localToWorld(_luffMid.clone());
      a.cab = pointUpper({ x: 6.15, y: 34.15, z: 6.49 }, st);
      a.cw = pointUpper({ x: -6.25, y: 43.11, z: -0.40 }, st);
      a.rack = K.upper.localToWorld(new THREE.Vector3(rackDrivePivot.x, rackDrivePivot.y, rackDrivePivot.z));
      return a;
    };
  }

  function setup(K, model) {
    verifyCalibration();
    hideProcedural(K);
    tuneMaterials(model);
    var source = model.getObjectByName('RootNode') || model;
    var lower = new THREE.Group(), upper = new THREE.Group();
    var boom = new THREE.Group(), head = new THREE.Group(), tie = new THREE.Group();
    var aframe = new THREE.Group(), rackDrive = new THREE.Group(), rackSlider = new THREE.Group();
    var grab = new THREE.Group();
    lower.name = 'CAD_门架与行走机构';
    upper.name = 'CAD_回转上部';
    boom.name = 'CAD_主臂'; head.name = 'CAD_象鼻梁'; tie.name = 'CAD_大拉杆';
    grab.name = 'CAD_抓斗';
    aframe.name = 'CAD_变幅斜撑';
    rackDrive.name = 'CAD_变幅驱动';
    rackSlider.name = 'CAD_变幅齿条';

    /* 行走机构独立对中：不能使用臂架偏移，否则车轮偏离轨道 */
    lower.position.set(0, 0, 0);
    lower.scale.setScalar(S);
    var up0 = C.machine.portalHeight + C.machine.slewBearingH;
    upper.position.set(0, OFFSET.y - up0, OFFSET.z);
    upper.scale.setScalar(S);
    K.root.add(lower);
    K.upper.add(upper);
    K.upper.add(boom); K.upper.add(head); K.upper.add(tie);
    boom.matrixAutoUpdate = false; head.matrixAutoUpdate = false;
    tie.matrixAutoUpdate = false;
    [aframe, rackDrive, rackSlider].forEach(function (group) {
      K.upper.add(group);
      group.matrixAutoUpdate = false;
    });
    aframeTop = upperLocal(SRC_AFRAME_TOP);
    rackDrivePivot = upperLocal(SRC_RACK_DRIVE);
    /* 共用同一横向销轴平面，避免侧视对齐但前视仍分离。 */
    rackDrivePivot.z = S * (SRC_LUFF_PIN.z - SRC_A.z);

    var grabScale = C.grab.height / (SRC_GRAB_TOP.y - SRC_GRAB_BOTTOM);
    grab.scale.setScalar(grabScale);
    grab.position.set(-SRC_GRAB_TOP.x * grabScale, -SRC_GRAB_TOP.y * grabScale, -SRC_GRAB_TOP.z * grabScale);
    K.grabBody.add(grab);
    var grabShell = new THREE.Group(), jawNeg = new THREE.Group(), jawPos = new THREE.Group();
    grabShell.name = 'CAD_抓斗顶部'; jawNeg.name = 'CAD_左颚板'; jawPos.name = 'CAD_右颚板';
    grab.add(grabShell); grab.add(jawNeg); grab.add(jawPos);

    var cabNode = null;
    var children = source.children.slice();
    children.forEach(function (node) {
      var name = node.name || '';
      if (name === '对象076' || isRope(name)) return;
      if (name === '司机室总') cabNode = node;
      else if (name === '臂架-动画3') boom.add(node);
      else if (name === '臂架动画2') head.add(node);
      else if (name === '臂架动画1') tie.add(node);
      else if (name === '组002') splitRack(node, rackDrive, rackSlider);
      else if (name === '臂架-人字形') aframe.add(node);
      else if (name === 'Line029') jawPos.add(node);
      else if (name === 'Line038') jawNeg.add(node);
      else if (isGrabPart(name)) grabShell.add(node);
      else if (isLower(name)) lower.add(node);
      else upper.add(node);
    });

    mergeGroup(lower); mergeGroup(upper); mergeGroup(boom);
    // 独立保留司机室外壳，室内视角使用内饰，避免封闭的 CAD 外壳遮住视线。
    if (cabNode) { upper.add(cabNode); cabNode.name = 'CAD_司机室外壳'; }
    mergeGroup(head); mergeGroup(tie); mergeGroup(grabShell);
    mergeGroup(jawNeg); mergeGroup(jawPos);
    var cargoMaterial = K.mat.sand.clone();
    cargoMaterial.color.set(0xc9ab74).convertSRGBToLinear();
    cargoMaterial.roughness = 0.98;
    if (w.SCENE.holdSand) cargoMaterial.map = w.SCENE.holdSand.material.map;
    [jawNeg, jawPos].forEach(function (jaw, i) {
      var cargo = new THREE.Mesh(new THREE.BufferGeometry(), cargoMaterial);
      cargo.name = i ? 'CAD_右斗内物料' : 'CAD_左斗内物料';
      cargo.visible = false; cargo.castShadow = true; cargo.receiveShadow = true;
      jaw.add(cargo); grabContents.push(cargo);
    });
    mergeGroup(aframe); mergeGroup(rackDrive); mergeGroup(rackSlider);
    extendRackTail(rackSlider);
    /* 底座（门架下部 + 四组行走轮组）整体绕竖轴旋转 90° */
    lower.rotation.y = Math.PI / 2;
    jawNeg.matrixAutoUpdate = false; jawPos.matrixAutoUpdate = false;
    groups = { lower: lower, upper: upper, boom: boom, head: head, tie: tie,
      grab: grab, jawNeg: jawNeg, jawPos: jawPos,
      aframe: aframe, rackDrive: rackDrive, rackSlider: rackSlider };
    adjustHotspots(K);
    wrapAnchors(K);
    CM.ready = true;
    CM.K = K;
    CM.update(w.KT.ST);
  }

  CM.load = function (K) {
    if (CM.loading || CM.ready) return;
    CM.loading = true;
    var draco = new THREE.DRACOLoader();
    draco.setDecoderPath('lib/draco/');
    draco.setWorkerLimit(2);
    var loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(draco);
    /* 模型缓存键用独立的 MODEL_VER：仅 GLB 内容变化时递增，界面代码改版不影响模型缓存 */
    loader.load('assets/models/portal-crane.glb?v=' + (window.MODEL_VER || window.ASSET_VER || '20261102a'), function (gltf) {
      try {
        setup(K, gltf.scene);
        draco.dispose();
      } catch (e) {
        CM.ready = false;
        console.error('高精度模型装配失败，保留原模型：', e);
      }
    }, undefined, function (err) {
      CM.ready = false;
      console.warn('高精度模型加载失败，保留原模型：', err);
    });
  };

  CM.driverEye = function () {
    return upperLocal({ x: 7.15, y: 34.55, z: 6.49 });
  };

  CM.update = function (st) {
    if (!CM.ready || !groups) return;
    var up = C.upper;
    retarget(groups.boom, SRC_A, SRC_B,
      { x: up.pivot.x, y: up.pivot.y, z: 0 }, { x: st.B.x, y: st.B.y, z: 0 }, S);
    applyHeadTransform(groups.head, st);
    retarget(groups.tie, SRC_E, SRC_D,
      { x: up.apex.x, y: up.apex.y, z: 0 }, { x: st.D.x, y: st.D.y, z: 0 }, S);

    luffPin.set(SRC_LUFF_PIN.x, SRC_LUFF_PIN.y, SRC_LUFF_PIN.z).applyMatrix4(groups.boom.matrix);
    retarget(groups.aframe, SRC_AFRAME_TOP, SRC_LUFF_PIN, aframeTop, luffPin, S);
    rackDrivePivot.z = luffPin.z;
    var rackAngle = Math.atan2(luffPin.y - rackDrivePivot.y, luffPin.x - rackDrivePivot.x);
    placeRackPart(groups.rackDrive, SRC_RACK_DRIVE, rackDrivePivot, rackAngle);
    placeRackPart(groups.rackSlider, SRC_RACK_PIN, luffPin, rackAngle);
    _luffMid.set((aframeTop.x + luffPin.x) / 2, (aframeTop.y + luffPin.y) / 2, luffPin.z);
    setHotBox(CM.K, 'aframe', _luffMid, { x: 3.4, y: 4.2, z: 3.0 });
    setHotBox(CM.K, 'rack', rackDrivePivot, { x: 2.4, y: 2.0, z: 3.0 });

    /* 完整颚板绕顶部 X 铰轴开合，闭合 0°、全开 30°；顶部吊点保持不动 */
    var jawAngle = st.grabOpen * 30 * Math.PI / 180;
    rotateJaw(groups.jawNeg, jawAngle);
    rotateJaw(groups.jawPos, -jawAngle);
    updateContents(st);
  };

  w.CRANE_MODEL = CM;
})(window);
