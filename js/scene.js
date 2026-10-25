/* =============================================================
 * scene.js — 渲染器、相机、光照、码头环境、散货船、自卸卡车
 * ============================================================= */
(function (w) {
  'use strict';

  var V3 = THREE.Vector3;
  var C = w.CFG;

  var S = {
    renderer: null, scene: null, camera: null, controls: null,
    grid: null, tagsOn: true, _fly: null, _view: 'iso',
  };

  /* ---------------- 相机预设 ---------------- */
  S.views = {
    iso:   { pos: [78, 54, 82], tgt: [6, 14, 17] },
    side:  { pos: [104, 32, 6], tgt: [6, 22, 2] },
    front: { pos: [6, 32, 100], tgt: [6, 22, 12] },
    top:   { pos: [6, 128, 8], tgt: [6, 0, 8] },
    cab:   { follow: true },
  };

  S.init = function (container) {
    var width = container.clientWidth, height = container.clientHeight;

    var renderer = new THREE.WebGLRenderer({
      antialias: true, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(w.devicePixelRatio || 1, 1.4));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    container.appendChild(renderer.domElement);
    S.renderer = renderer;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xccd9e6);
    scene.fog = new THREE.Fog(0xccd9e6, 130, 320);
    S.scene = scene;

    var cam = new THREE.PerspectiveCamera(40, width / height, 0.4, 700);
    cam.position.set(78, 54, 82);
    S.camera = cam;

    var ctl = new THREE.OrbitControls(cam, renderer.domElement);
    ctl.target.set(6, 14, 17);
    ctl.enableDamping = true;
    ctl.dampingFactor = 0.075;
    ctl.minDistance = 6;
    ctl.maxDistance = 220;
    ctl.maxPolarAngle = Math.PI * 0.495;
    ctl.update();
    S.controls = ctl;

    this._lights();
    this._environment();

    w.addEventListener('resize', S.resize);
    return S;
  };

  /* ---------------- 画质档位 ---------------- */
  S.QUALITY = {
    high: { pr: 2.0, shadowSize: 2048, shadow: true },
    mid:  { pr: 1.3, shadowSize: 1024, shadow: true },
    low:  { pr: 1.0, shadowSize: 512,  shadow: false },
  };
  S.quality = 'mid';

  S.setQuality = function (name) {
    var q = S.QUALITY[name];
    if (!q) return;
    S.quality = name;
    var r = S.renderer;
    var dpr = w.devicePixelRatio || 1;
    r.setPixelRatio(Math.min(dpr, q.pr));
    r.setSize(r.domElement.clientWidth, r.domElement.clientHeight);
    r.shadowMap.enabled = q.shadow;
    if (S.sun) {
      if (S.sun.shadow.map) { S.sun.shadow.map.dispose(); S.sun.shadow.map = null; }
      S.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      S.sun.castShadow = q.shadow;
    }
  };

  S._lights = function () {
    var scene = S.scene;
    scene.add(new THREE.HemisphereLight(0xeef5fd, 0x9aa7b4, 0.66));

    var sun = new THREE.DirectionalLight(0xfff3e2, 1.28);
    sun.position.set(58, 76, 46);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -66;
    sun.shadow.camera.right = 66;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -46;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    S.sun = sun;

    var fill = new THREE.DirectionalLight(0xcfe2f5, 0.34);
    fill.position.set(-50, 28, -38);
    scene.add(fill);

    var rim = new THREE.DirectionalLight(0xffffff, 0.16);
    rim.position.set(-12, 20, 64);
    scene.add(rim);
  };

  /* ---------------- 码头环境 ---------------- */
  S._environment = function () {
    var scene = S.scene;

    var tex = (function () {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#9fabba';
      ctx.fillRect(0, 0, 256, 256);
      var img = ctx.getImageData(0, 0, 256, 256);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var n = (Math.random() - 0.5) * 20;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = 'rgba(126,138,152,.42)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 128); ctx.lineTo(256, 128);
      ctx.moveTo(128, 0); ctx.lineTo(128, 256);
      ctx.stroke();
      var t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(28, 8);
      t.anisotropy = 4;
      t.encoding = THREE.sRGBEncoding;
      return t;
    })();

    var M = {
      concrete: new THREE.MeshStandardMaterial({
        color: 0xffffff, map: tex, metalness: 0.02, roughness: 0.94,
      }),
      rail: U.paint(0x6c7884, { metalness: 0.65, roughness: 0.42 }),
      tie: U.paint(0xaab2bb, { metalness: 0.05, roughness: 0.9 }),
      water: (function () {
        var cv = document.createElement('canvas');
        cv.width = cv.height = 512;
        var g = cv.getContext('2d');
        g.fillStyle = '#7f95a6';
        g.fillRect(0, 0, 512, 512);
        /* 波纹：多层随机短弧，模拟风浪 */
        for (var i = 0; i < 900; i++) {
          var x = Math.random() * 512, y = Math.random() * 512;
          var r = 6 + Math.random() * 26;
          var a0 = Math.random() * Math.PI * 2;
          g.beginPath();
          g.arc(x, y, r, a0, a0 + 0.5 + Math.random() * 0.7);
          g.strokeStyle = 'rgba(255,255,255,' + (0.05 + Math.random() * 0.13) + ')';
          g.lineWidth = 0.8 + Math.random() * 2.2;
          g.stroke();
        }
        for (var j = 0; j < 500; j++) {
          var x2 = Math.random() * 512, y2 = Math.random() * 512;
          g.beginPath();
          g.arc(x2, y2, 3 + Math.random() * 14, 0, Math.PI * 2);
          g.fillStyle = 'rgba(38,66,84,' + (0.05 + Math.random() * 0.12) + ')';
          g.fill();
        }
        var t = new THREE.CanvasTexture(cv);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(26, 26);
        t.anisotropy = 4;
        t.encoding = THREE.sRGBEncoding;
        return new THREE.MeshStandardMaterial({
          color: 0x5d7f96, metalness: 0.62, roughness: 0.30,
          map: t, bumpMap: t, bumpScale: 0.35,
        });
      })(),
    };

    var water = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), M.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -1.55, 0);
    water.receiveShadow = true;
    scene.add(water);
    S.water = water;

    var quay = new THREE.Mesh(new THREE.BoxGeometry(170, 2.4, 46), M.concrete);
    quay.position.set(0, -1.2, -7.0);
    quay.receiveShadow = true;
    quay.castShadow = true;
    scene.add(quay);

    var edge = new THREE.Mesh(
      new THREE.BoxGeometry(170, 0.55, 0.5),
      U.paint(0x8f9aa5, { roughness: 0.8 })
    );
    edge.position.set(0, -0.62, 15.85);
    edge.receiveShadow = true;
    scene.add(edge);

    /* 轨道与轨枕 */
    var tieGeoms = [];
    var span = C.machine.railSpan / 2;
    for (var s = -1; s <= 1; s += 2) {
      var z = s * span;
      var rail = U.mesh(new THREE.BoxGeometry(80, 0.16, 0.42), M.rail, scene);
      rail.position.set(0, 0.08, z);
      for (var x = -38; x <= 38; x += 1.6) {
        tieGeoms.push(U.box(1.05, 0.14, 2.3, x, -0.05, z));
      }
    }
    U.mesh(U.merge(tieGeoms), M.tie, scene);

    /* 铺面网格 */
    var gv = [];
    var GX0 = -84, GX1 = 84, GZ0 = -29, GZ1 = 15.6, GS = 3.2;
    for (var gx = GX0; gx <= GX1; gx += GS) {
      gv.push(new V3(gx, 0.012, GZ0), new V3(gx, 0.012, GZ1));
    }
    for (var gz = GZ0; gz <= GZ1; gz += GS) {
      gv.push(new V3(GX0, 0.012, gz), new V3(GX1, 0.012, gz));
    }
    var grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gv),
      new THREE.LineBasicMaterial({ color: 0x8d99a8, transparent: true, opacity: 0.28 })
    );
    scene.add(grid);
    S.grid = grid;

    /* 车道标线 */
    var yellow = [];
    for (var ty = -1; ty <= 1; ty += 2) {
      var lz = ty * 11.5;
      for (var tx = -40; tx <= 40; tx += 2.0) {
        yellow.push(new V3(tx, 0.016, lz), new V3(tx + 1.1, 0.016, lz));
      }
    }
    scene.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(yellow),
      new THREE.LineBasicMaterial({ color: 0xd9a53a, transparent: true, opacity: 0.6 })
    ));

    this._yard(scene);
    this._ship(scene);
    this._truck(scene);

    for (var i = -2; i <= 2; i++) {
      var bollard = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.26, 0.75, 10),
        U.paint(0x6b7683, { metalness: 0.5, roughness: 0.5 })
      );
      bollard.position.set(i * 14 - 3, 0.37, 15.0);
      bollard.castShadow = true;
      scene.add(bollard);
    }
  };

  /* ---------------- 后方堆场 ---------------- */
  S._yard = function (scene) {
    var palette = [0x45637f, 0x8a5a45, 0x46705f, 0x74787f, 0x8a7a48];
    var mats = palette.map(function (c) {
      return U.paint(c, { metalness: 0.18, roughness: 0.78 });
    });
    var byMat = palette.map(function () { return []; });

    function stack(x0, z0, cols, rows) {
      for (var c = 0; c < cols; c++) {
        var hRows = rows - (Math.random() < 0.3 ? 1 : 0);
        for (var r = 0; r < hRows; r++) {
          var mi = Math.floor(Math.random() * palette.length);
          byMat[mi].push(U.box(6.06, 2.59, 2.44,
            x0 + c * 6.6, 1.3 + r * 2.62, z0));
        }
      }
    }
    stack(-50, -19.5, 5, 3);
    stack(-50, -22.7, 5, 2);
    stack(-16, -19.5, 4, 2);

    for (var i = 0; i < palette.length; i++) {
      if (!byMat[i].length) continue;
      var m = U.mesh(U.merge(byMat[i]), mats[i], scene);
      m.castShadow = true; m.receiveShadow = true;
    }
  };

  /* ---------------- 散货船 ---------------- */
  S._ship = function (scene) {
    var sh = C.scene.ship;
    var hullM = U.paint(C.colors.hull, { metalness: 0.55, roughness: 0.48 });
    var deckM = U.paint(0x46515c, { metalness: 0.32, roughness: 0.66 });
    var white = U.paint(0xe6eaee, { metalness: 0.15, roughness: 0.72 });
    var sandM = new THREE.MeshStandardMaterial({ color: 0xb0905a, metalness: 0.02, roughness: 0.95, emissive: 0x3a2c14, emissiveIntensity: 0.45 });

    var L = sh.length, B = sh.width, Z = sh.z, X = sh.x;
    var deckY = sh.deckY;

    /* 船体轮廓：首尾用二次曲线收窄的放样形（俯视轮廓挤出成型） */
    function hullShape(len, wid, bow, stern) {
      var hl = len / 2, hb = wid / 2;
      var sp = new THREE.Shape();
      sp.moveTo(-hl + stern, -hb);
      sp.lineTo(hl - bow, -hb);
      sp.quadraticCurveTo(hl - bow * 0.22, -hb, hl, -hb * 0.40);
      sp.quadraticCurveTo(hl + bow * 0.18, 0, hl, hb * 0.40);
      sp.quadraticCurveTo(hl - bow * 0.22, hb, hl - bow, hb);
      sp.lineTo(-hl + stern, hb);
      sp.quadraticCurveTo(-hl + stern * 0.30, hb, -hl, hb * 0.58);
      sp.quadraticCurveTo(-hl - stern * 0.10, 0, -hl, -hb * 0.58);
      sp.quadraticCurveTo(-hl + stern * 0.30, -hb, -hl + stern, -hb);
      return sp;
    }

    /* 水线以下：实心船体（红棕防污漆） */
    var gUnder = new THREE.ExtrudeGeometry(
      hullShape(L - 0.5, B - 0.7, 11.5, 5.5),
      { depth: 6.4, bevelEnabled: false, curveSegments: 18 });
    gUnder.rotateX(-Math.PI / 2);
    gUnder.translate(X, -4.4, Z);
    var underM = U.paint(0x7d4038, { metalness: 0.35, roughness: 0.72 });
    var mUnder = new THREE.Mesh(gUnder, underM);
    mUnder.castShadow = true; mUnder.receiveShadow = true;
    scene.add(mUnder);

    /* 水线以上舷侧：环形壳（挖去内部，保证舱口通透） */
    var outerS = hullShape(L, B, 12.5, 6.0);
    var innerPts = hullShape(L - 1.0, B - 1.0, 11.7, 5.4).getPoints(80).reverse();
    var holeP = new THREE.Path();
    holeP.setFromPoints(innerPts);
    outerS.holes.push(holeP);
    var gSide = new THREE.ExtrudeGeometry(outerS,
      { depth: 2.45, bevelEnabled: false, curveSegments: 18 });
    gSide.rotateX(-Math.PI / 2);
    gSide.translate(X, 2.0, Z);
    var mSide = new THREE.Mesh(gSide, hullM);
    mSide.castShadow = true; mSide.receiveShadow = true;
    scene.add(mSide);

    /* 水线带（亮色分界） */
    var blt = [];
    for (var bsd = -1; bsd <= 1; bsd += 2) {
      blt.push(U.box(L - 18, 0.28, 0.14, X, 2.05, Z + bsd * (B / 2 - 0.02)));
    }
    U.mesh(U.merge(blt), U.paint(0xd8dde2, { roughness: 0.6, metalness: 0.2 }), scene, false);

    /* 甲板：环绕舱口分块铺装，中间留出开口 */
    var hx0p = sh.holdX0, hx1p = sh.holdX1, hwp = sh.holdHalfW;
    var hX0 = X + hx0p, hX1 = X + hx1p;
    var hZ0 = Z - hwp, hZ1 = Z + hwp;
    var dX0 = X - L / 2 + 0.6, dX1 = X + L / 2 - 0.6;
    var dZ0 = Z - B / 2 + 0.6, dZ1 = Z + B / 2 - 0.6;
    var dk = [];

    if (hX0 > dX0) dk.push(U.box(hX0 - dX0, 0.32, B - 1.2, (dX0 + hX0) / 2, deckY - 0.1, Z));
    if (dX1 > hX1) dk.push(U.box(dX1 - hX1, 0.32, B - 1.2, (hX1 + dX1) / 2, deckY - 0.1, Z));
    dk.push(U.box(hX1 - hX0, 0.32, hZ0 - dZ0, (hX0 + hX1) / 2, deckY - 0.1, (dZ0 + hZ0) / 2));
    dk.push(U.box(hX1 - hX0, 0.32, dZ1 - hZ1, (hX0 + hX1) / 2, deckY - 0.1, (hZ1 + dZ1) / 2));

    U.mesh(U.merge(dk), deckM, scene);

    /* 舷墙：沿船体轮廓的薄环，首尾自然跟随曲线 */
    var wOut = hullShape(L - 0.2, B - 0.2, 12.3, 5.9);
    var wInPts = hullShape(L - 1.1, B - 1.1, 11.8, 5.5).getPoints(80).reverse();
    var wHole = new THREE.Path();
    wHole.setFromPoints(wInPts);
    wOut.holes.push(wHole);
    var gWall = new THREE.ExtrudeGeometry(wOut,
      { depth: 0.92, bevelEnabled: false, curveSegments: 18 });
    gWall.rotateX(-Math.PI / 2);
    gWall.translate(X, deckY - 0.02, Z);
    var mWall = new THREE.Mesh(gWall, hullM);
    mWall.castShadow = true; mWall.receiveShadow = true;
    scene.add(mWall);

    /* 舷墙顶栏杆 */
    var rail = [];
    var railPts = hullShape(L - 0.55, B - 0.55, 12.1, 5.8).getPoints(64);
    for (var ri = 0; ri < railPts.length - 1; ri += 2) {
      var rp = railPts[ri];
      rail.push(U.tube(
        { x: X + rp.x, y: deckY + 0.90, z: Z - rp.y },
        { x: X + rp.x, y: deckY + 1.32, z: Z - rp.y }, 0.035, 4));
    }
    for (var rj = 0; rj < railPts.length - 1; rj++) {
      var a1 = railPts[rj], a2 = railPts[rj + 1];
      if (rj % 2) continue;
      rail.push(U.tube(
        { x: X + a1.x, y: deckY + 1.31, z: Z - a1.y },
        { x: X + a2.x, y: deckY + 1.31, z: Z - a2.y }, 0.03, 4));
    }
    U.mesh(U.merge(rail), U.paint(0xd6dbe0, { metalness: 0.6, roughness: 0.45 }), scene, false);

    /* 货舱：开口 + 舱内沙堆 */
    var hx0 = sh.holdX0, hx1 = sh.holdX1;
    var hl = hx1 - hx0, hw = sh.holdHalfW * 2;

    /* 舱口围板 */
    var coam = [];
    for (var c = -1; c <= 1; c += 2) {
      coam.push(U.box(hl, 1.55, 0.50, X + (hx0 + hx1) / 2, deckY + 0.86, Z + c * sh.holdHalfW));
      coam.push(U.box(0.50, 1.55, hw, X + (c < 0 ? hx0 : hx1), deckY + 0.86, Z));
    }
    U.mesh(U.merge(coam), deckM, scene);

    /* 舱内沙面 */
    var sandTop = new THREE.Mesh(
      new THREE.BoxGeometry(hl - 0.4, 2.6, hw - 0.4),
      sandM
    );
    sandTop.position.set(X + (hx0 + hx1) / 2, sh.holdY - 1.3, Z);
    sandTop.receiveShadow = true;
    scene.add(sandTop);
    S.holdSand = sandTop;

    /* 舱内壁（沿舱口四周的深色竖壁，不遮挡沙面） */
    var innerM = U.paint(0x243039, { metalness: 0.25, roughness: 0.85 });
    var iw = [];
    for (var iwc = -1; iwc <= 1; iwc += 2) {
      iw.push(U.box(hl - 0.5, 3.0, 0.12, X + (hx0 + hx1) / 2, deckY - 1.6, Z + iwc * (sh.holdHalfW - 0.3)));
      iw.push(U.box(0.12, 3.0, hw - 0.5, X + (iwc < 0 ? hx0 : hx1), deckY - 1.6, Z));
    }
    U.mesh(U.merge(iw), innerM, scene);

    /* 船楼 */
    var sb = [];
    sb.push(U.box(13, 8.2, B - 2.4, X - L / 2 + 8, deckY + 4.1, Z));
    sb.push(U.box(15, 0.5, B - 1.8, X - L / 2 + 8, deckY + 8.5, Z));
    sb.push(U.box(2.8, 1.6, 2.8, X - L / 2 + 6, deckY + 11.0, Z));
    /* 烟囱 */
    var fun = new THREE.CylinderGeometry(0.95, 1.15, 4.2, 14);
    fun.applyMatrix4(new THREE.Matrix4().makeTranslation(X - L / 2 + 3.4, deckY + 10.2, Z));
    sb.push(fun);
    /* 船楼前后围壁 */
    sb.push(U.box(0.35, 3.2, B - 3.0, X - L / 2 + 1.4, deckY + 1.6, Z));
    sb.push(U.box(0.35, 3.2, B - 3.0, X - L / 2 + 14.6, deckY + 1.6, Z));
    U.mesh(U.merge(sb), white, scene);
    var cap = new THREE.CylinderGeometry(1.05, 1.05, 0.55, 14);
    cap.applyMatrix4(new THREE.Matrix4().makeTranslation(X - L / 2 + 3.4, deckY + 12.5, Z));
    var mCap = new THREE.Mesh(cap, U.paint(0x2b3542, { metalness: 0.4, roughness: 0.6 }));
    mCap.castShadow = true;
    scene.add(mCap);

    var wins = [];
    for (var k = 0; k < 3; k++) {
      wins.push(U.box(13.2, 0.65, B - 2.1, X - L / 2 + 8, deckY + 4.4 + k * 1.7, Z));
    }
    U.mesh(U.merge(wins), U.paint(0x35424f, { metalness: 0.7, roughness: 0.3 }), scene, false);

    /* 桅杆 */
    U.mesh(U.tube(
      { x: X - L / 2 + 6, y: deckY + 11.8, z: Z },
      { x: X - L / 2 + 6, y: deckY + 16.0, z: Z }, 0.16, 8
    ), deckM, scene);
  };

  /* ---------------- 自卸卡车 ---------------- */
  S._truck = function (scene) {
    var tk = C.scene.truck;
    var bodyM = U.paint(0x2f6fb5, { metalness: 0.45, roughness: 0.42 });
    var darkM = U.paint(0x2c3642, { metalness: 0.5, roughness: 0.55 });
    var tireM = U.paint(0x1e242b, { metalness: 0.1, roughness: 0.9 });
    var sandM = new THREE.MeshStandardMaterial({ color: 0xb0905a, metalness: 0.02, roughness: 0.95, emissive: 0x3a2c14, emissiveIntensity: 0.45 });

    var X = tk.x, Z = tk.z;
    var g = [];

    /* 车架（大梁 + 横梁） */
    g.push(U.box(10.8, 0.46, 2.46, X, 0.98, Z));
    for (var cr = -1; cr <= 1; cr += 2) {
      g.push(U.box(10.4, 0.30, 0.30, X, 1.30, Z + cr * 0.92));
    }

    /* 车轮：前后各两轴，共 8 个 */
    var wr = 0.74;
    for (var a = -1; a <= 1; a += 2) {
      for (var b = -1; b <= 1; b += 2) {
        for (var c2 = 0; c2 < 2; c2++) {
          var wx = X + a * 3.30 + (a > 0 ? c2 * 1.42 : -c2 * 1.42);
          var wg = new THREE.CylinderGeometry(wr, wr, 0.50, 20);
          wg.applyMatrix4(new THREE.Matrix4()
            .makeRotationX(Math.PI / 2)
            .premultiply(new THREE.Matrix4()
              .makeTranslation(wx, wr, Z + b * 1.02)));
          g.push(wg);
        }
      }
    }
    U.mesh(U.merge(g), darkM, scene);

    /* 轮毂 */
    var hub = [];
    for (var ha = -1; ha <= 1; ha += 2) {
      for (var hb = -1; hb <= 1; hb += 2) {
        for (var hc = 0; hc < 2; hc++) {
          var hx = X + ha * 3.30 + (ha > 0 ? hc * 1.42 : -hc * 1.42);
          var hg = new THREE.CylinderGeometry(0.34, 0.34, 0.56, 14);
          hg.applyMatrix4(new THREE.Matrix4()
            .makeRotationX(Math.PI / 2)
            .premultiply(new THREE.Matrix4()
              .makeTranslation(hx, wr, Z + hb * 1.04)));
          hub.push(hg);
        }
      }
    }
    U.mesh(U.merge(hub), U.paint(0x9aa4b0, { metalness: 0.75, roughness: 0.4 }), scene, false);

    /* 驾驶室 */
    var cabG = [];
    cabG.push(U.box(2.55, 2.45, 2.52, X + 4.35, 2.42, Z));
    cabG.push(U.box(2.68, 0.38, 2.62, X + 4.35, 3.78, Z));
    /* 前保险杠与踏板 */
    cabG.push(U.box(0.35, 0.55, 2.60, X + 5.68, 1.18, Z));
    cabG.push(U.box(2.2, 0.16, 0.55, X + 4.35, 1.34, Z + 1.35));
    U.mesh(U.merge(cabG), bodyM, scene);

    var win = U.box(0.06, 1.12, 2.16, X + 5.66, 2.92, Z);
    U.mesh(win, U.paint(0x2a3b4d, { metalness: 0.8, roughness: 0.2 }), scene, false);
    for (var wsd = -1; wsd <= 1; wsd += 2) {
      U.mesh(U.box(2.1, 0.95, 0.05, X + 4.15, 2.92, Z + wsd * 1.27),
        U.paint(0x2a3b4d, { metalness: 0.8, roughness: 0.2 }), scene, false);
    }
    /* 排气管 */
    U.mesh(U.tube(
      { x: X + 3.15, y: 3.35, z: Z - 1.28 },
      { x: X + 3.15, y: 4.55, z: Z - 1.28 }, 0.11, 8),
      U.paint(0x76808c, { metalness: 0.8, roughness: 0.42 }), scene);

    /* 车厢（开口斗） */
    var bedY = tk.bedY, bl = tk.bedL, bw2 = tk.bedW;
    var bedX = X - 1.35;
    var bed = [];
    bed.push(U.box(bl, 0.22, bw2, bedX, bedY, Z));
    bed.push(U.box(bl, 1.42, 0.16, bedX, bedY + 0.75, Z + bw2 / 2));
    bed.push(U.box(bl, 1.42, 0.16, bedX, bedY + 0.75, Z - bw2 / 2));
    bed.push(U.box(0.16, 1.42, bw2, bedX - bl / 2, bedY + 0.75, Z));
    /* 尾门 */
    bed.push(U.box(0.18, 1.58, bw2, bedX + bl / 2, bedY + 0.80, Z));
    /* 侧板加强筋 */
    for (var rb = -1; rb <= 1; rb += 2) {
      for (var rk = -2; rk <= 2; rk++) {
        bed.push(U.box(0.10, 1.30, 0.09, bedX + rk * bl / 6, bedY + 0.74, Z + rb * (bw2 / 2 + 0.03)));
      }
    }
    U.mesh(U.merge(bed), bodyM, scene);

    /* 斗内沙堆（高度随装载量变化） */
    var cargo = new THREE.Mesh(
      new THREE.BoxGeometry(bl - 0.3, 1.0, bw2 - 0.3), sandM
    );
    cargo.position.set(bedX, bedY + 0.1, Z);
    cargo.scale.y = 0.02;
    cargo.visible = false;
    cargo.castShadow = true;
    cargo.receiveShadow = true;
    scene.add(cargo);
    S.truckSand = cargo;
    S.truckBed = { x: bedX, y: bedY, z: Z, l: bl, w: bw2 };
  };

  /* ---------------- 视角 ---------------- */
  S.applyView = function (name) {
    S._view = name;
    var v = S.views[name];
    if (!v || v.follow) { S.controls.enabled = false; return; }
    S.controls.enabled = true;
    S.flyTo(v.pos, v.tgt);
  };

  S.flyTo = function (pos, tgt) {
    S._fly = {
      t: 0, dur: 0.55,
      fromP: S.camera.position.clone(),
      fromT: S.controls.target.clone(),
      toP: new V3(pos[0], pos[1], pos[2]),
      toT: new V3(tgt[0], tgt[1], tgt[2]),
    };
  };

  S.setCabView = function (pos, tgt) {
    S.camera.position.copy(pos);
    S.camera.lookAt(tgt);
  };

  S.updateFly = function (dt) {
    var f = S._fly;
    if (!f) return;
    f.t += dt;
    var k = Math.min(f.t / f.dur, 1);
    k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    S.camera.position.lerpVectors(f.fromP, f.toP, k);
    S.controls.target.lerpVectors(f.fromT, f.toT, k);
    S.controls.update();
    if (f.t >= f.dur) S._fly = null;
  };

  S.setGrid = function (on) { if (S.grid) S.grid.visible = on; };

  S.resize = function () {
    var el = S.renderer.domElement.parentElement;
    var ww = el.clientWidth, hh = el.clientHeight;
    S.camera.aspect = ww / hh;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(ww, hh);
  };

  S.render = function () { S.renderer.render(S.scene, S.camera); };

  w.SCENE = S;
})(window);
