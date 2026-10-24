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
      water: new THREE.MeshStandardMaterial({
        color: 0x5c7f99, metalness: 0.70, roughness: 0.18,
      }),
    };

    var water = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), M.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -1.55, 0);
    water.receiveShadow = true;
    scene.add(water);

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
    var deckM = U.paint(0x59636e, { metalness: 0.30, roughness: 0.68 });
    var white = U.paint(0xe6eaee, { metalness: 0.15, roughness: 0.72 });
    var sandM = new THREE.MeshStandardMaterial({ color: C.colors.sand, metalness: 0.02, roughness: 0.95, emissive: 0x4a3a1c, emissiveIntensity: 0.95 });

    var L = sh.length, B = sh.width, Z = sh.z, X = sh.x;
    var deckY = sh.deckY;

    /* 船体：底舱 + 舷侧（顶部开放，否则会遮住舱内物料） */
    var hp = [];
    hp.push(U.box(L, 6.4, B, X, -1.2, Z));
    hp.push(U.box(L - 3.0, 2.0, B - 2.2, X, -4.2, Z));
    for (var hsd = -1; hsd <= 1; hsd += 2) {
      hp.push(U.box(L, 2.40, 0.40, X, 3.20, Z + hsd * (B / 2 - 0.20)));
    }
    hp.push(U.box(0.40, 2.40, B, X - L / 2 + 0.20, 3.20, Z));
    hp.push(U.box(0.40, 2.40, B, X + L / 2 - 0.20, 3.20, Z));
    /* 首尾斜削 */
    hp.push(U.box(4.2, 6.4, B * 0.72, X + L / 2 + 1.6, -1.2, Z));
    hp.push(U.box(3.0, 6.4, B * 0.86, X - L / 2 - 1.0, -1.2, Z));
    U.mesh(U.merge(hp), hullM, scene);

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

    /* 舷墙 */
    var bw = [];
    for (var s = -1; s <= 1; s += 2) {
      bw.push(U.box(L, 1.25, 0.36, X, deckY + 0.72, Z + s * (B / 2 - 0.22)));
    }
    U.mesh(U.merge(bw), hullM, scene);

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
    U.mesh(U.merge(sb), white, scene);

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
    var sandM = new THREE.MeshStandardMaterial({ color: C.colors.sand, metalness: 0.02, roughness: 0.95, emissive: 0x4a3a1c, emissiveIntensity: 0.95 });

    var X = tk.x, Z = tk.z;
    var g = [];

    /* 车架 */
    g.push(U.box(8.6, 0.42, 2.35, X, 0.86, Z));

    /* 车轮 */
    for (var a = -1; a <= 1; a += 2) {
      for (var b = -1; b <= 1; b += 2) {
        var wg = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 18);
        wg.applyMatrix4(new THREE.Matrix4()
          .makeRotationX(Math.PI / 2)
          .premultiply(new THREE.Matrix4()
            .makeTranslation(X + a * 2.6 + (b > 0 ? 0 : -0.9), 0.62, Z + b * 0.95)));
        g.push(wg);
      }
    }
    U.mesh(U.merge(g), darkM, scene);

    /* 驾驶室 */
    var cabG = [];
    cabG.push(U.box(2.3, 2.10, 2.35, X + 3.55, 2.15, Z));
    cabG.push(U.box(2.4, 0.35, 2.45, X + 3.55, 3.30, Z));
    U.mesh(U.merge(cabG), bodyM, scene);

    var win = U.box(0.05, 0.95, 2.0, X + 4.71, 2.55, Z);
    U.mesh(win, U.paint(0x2a3b4d, { metalness: 0.8, roughness: 0.2 }), scene, false);

    /* 车厢（开口斗） */
    var bedY = tk.bedY, bl = tk.bedL, bw2 = tk.bedW;
    var bedX = X - 1.2;
    var bed = [];
    bed.push(U.box(bl, 0.20, bw2, bedX, bedY, Z));
    bed.push(U.box(bl, 1.15, 0.14, bedX, bedY + 0.62, Z + bw2 / 2));
    bed.push(U.box(bl, 1.15, 0.14, bedX, bedY + 0.62, Z - bw2 / 2));
    bed.push(U.box(0.14, 1.15, bw2, bedX - bl / 2, bedY + 0.62, Z));
    /* 尾门 */
    bed.push(U.box(0.16, 1.30, bw2, bedX + bl / 2, bedY + 0.66, Z));
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
