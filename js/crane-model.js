/* =============================================================
 * crane-model.js — 高精度 GLB 门机模型加载与运动重定向
 *
 * 源模型为独立顶层部件。加载后按结构拆成：
 *   门架/行走机构（root）、转台以上（upper）、主臂、象鼻梁、
 *   大拉杆和抓斗。运动部件用源铰点→仿真铰点的矩阵重定向，
 *   因此仍由原四连杆解算驱动，而不是仅替换静态外壳。
 * ============================================================= */
(function (w) {
  'use strict';

  var C = w.CFG;
  var CM = { ready: false, loading: false, K: null };
  var S = 0.82;                       // 源模型 → 仿真尺寸
  var SRC_A = { x: 0.065, y: 28.784, z: -0.506 };
  /* 象鼻梁三角：B=主臂铰点，D=大拉杆铰点，C=起升滑轮 */
  var SRC_B = { x: 21.501, y: 48.800, z: -0.502 };
  var SRC_D = { x: 17.979, y: 53.114, z: -0.502 };
  var SRC_C = { x: 36.150, y: 41.591, z: -0.502 };
  var SRC_E = { x: -5.138, y: 41.100, z: -0.487 };
  var SRC_GRAB_TOP = { x: 35.782, y: 34.209, z: -0.484 };
  /* Line029/Line038 才是真正的两侧颚板，铰轴位于二者上缘 */
  var SRC_JAW_HINGE = { x: 35.804, y: 31.795, z: -0.4655 };
  var OFFSET = {
    x: 0,
    y: C.machine.portalHeight + C.machine.slewBearingH + C.upper.pivot.y - S * SRC_A.y,
    z: -S * SRC_A.z,
  };

  var groups = null;
  var rackEndAligned = new THREE.Vector3();
  var aframeLowerSrc = new THREE.Vector3();
  var rackBridge = null;
  var _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
  var _t = new THREE.Matrix4(), _sc = new THREE.Matrix4();

  function isLower(name) {
    return name === '门架总成' || name === 'xingzouzu' || name === '下接料板' ||
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

  /* 变幅机构在源文件中按水平姿态建模，挂到主臂前需绕 A 点转到源臂架角 */
  function alignRackToBoom(node) {
    var ang = Math.atan2(SRC_B.y - SRC_A.y, SRC_B.x - SRC_A.x);
    var m = new THREE.Matrix4()
      .makeTranslation(SRC_A.x, SRC_A.y, SRC_A.z)
      .multiply(new THREE.Matrix4().makeRotationZ(ang))
      .multiply(new THREE.Matrix4().makeTranslation(-SRC_A.x, -SRC_A.y, -SRC_A.z));
    node.applyMatrix4(m);
    rackEndAligned.set(3.93, 36.57, -0.484).applyMatrix4(m);
  }

  /* 找蓝色人字架上距齿条销点最近的顶点，作为补接杆起点 */
  function nearestVertex(node, target) {
    node.updateWorldMatrix(true, true);
    var best = null, bestD = Infinity;
    node.traverse(function (o) {
      if (!o.isMesh) return;
      var p = o.geometry.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld);
        var d = v.distanceToSquared(target);
        if (d < bestD) { bestD = d; best = v; }
      }
    });
    return best;
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
      K.grabBody.children.forEach(function (o) { if (o !== K.grabSand) o.visible = false; });
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
      a.aframe = pointUpper({ x: 1.48, y: 39.14, z: -0.58 }, st);
      a.cab = pointUpper({ x: 6.15, y: 34.15, z: 6.49 }, st);
      a.cw = pointUpper({ x: -6.25, y: 43.11, z: -0.40 }, st);
      a.rack = pointUpper({ x: 0.17, y: 35.92, z: -0.52 }, st);
      return a;
    };
  }

  function setup(K, model) {
    hideProcedural(K);
    tuneMaterials(model);
    var source = model.getObjectByName('RootNode') || model;
    var lower = new THREE.Group(), upper = new THREE.Group();
    var boom = new THREE.Group(), head = new THREE.Group(), tie = new THREE.Group();
    var grab = new THREE.Group();
    lower.name = 'CAD_门架与行走机构';
    upper.name = 'CAD_回转上部';
    boom.name = 'CAD_主臂'; head.name = 'CAD_象鼻梁'; tie.name = 'CAD_大拉杆';
    grab.name = 'CAD_抓斗';

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

    var grabScale = C.grab.height / (34.209 - 29.818);
    grab.scale.setScalar(grabScale);
    grab.position.set(-SRC_GRAB_TOP.x * grabScale, -SRC_GRAB_TOP.y * grabScale, -SRC_GRAB_TOP.z * grabScale);
    K.grabBody.add(grab);
    var grabShell = new THREE.Group(), jawNeg = new THREE.Group(), jawPos = new THREE.Group();
    grabShell.name = 'CAD_抓斗顶部'; jawNeg.name = 'CAD_左颚板'; jawPos.name = 'CAD_右颚板';
    grab.add(grabShell); grab.add(jawNeg); grab.add(jawPos);

    var children = source.children.slice();
    var aframeNode = null;
    children.forEach(function (node) {
      var name = node.name || '';
      if (name === '对象076' || isRope(name)) return;
      if (name === '臂架-动画3') boom.add(node);
      else if (name === '臂架动画2') head.add(node);
      else if (name === '臂架动画1') tie.add(node);
      else if (name === '组002') { alignRackToBoom(node); boom.add(node); }
      else if (name === '臂架-人字形') { aframeNode = node; upper.add(node); }
      else if (name === 'Line029') jawPos.add(node);
      else if (name === 'Line038') jawNeg.add(node);
      else if (isGrabPart(name)) grabShell.add(node);
      else if (isLower(name)) lower.add(node);
      else upper.add(node);
    });

    if (aframeNode) {
      var v = nearestVertex(aframeNode, rackEndAligned);
      if (v) aframeLowerSrc.copy(v);
    }
    mergeGroup(lower); mergeGroup(upper); mergeGroup(boom);
    mergeGroup(head); mergeGroup(tie); mergeGroup(grabShell);
    mergeGroup(jawNeg); mergeGroup(jawPos);
    /* 蓝色斜撑补接杆：一端固定在人字架下缘，另一端追随主臂齿条销点 */
    rackBridge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0x185fa5, metalness: 0.25, roughness: 0.5 })
    );
    rackBridge.castShadow = true;
    rackBridge.receiveShadow = true;
    rackBridge.name = 'CAD_齿条补接杆';
    K.upper.add(rackBridge);
    /* 底座（门架下部 + 四组行走轮组）整体绕竖轴旋转 90° */
    lower.rotation.y = Math.PI / 2;
    jawNeg.matrixAutoUpdate = false; jawPos.matrixAutoUpdate = false;
    groups = { lower: lower, upper: upper, boom: boom, head: head, tie: tie,
      grab: grab, jawNeg: jawNeg, jawPos: jawPos };
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
    loader.load('assets/models/portal-crane.glb?v=' + (window.ASSET_VER || '20261028c'), function (gltf) {
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

  CM.update = function (st) {
    if (!CM.ready || !groups) return;
    var up = C.upper;
    retarget(groups.boom, SRC_A, SRC_B,
      { x: up.pivot.x, y: up.pivot.y, z: 0 }, { x: st.B.x, y: st.B.y, z: 0 }, S);
    applyHeadTransform(groups.head, st);
    retarget(groups.tie, SRC_E, SRC_D,
      { x: up.apex.x, y: up.apex.y, z: 0 }, { x: st.D.x, y: st.D.y, z: 0 }, S);

    if (rackBridge) {
      var p0 = upperLocal(aframeLowerSrc);
      var p1 = rackEndAligned.clone().applyMatrix4(groups.boom.matrix);
      var d = p1.clone().sub(p0);
      var len = d.length();
      rackBridge.position.set((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
      rackBridge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      rackBridge.scale.set(1, Math.max(len, 0.01), 1);
    }

    /* 完整颚板绕顶部 X 铰轴开合，闭合 0°、全开 30°；顶部吊点保持不动 */
    var jawAngle = st.grabOpen * 30 * Math.PI / 180;
    rotateJaw(groups.jawNeg, jawAngle);
    rotateJaw(groups.jawPos, -jawAngle);
  };

  w.CRANE_MODEL = CM;
})(window);
