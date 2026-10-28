/* =============================================================
 * environment-hd.js — 高仿真港区环境增强
 *
 * 只替换/增强门机以外的环境对象，不改动门机运动学与交互坐标：
 *   · 海天渐变、动态水面、浪花与薄雾
 *   · 高纹理码头、轨道扣件、护舷、系缆桩、爬梯、排水与标线
 *   · 散货船甲板机械、船楼、雷达、救生艇、系泊缆
 *   · 自卸卡车灯具、后视镜、燃油箱、液压举升与挡泥板
 *   · 仓库/筒仓/堆场/堆取料机/远景岸桥与防波堤
 * ============================================================= */
(function (w) {
  'use strict';

  var S = w.SCENE;
  var C = w.CFG;
  var V3 = THREE.Vector3;
  var HD = {};

  function tex(size, draw, rx, ry, srgb) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = 4;
    if (srgb !== false) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function textTex(text, w, h, bg, fg, font) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.fillStyle = fg || '#ffffff';
    g.font = font || ('500 ' + Math.round(h * 0.52) + 'px sans-serif');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
    var t = new THREE.CanvasTexture(cv);
    t.anisotropy = 4;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function bucket() {
    return { map: new Map(), add: function (mat, geo) {
      if (!geo) return;
      if (!this.map.has(mat)) this.map.set(mat, []);
      this.map.get(mat).push(geo);
    }, flush: function (scene, shadow) {
      var self = this;
      this.map.forEach(function (arr, mat) {
        var flat = arr.map(function (g) { return g.index ? g.toNonIndexed() : g; });
        var m = U.mesh(U.merge(flat), mat, scene, shadow !== false);
        m.castShadow = shadow !== false;
        m.receiveShadow = true;
      });
      self.map.clear();
    } };
  }

  function cyl(r1, r2, h, seg, x, y, z, rx, rz) {
    var g = new THREE.CylinderGeometry(r1, r2, h, seg || 12);
    var m = new THREE.Matrix4();
    if (rx) m.makeRotationX(rx);
    if (rz) m.premultiply(new THREE.Matrix4().makeRotationZ(rz));
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    return g;
  }

  var M = {};

  function materials() {
    var conTex = tex(1024, function (g, s) {
      g.fillStyle = '#aeb7bf'; g.fillRect(0, 0, s, s);
      for (var i = 0; i < 9000; i++) {
        var v = Math.random(), a = 0.03 + Math.random() * 0.09;
        g.fillStyle = v > 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(58,70,80,' + a + ')';
        g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 4, 1 + Math.random() * 4);
      }
      for (var j = 0; j < 38; j++) {
        g.strokeStyle = 'rgba(65,78,88,' + (0.03 + Math.random() * 0.08) + ')';
        g.lineWidth = 1 + Math.random() * 7;
        g.beginPath();
        var x = Math.random() * s, y = Math.random() * s;
        g.moveTo(x, y);
        g.bezierCurveTo(x + 40, y + 20, x + 80, y - 25, x + 170, y + 8);
        g.stroke();
      }
      g.strokeStyle = 'rgba(60,72,82,.36)'; g.lineWidth = 2;
      g.strokeRect(0, 0, s, s);
      g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s);
      g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
      for (var k = 0; k < 26; k++) {
        g.fillStyle = 'rgba(52,65,74,' + (0.03 + Math.random() * 0.08) + ')';
        g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 8 + Math.random() * 55, 3 + Math.random() * 14, Math.random() * 3, 0, 6.3); g.fill();
      }
    }, 38, 18, true);
    conTex.encoding = THREE.sRGBEncoding;

    var waterA = tex(1024, function (g, s) {
      g.fillStyle = '#406b80'; g.fillRect(0, 0, s, s);
      for (var i = 0; i < 1300; i++) {
        var y = Math.random() * s, x = Math.random() * s;
        var grd = g.createLinearGradient(x, y, x + 60 + Math.random() * 90, y);
        grd.addColorStop(0, 'rgba(122,166,184,0)');
        grd.addColorStop(0.45, 'rgba(164,202,214,' + (0.05 + Math.random() * 0.12) + ')');
        grd.addColorStop(1, 'rgba(33,73,92,0)');
        g.strokeStyle = grd; g.lineWidth = 0.6 + Math.random() * 2.4;
        g.beginPath(); g.moveTo(x, y);
        g.quadraticCurveTo(x + 30, y - 5 - Math.random() * 12, x + 60 + Math.random() * 70, y + Math.random() * 6);
        g.stroke();
      }
      for (var j = 0; j < 460; j++) {
        g.fillStyle = 'rgba(20,55,72,' + (0.04 + Math.random() * 0.1) + ')';
        g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 10 + Math.random() * 40, 2 + Math.random() * 6, 0, 0, 6.3); g.fill();
      }
    }, 22, 8, true);
    var waterB = waterA.clone();
    waterB.needsUpdate = true;

    M.concrete = new THREE.MeshStandardMaterial({
      color: 0xc4c9cd, map: conTex, bumpMap: conTex, bumpScale: 0.018,
      metalness: 0.03, roughness: 0.9,
    });
    M.asphalt = new THREE.MeshStandardMaterial({ color: 0x3b4650, metalness: 0.06, roughness: 0.9 });
    M.steel = U.paint(0x78909f, { metalness: 0.72, roughness: 0.38 });
    M.darkSteel = U.paint(0x394755, { metalness: 0.58, roughness: 0.5 });
    M.blue = U.paint(0x185b91, { metalness: 0.45, roughness: 0.46 });
    M.yellow = U.paint(0xe4af2e, { metalness: 0.32, roughness: 0.52 });
    M.yellowDark = U.paint(0xb67c13, { metalness: 0.3, roughness: 0.58 });
    M.white = U.paint(0xe7ecef, { metalness: 0.2, roughness: 0.62 });
    M.red = U.paint(0xa64033, { metalness: 0.28, roughness: 0.6 });
    M.rubber = U.paint(0x171b1f, { metalness: 0.02, roughness: 0.98 });
    M.glass = new THREE.MeshStandardMaterial({
      color: 0x243c4e, metalness: 0.82, roughness: 0.15,
      transparent: true, opacity: 0.92,
    });
    M.rust = U.paint(0x8b5a3b, { metalness: 0.18, roughness: 0.92 });
    M.water = new THREE.MeshStandardMaterial({
      color: 0x6d98aa, map: waterA, bumpMap: waterB, bumpScale: 0.26,
      metalness: 0.52, roughness: 0.22,
    });
    M.hullDark = U.paint(0x263745, { metalness: 0.52, roughness: 0.5 });
    M.hatch = U.paint(0x566570, { metalness: 0.38, roughness: 0.68 });
    M.orange = U.paint(0xd56f2d, { metalness: 0.2, roughness: 0.58 });
    M.green = U.paint(0x416d55, { metalness: 0.08, roughness: 0.88 });
    M.grass = U.paint(0x4e7252, { metalness: 0.02, roughness: 0.96 });
    M.coal = new THREE.MeshStandardMaterial({ color: 0x252b2f, roughness: 0.97, metalness: 0.02 });
    M.ore = new THREE.MeshStandardMaterial({ color: 0x6b5543, roughness: 0.96, metalness: 0.02 });
    M.emissiveRed = new THREE.MeshStandardMaterial({ color: 0x4b0d09, emissive: 0xff2a18, emissiveIntensity: 1.2, roughness: 0.35 });
    M.emissiveWhite = new THREE.MeshStandardMaterial({ color: 0xffeecc, emissive: 0xfff3d0, emissiveIntensity: 1.1, roughness: 0.25 });
    M.emissiveGreen = new THREE.MeshStandardMaterial({ color: 0x0d3a16, emissive: 0x25df5c, emissiveIntensity: 0.8, roughness: 0.3 });
    M.puddle = new THREE.MeshStandardMaterial({
      color: 0x7391a1, metalness: 0.82, roughness: 0.08,
      transparent: true, opacity: 0.38, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
  }

  /* ---------------- 天空与云 ---------------- */
  function sky(scene) {
    var sh = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x79aed4) },
        mid: { value: new THREE.Color(0xc8dce9) },
        low: { value: new THREE.Color(0xe8edf0) },
      },
      vertexShader: 'varying vec3 vP; void main(){vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: [
        'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;',
        'void main(){ float h=normalize(vP).y; vec3 c=mix(low,mid,smoothstep(-0.03,0.20,h)); c=mix(c,top,smoothstep(0.18,0.78,h)); gl_FragColor=vec4(c,1.0); }',
      ].join('\n'),
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(470, 36, 20), sh);
    dome.frustumCulled = false;
    dome.renderOrder = -2;
    scene.add(dome);

    var sunTex = tex(128, function (g, s) {
      var gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,251,228,1)');
      gr.addColorStop(0.2, 'rgba(255,239,185,.9)');
      gr.addColorStop(0.55, 'rgba(255,225,160,.24)');
      gr.addColorStop(1, 'rgba(255,225,160,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, 1, 1, false);
    var sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9,
    }));
    sun.position.set(230, 185, 260); sun.scale.set(70, 70, 1);
    scene.add(sun);

    var cloudTex = tex(256, function (g, s) {
      g.clearRect(0, 0, s, s);
      for (var i = 0; i < 24; i++) {
        var x = s * (0.18 + Math.random() * 0.64), y = s * (0.42 + Math.random() * 0.2);
        var r = s * (0.07 + Math.random() * 0.13);
        var gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,.30)');
        gr.addColorStop(0.6, 'rgba(255,255,255,.13)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
      }
    }, 1, 1, false);
    var cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.7 });
    var cloudPos = [[-210, 80, 180], [50, 92, 210], [180, 76, 120], [-90, 70, 120], [150, 88, -60], [-180, 96, -100]];
    cloudPos.forEach(function (p, i) {
      var sp = new THREE.Sprite(cloudMat.clone());
      sp.position.set(p[0], p[1], p[2]);
      sp.scale.set(80 + i * 9, 26 + i * 3, 1);
      sp.material.opacity = 0.33 + (i % 3) * 0.09;
      scene.add(sp);
    });

    var gl = new THREE.Mesh(
      new THREE.PlaneGeometry(1300, 700, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xfcdf9f, transparent: true, opacity: 0.05, depthWrite: false })
    );
    gl.rotation.x = -Math.PI / 2; gl.position.set(0, -1.7, 120);
    scene.add(gl);
  }

  function water(scene) {
    if (S.water) {
      S.water.material.dispose();
      S.water.material = M.water;
      S.water.position.z = 162;
      S.water.geometry.dispose();
      S.water.geometry = new THREE.PlaneGeometry(950, 320, 1, 1);
      S.water.receiveShadow = true;
    }
    var b = bucket();
    for (var i = 0; i < 18; i++) {
      var x = -180 + i * 21;
      b.add(new THREE.MeshBasicMaterial({
        color: 0xeaf6fb, transparent: true, opacity: 0.16 + Math.random() * 0.12,
        depthWrite: false,
      }), new THREE.PlaneGeometry(18 + Math.random() * 16, 1.2 + Math.random() * 2.4)
        .rotateX(-Math.PI / 2)
        .translate(x, -1.5, 19 + Math.random() * 9));
    }
    b.flush(scene, false);

    var buoyM = U.paint(0xd94c28, { metalness: 0.22, roughness: 0.55 });
    var b2 = bucket();
    [[-95, 80], [65, 110], [140, 70], [-160, 140]].forEach(function (p) {
      b2.add(M.darkSteel, cyl(0.55, 0.8, 1.2, 12, p[0], -0.9, p[1]));
      b2.add(buoyM, cyl(0.35, 0.55, 1.9, 12, p[0], 0.2, p[1]));
      b2.add(M.emissiveRed, cyl(0.18, 0.18, 0.32, 8, p[0], 1.3, p[1]));
    });
    b2.flush(scene);
    HD.buoys = b2;
  }

  /* ---------------- 码头细部 ---------------- */
  function quay(scene) {
    if (S.land) {
      S.land.material.dispose();
      S.land.material = M.concrete;
    }
    var b = bucket();
    var span = C.machine.railSpan / 2;

    /* 铺面伸缩缝、排水沟与检修井 */
    for (var x = -188; x <= 188; x += 24) {
      b.add(M.darkSteel, U.box(0.1, 0.025, 188, x, 0.025, -80));
    }
    for (var z = -164; z <= 12; z += 24) {
      b.add(M.darkSteel, U.box(380, 0.025, 0.1, 0, 0.025, z));
    }
    for (var gx = -168; gx <= 168; gx += 12) {
      b.add(M.darkSteel, U.box(1.1, 0.04, 0.5, gx, 0.028, 12.9));
      for (var gg = -0.4; gg <= 0.4; gg += 0.2) {
        b.add(M.steel, U.box(1.0, 0.025, 0.035, gx, 0.052, 12.9 + gg));
      }
    }
    for (var mh = -150; mh <= 150; mh += 37) {
      b.add(M.darkSteel, cyl(0.58, 0.58, 0.045, 18, mh, 0.03, -18));
      b.add(M.steel, cyl(0.5, 0.5, 0.035, 18, mh, 0.056, -18));
    }

    /* 轨道基座、鱼尾板、扣件与端部警示 */
    for (var sd = -1; sd <= 1; sd += 2) {
      var rz = sd * span;
      b.add(M.asphalt, U.box(84, 0.06, 1.75, 0, 0.015, rz));
      for (var fx = -36; fx <= 36; fx += 12) {
        b.add(M.steel, U.box(0.75, 0.1, 0.58, fx, 0.16, rz));
      }
      for (var cx = -37; cx <= 37; cx += 1.6) {
        b.add(M.darkSteel, U.box(0.16, 0.15, 0.55, cx, 0.13, rz + 0.24));
        b.add(M.darkSteel, U.box(0.16, 0.15, 0.55, cx, 0.13, rz - 0.24));
      }
      for (var wx = -39; wx <= 39; wx += 6.5) {
        b.add(M.yellow, U.box(0.16, 0.03, 2.8, wx, 0.026, rz));
      }
    }
    /* 门机作业区黄色安全线 */
    for (var hx = -43; hx <= 43; hx += 3.2) {
      b.add(M.yellowDark, U.box(1.7, 0.02, 0.14, hx, 0.024, span + 2.2));
      b.add(M.yellowDark, U.box(1.7, 0.02, 0.14, hx, 0.024, -span - 2.2));
    }

    /* 系缆桩：底座 + 柱身 + 横销 + 锈迹 */
    for (var bx = -180; bx <= 180; bx += 22) {
      b.add(M.darkSteel, cyl(0.62, 0.75, 0.16, 16, bx, 0.08, 14.1));
      b.add(M.rubber, cyl(0.3, 0.38, 0.92, 14, bx, 0.55, 14.1));
      b.add(M.darkSteel, cyl(0.42, 0.42, 0.16, 14, bx, 1.04, 14.1));
      b.add(M.steel, cyl(0.12, 0.12, 1.15, 10, bx, 1.1, 14.1, Math.PI / 2, 0));
      b.add(M.rust, cyl(0.38, 0.38, 0.1, 12, bx, 0.95, 14.1));
    }

    /* 护舷与系泊链 */
    for (var fxx = -174; fxx <= 174; fxx += 12) {
      b.add(M.steel, U.box(0.6, 0.14, 0.14, fxx, 1.25, 16.2));
      b.add(M.rubber, cyl(0.34, 0.34, 2.1, 12, fxx, -0.15, 16.35));
      b.add(M.rust, cyl(0.36, 0.36, 0.25, 12, fxx, 0.72, 16.35));
    }

    /* 码头爬梯 */
    [-150, -76, -18, 42, 112, 166].forEach(function (lx) {
      for (var r = -1; r <= 1; r += 2) {
        b.add(M.steel, U.tube({ x: lx + r * 0.38, y: -1.6, z: 16.45 }, { x: lx + r * 0.38, y: 0.65, z: 16.45 }, 0.055, 6));
      }
      for (var ry = -1.45; ry <= 0.6; ry += 0.34) {
        b.add(M.steel, U.tube({ x: lx - 0.38, y: ry, z: 16.45 }, { x: lx + 0.38, y: ry, z: 16.45 }, 0.035, 6));
      }
    });

    /* 岸电箱、消防栓、摄像机杆 */
    [-126, -62, 6, 74, 148].forEach(function (px, i) {
      b.add(M.white, U.box(0.72, 1.05, 0.42, px, 0.57, 13.1));
      b.add(M.darkSteel, U.box(0.82, 0.08, 0.52, px, 1.14, 13.1));
      b.add(M.yellow, U.box(0.48, 0.06, 0.02, px, 0.75, 12.88));
      if (i % 2 === 0) {
        b.add(M.red, cyl(0.24, 0.27, 0.65, 10, px + 4.8, 0.32, 13.0));
        b.add(M.steel, cyl(0.09, 0.09, 0.55, 8, px + 4.8, 0.92, 13.0));
        b.add(M.red, U.box(0.18, 0.16, 0.75, px + 4.8, 0.82, 13.0));
      }
      if (i % 2) {
        b.add(M.steel, cyl(0.08, 0.11, 4.8, 8, px - 5.8, 2.4, 13.2));
        b.add(M.white, U.box(0.45, 0.26, 0.38, px - 5.8, 4.8, 13.2));
        b.add(M.glass, cyl(0.12, 0.12, 0.16, 10, px - 5.8, 4.8, 12.98));
      }
    });

    /* 锥桶、防撞桶、工具箱、缆绳卷 */
    for (var cn = 0; cn < 9; cn++) {
      var cxp = -31 + cn * 3.2, czp = 6.8 + (cn % 2) * 0.8;
      b.add(M.orange, cyl(0.05, 0.34, 0.85, 12, cxp, 0.42, czp));
      b.add(M.white, cyl(0.19, 0.25, 0.16, 12, cxp, 0.55, czp));
      b.add(M.rubber, U.box(0.72, 0.06, 0.72, cxp, 0.03, czp));
    }
    for (var rb = 0; rb < 3; rb++) {
      b.add(M.yellow, cyl(0.42, 0.42, 0.24, 16, -16 - rb * 1.2, 0.13, 4.7, Math.PI / 2));
      b.add(M.darkSteel, cyl(0.28, 0.28, 0.55, 14, -16 - rb * 1.2, 0.13, 4.7));
    }
    b.add(M.darkSteel, U.box(1.8, 1.1, 1.0, 8, 0.55, 5.2));
    b.add(M.yellow, U.box(1.82, 0.1, 1.02, 8, 1.12, 5.2));

    b.flush(scene);

    if (S.land && S.land.material) {
      S.land.material.polygonOffset = true;
      S.land.material.polygonOffsetFactor = 1;
    }
  }

  /* ---------------- 船舶细部 ---------------- */
  function ship(scene) {
    var sh = C.scene.ship, X = sh.x, Z = sh.z, L = sh.length, B = sh.width, dy = sh.deckY;
    var b = bucket();
    var span = B / 2;

    /* 舷侧板缝、锈迹、吃水标 */
    for (var side = -1; side <= 1; side += 2) {
      var zz = Z + side * (span - 0.04);
      for (var y = 0.6; y <= 3.6; y += 0.72) {
        b.add(M.hullDark, U.box(L - 13, 0.045, 0.035, X, y, zz));
      }
      for (var x = -L / 2 + 8; x <= L / 2 - 8; x += 7.2) {
        b.add(M.hullDark, U.box(0.035, 2.8, 0.035, X + x, 1.9, zz));
      }
      for (var r = 0; r < 12; r++) {
        var rx = -L / 2 + 12 + r * 6.1;
        b.add(M.rust, U.box(0.12 + Math.random() * 0.35, 1 + Math.random() * 2.1, 0.02,
          X + rx, 1.1 + Math.random() * 1.2, zz + side * 0.02));
      }
      var nm = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.7),
        new THREE.MeshBasicMaterial({
          map: textTex('SUGANG PORT', 640, 112, null, '#eef4f7', '500 50px sans-serif'),
          transparent: true, side: THREE.DoubleSide, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -4,
        }));
      nm.position.set(X - L / 2 + 24, 3.35, zz + side * 0.14);
      nm.rotation.y = side > 0 ? 0 : Math.PI;
      scene.add(nm);
      var dm = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.9),
        new THREE.MeshBasicMaterial({
          map: textTex('8.5M', 128, 192, '#d8dde2', '#39424b', '500 78px sans-serif'),
          side: THREE.DoubleSide, depthWrite: false,
        }));
      dm.position.set(X - L / 2 + 10, 2.9, zz + side * 0.14);
      dm.rotation.y = side > 0 ? 0 : Math.PI;
      scene.add(dm);
    }

    /* 锚、锚链与锚机 */
    for (var a = -1; a <= 1; a += 2) {
      var az = Z + a * (span - 0.55);
      b.add(M.darkSteel, U.box(1.5, 0.3, 0.55, X - L / 2 + 5.2, -0.15, az));
      b.add(M.darkSteel, cyl(0.18, 0.18, 1.3, 8, X - L / 2 + 5.2, -0.5, az, Math.PI / 2, 0));
      for (var ch = 0; ch < 7; ch++) {
        b.add(M.rust, new THREE.TorusGeometry(0.25, 0.06, 6, 10)
          .rotateY(Math.PI / 2).translate(X - L / 2 + 8 + ch * 1.1, 1.65, az));
      }
      b.add(M.yellow, U.box(1.2, 0.8, 1.1, X - L / 2 + 15, dy + 0.42, az));
      b.add(M.darkSteel, cyl(0.42, 0.42, 1.2, 12, X - L / 2 + 15, dy + 1.15, az, Math.PI / 2));
    }

    /* 甲板机械：绞缆机、通风筒与货舱液压管 */
    for (var wc = -1; wc <= 1; wc += 2) {
      b.add(M.yellowDark, U.box(2.0, 1.1, 1.4, X - L / 2 + 19, dy + 0.58, Z + wc * 6.4));
      b.add(M.darkSteel, cyl(0.3, 0.3, 1.0, 10, X - L / 2 + 19, dy + 1.2, Z + wc * 6.4, Math.PI / 2));
      b.add(M.white, cyl(0.48, 0.58, 2.4, 12, X - 22, dy + 1.2, Z + wc * 7.1));
      b.add(M.darkSteel, U.box(1.5, 0.25, 1.3, X - 22, dy + 0.12, Z + wc * 7.1));
      b.add(M.steel, U.tube({ x: X - 21, y: dy + 0.2, z: Z + wc * 7.1 },
        { x: X + 21, y: dy + 0.2, z: Z + wc * 7.1 }, 0.09, 5));
    }
    for (var mv = -1; mv <= 1; mv += 2) {
      b.add(M.yellow, U.tube({ x: X + mv * 26, y: dy, z: Z + 6.8 },
        { x: X + mv * 26, y: dy + 6.5, z: Z + 6.8 }, 0.12, 6));
      b.add(M.emissiveWhite, U.box(0.22, 0.22, 0.22, X + mv * 26, dy + 6.5, Z + 6.8));
    }
    /* 紧凑型船吊，吊臂收起并沿船体方向布置 */
    [-34, 34].forEach(function (cx, idx) {
      var px = X + cx, pz = Z + (idx ? -1 : 1) * 5.6;
      b.add(M.white, cyl(0.82, 0.95, 1.1, 14, px, dy + 0.55, pz));
      b.add(M.yellow, cyl(0.48, 0.62, 2.8, 12, px, dy + 2.1, pz));
      b.add(M.yellow, U.box(1.9, 1.25, 1.6, px, dy + 3.65, pz));
      b.add(M.glass, U.box(1.6, 0.52, 1.3, px, dy + 3.85, pz));
      var dir = idx ? -1 : 1;
      b.add(M.yellow, U.tube({ x: px, y: dy + 4.0, z: pz },
        { x: px + dir * 7.2, y: dy + 5.6, z: pz - dir * 0.9 }, 0.20, 7));
      b.add(M.darkSteel, U.tube({ x: px + dir * 7.2, y: dy + 5.6, z: pz - dir * 0.9 },
        { x: px + dir * 7.2, y: dy + 1.7, z: pz - dir * 0.9 }, 0.025, 5));
      b.add(M.orange, U.box(0.5, 0.35, 0.5, px + dir * 7.2, dy + 1.6, pz - dir * 0.9));
    });

    /* 舱盖板堆放、甲板管线、栏杆 */
    for (var hc = 0; hc < 3; hc++) {
      b.add(M.hatch, U.box(8.8, 0.42, 5.6, X + L / 2 - 10, dy + 0.25 + hc * 0.44, Z - 2.2));
      b.add(M.darkSteel, U.box(7.2, 0.08, 4.2, X + L / 2 - 10, dy + 0.48 + hc * 0.44, Z - 2.2));
    }
    for (var dp = -1; dp <= 1; dp += 2) {
      b.add(M.steel, U.tube({ x: X - 29, y: dy + 0.3, z: Z + dp * 6.6 },
        { x: X + 29, y: dy + 0.3, z: Z + dp * 6.6 }, 0.18, 7));
      for (var db = -24; db <= 24; db += 12) {
        b.add(M.darkSteel, cyl(0.28, 0.34, 0.62, 10, X + db, dy + 0.35, Z + dp * 8.2));
        b.add(M.steel, U.box(0.8, 0.12, 0.25, X + db, dy + 0.65, Z + dp * 8.2));
      }
    }
    /* 舱口导轨、限位与甲板照明 */
    for (var hg = -1; hg <= 1; hg += 2) {
      b.add(M.darkSteel, U.box(58, 0.14, 0.36, X, dy + 1.66, Z + hg * sh.holdHalfW));
      for (var hl2 = -28; hl2 <= 28; hl2 += 4) {
        b.add(M.steel, U.box(0.28, 0.16, 0.62, X + hl2, dy + 1.63, Z + hg * sh.holdHalfW));
      }
    }
    for (var dl = -1; dl <= 1; dl += 2) {
      for (var lx2 = -24; lx2 <= 24; lx2 += 16) {
        b.add(M.steel, U.tube({ x: X + lx2, y: dy, z: Z + dl * 7.6 },
          { x: X + lx2, y: dy + 2.0, z: Z + dl * 7.6 }, 0.055, 5));
        b.add(M.emissiveWhite, U.box(0.4, 0.22, 0.32, X + lx2, dy + 2.1, Z + dl * 7.6));
      }
    }

    /* 船楼：窗框、翼桥、救生艇、雷达桅 */
    var sx = X - L / 2 + 8;
    for (var wf = 0; wf < 3; wf++) {
      for (var wz = -4; wz <= 4; wz += 1.25) {
        b.add(M.darkSteel, U.box(0.12, 0.82, 0.8, sx + 6.55, dy + 4.05 + wf * 1.7, Z + wz));
      }
    }
    b.add(M.white, U.box(3.2, 0.35, B + 2.0, sx, dy + 8.35, Z));
    b.add(M.glass, U.box(2.9, 1.25, B + 1.8, sx, dy + 9.05, Z));
    for (var lf = -1; lf <= 1; lf += 2) {
      b.add(M.orange, U.box(3.0, 1.05, 1.15, sx - 1.1, dy + 2.25, Z + lf * (span + 1.0)));
      b.add(M.white, U.box(3.4, 0.15, 1.5, sx - 1.1, dy + 3.2, Z + lf * (span + 1.0)));
      b.add(M.steel, U.tube({ x: sx + 1.0, y: dy + 6.8, z: Z + lf * (span + 1.2) },
        { x: sx + 2.0, y: dy + 4.0, z: Z + lf * (span + 1.2) }, 0.08, 6));
    }
    b.add(M.white, cyl(0.22, 0.32, 8.0, 10, sx + 1.7, dy + 13.0, Z));
    b.add(M.steel, U.box(1.8, 0.1, 0.1, sx + 1.7, dy + 15.2, Z));
    b.add(M.emissiveWhite, U.box(0.18, 0.18, 0.18, sx + 1.7, dy + 15.5, Z));
    var radar = new THREE.Mesh(U.box(2.5, 0.12, 0.3, 0, 0, 0), M.white);
    radar.position.set(sx + 1.7, dy + 16.5, Z);
    radar.castShadow = true;
    scene.add(radar);
    HD.radar = radar;

    /* 甲板船员护栏 */
    for (var rf = -1; rf <= 1; rf += 2) {
      for (var rx2 = -L / 2 + 4; rx2 <= L / 2 - 4; rx2 += 2.4) {
        b.add(M.steel, U.tube({ x: X + rx2, y: dy, z: Z + rf * (span - 0.35) },
          { x: X + rx2, y: dy + 1.05, z: Z + rf * (span - 0.35) }, 0.035, 5));
      }
      b.add(M.steel, U.tube({ x: X - L / 2 + 4, y: dy + 1.05, z: Z + rf * (span - 0.35) },
        { x: X + L / 2 - 4, y: dy + 1.05, z: Z + rf * (span - 0.35) }, 0.03, 5));
    }

    /* 系泊缆：船首尾 → 码头系缆桩，带自然垂度 */
    function rope(p0, p1, sag) {
      var pts = [];
      for (var i = 0; i <= 8; i++) {
        var t = i / 8;
        pts.push(new V3(
          p0.x + (p1.x - p0.x) * t,
          p0.y + (p1.y - p0.y) * t - Math.sin(t * Math.PI) * sag,
          p0.z + (p1.z - p0.z) * t
        ));
      }
      var curve = new THREE.CatmullRomCurve3(pts);
      b.add(M.rubber, new THREE.TubeGeometry(curve, 18, 0.075, 6, false));
    }
    rope({ x: X - 43, y: 3.2, z: Z + 4 }, { x: -63, y: 0.7, z: 14.1 }, 1.8);
    rope({ x: X - 40, y: 3.3, z: Z - 6 }, { x: -38, y: 0.7, z: 14.1 }, 1.2);
    rope({ x: X + 41, y: 3.2, z: Z + 5 }, { x: 64, y: 0.7, z: 14.1 }, 1.8);
    rope({ x: X + 37, y: 3.3, z: Z - 6 }, { x: 38, y: 0.7, z: 14.1 }, 1.2);

    b.flush(scene);
  }

  /* ---------------- 自卸卡车细部 ---------------- */
  function truck(scene) {
    var t = C.scene.truck, X = t.x, Z = t.z;
    var b = bucket();
    var bedX = X - 1.35, bl = t.bedL, bw = t.bedW, by = t.bedY;

    /* 前保险杠、格栅、车灯、牌照 */
    b.add(M.darkSteel, U.box(0.30, 0.52, 2.55, X + 5.74, 1.12, Z));
    for (var gr = -1; gr <= 1; gr++) {
      b.add(M.steel, U.box(0.06, 0.62, 0.12, X + 5.70, 1.9, Z + gr * 0.35));
    }
    for (var hl = -1; hl <= 1; hl += 2) {
      b.add(M.emissiveWhite, U.box(0.09, 0.30, 0.55, X + 5.71, 1.65, Z + hl * 0.82));
      b.add(M.darkSteel, U.box(0.12, 0.42, 0.68, X + 5.68, 1.65, Z + hl * 0.82));
      b.add(M.orange, U.box(0.10, 0.18, 0.28, X + 5.7, 1.2, Z + hl * 0.96));
    }
    b.add(M.white, U.box(0.04, 0.26, 0.72, X + 5.77, 1.05, Z));
    b.add(M.darkSteel, U.box(0.05, 0.06, 0.72, X + 5.79, 1.16, Z));

    /* 后视镜、扶手、踏板 */
    for (var mr = -1; mr <= 1; mr += 2) {
      b.add(M.steel, U.tube({ x: X + 4.25, y: 3.05, z: Z + mr * 1.48 },
        { x: X + 4.55, y: 3.55, z: Z + mr * 1.76 }, 0.035, 5));
      b.add(M.darkSteel, U.box(0.08, 0.58, 0.22, X + 4.56, 3.75, Z + mr * 1.78));
      b.add(M.steel, U.tube({ x: X + 3.12, y: 1.35, z: Z + mr * 1.3 },
        { x: X + 3.12, y: 3.45, z: Z + mr * 1.3 }, 0.035, 5));
      for (var st = 0; st < 3; st++) {
        b.add(M.darkSteel, U.box(0.82, 0.06, 0.27, X + 3.0, 1.35 + st * 0.35, Z + mr * 1.28));
      }
    }

    /* 燃油箱、电瓶箱、储气筒 */
    for (var tk = -1; tk <= 1; tk += 2) {
      b.add(M.steel, cyl(0.46, 0.46, 1.55, 14, X + 1.0, 0.78, Z + tk * 1.32, Math.PI / 2));
      b.add(M.darkSteel, U.box(1.45, 0.48, 0.42, X + 1.0, 1.32, Z + tk * 1.35));
    }
    b.add(M.darkSteel, U.box(0.72, 0.55, 1.1, X + 2.1, 1.25, Z + 1.42));

    /* 车厢外侧加强筋、顶部护栏、反光带 */
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      for (var rr = -4; rr <= 4; rr++) {
        b.add(M.blue, U.box(0.13, 1.5, 0.12, bedX + rr * (bl / 10), by + 0.72, Z + s2 * (bw / 2 + 0.05)));
      }
      b.add(M.yellow, U.box(bl, 0.055, 0.055, bedX, by + 1.48, Z + s2 * (bw / 2 + 0.1)));
    }
    for (var rt = -3; rt <= 3; rt++) {
      b.add(M.yellow, U.box(0.28, 0.08, bw + 0.15, bedX + rt * bl / 7, by + 1.53, Z));
    }

    /* 液压举升缸、油管、后尾灯、挡泥板、牌照 */
    b.add(M.steel, U.tube({ x: X + 2.7, y: 0.85, z: Z - 0.78 },
      { x: X + 2.15, y: 2.0, z: Z - 0.78 }, 0.11, 9));
    b.add(M.steel, U.tube({ x: X + 2.7, y: 0.85, z: Z + 0.78 },
      { x: X + 2.15, y: 2.0, z: Z + 0.78 }, 0.11, 9));
    b.add(M.rubber, U.tube({ x: X + 1.2, y: 0.9, z: Z + 0.15 },
      { x: X + 2.5, y: 2.1, z: Z + 0.15 }, 0.03, 5));
    for (var tl = -1; tl <= 1; tl += 2) {
      b.add(M.emissiveRed, U.box(0.07, 0.22, 0.42, bedX + bl / 2 + 0.02, by + 0.52, Z + tl * 0.9));
      b.add(M.darkSteel, U.box(0.32, 0.9, 0.06, X - 4.45, 0.55, Z + tl * 1.15));
    }
    b.add(M.white, U.box(0.04, 0.25, 0.68, bedX - bl / 2 - 0.04, by + 0.2, Z));

    /* 黄色警示灯与天线 */
    b.add(M.orange, cyl(0.15, 0.17, 0.22, 10, X + 4.9, 4.04, Z));
    b.add(M.emissiveWhite, cyl(0.08, 0.08, 0.16, 8, X + 4.9, 4.18, Z));
    b.add(M.steel, U.tube({ x: X + 3.45, y: 3.9, z: Z - 1.2 },
      { x: X + 3.35, y: 5.1, z: Z - 1.2 }, 0.022, 5));

    b.flush(scene);
  }

  /* ---------------- 仓库、筒仓与堆场机械 ---------------- */
  function buildings(scene) {
    var b = bucket();

    /* 仓库外墙压型钢板、山墙、雨棚、装卸平台、屋顶设备与招牌 */
    var wx = -40, wz = -58;
    for (var sx = -18; sx <= 18; sx += 1.2) {
      b.add(M.steel, U.box(0.035, 8.0, 0.05, wx + sx, 4.2, wz + 8.02));
    }
    b.add(M.blue, U.box(46.2, 0.62, 0.32, wx, 8.45, wz + 8.02));
    b.add(M.darkSteel, U.box(48.5, 0.18, 2.4, wx, 9.0, wz + 6.8));
    for (var dx = 0; dx < 4; dx++) {
      b.add(M.darkSteel, U.box(5.0, 5.1, 0.25, -59 + dx * 12, 2.65, wz + 8.05));
      for (var sl = 0; sl < 8; sl++) {
        b.add(M.steel, U.box(4.9, 0.055, 0.06, -59 + dx * 12, 0.65 + sl * 0.58, wz + 8.2));
      }
      b.add(M.yellow, U.box(5.5, 0.16, 0.26, -59 + dx * 12, 5.35, wz + 8.12));
    }
    b.add(M.concrete, U.box(44, 0.9, 2.4, wx, 0.45, wz + 9.3));
    for (var db = -2; db <= 1; db++) {
      b.add(M.rubber, U.box(0.5, 0.65, 0.35, -59 + db * 12 + 2.5, 0.5, wz + 10.5));
      b.add(M.darkSteel, U.box(5.4, 0.22, 0.65, -59 + db * 12, 0.95, wz + 9.8));
    }
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.6),
      new THREE.MeshBasicMaterial({ map: textTex('散货仓库  BULK CARGO', 1024, 128, '#174b6f', '#f7fbfd', '500 66px sans-serif'), transparent: true }));
    sign.position.set(wx, 7.1, wz + 8.18); scene.add(sign);
    for (var hv = 0; hv < 5; hv++) {
      b.add(M.steel, U.box(2.2, 0.7, 1.5, wx - 17 + hv * 8.2, 9.4, wz + 1.0));
      b.add(M.darkSteel, cyl(0.4, 0.4, 0.42, 8, wx - 17 + hv * 8.2, 9.9, wz + 1));
    }
    /* 屋顶光伏与采光带、檐沟、落水管 */
    for (var pvx = -16; pvx <= 16; pvx += 4.2) {
      b.add(M.darkSteel, U.box(3.4, 0.08, 2.2, wx + pvx, 9.68, wz - 2.4));
      b.add(M.blue, U.box(3.25, 0.035, 2.05, wx + pvx, 9.73, wz - 2.4));
    }
    for (var sk = -1; sk <= 1; sk++) {
      b.add(M.glass, U.box(10.5, 0.08, 1.3, wx + sk * 13, 9.02, wz + 3.6));
    }
    b.add(M.steel, U.box(47.2, 0.12, 0.22, wx, 8.82, wz + 8.6));
    for (var dsp = -2; dsp <= 2; dsp++) {
      b.add(M.steel, cyl(0.09, 0.09, 8.2, 6, wx + dsp * 20, 4.1, wz + 8.65));
    }
    for (var wl = 0; wl < 4; wl++) {
      b.add(M.emissiveWhite, U.box(0.8, 0.16, 0.3, wx - 18 + wl * 12, 7.9, wz + 8.2));
    }

    /* 办公小楼窗框、入口雨棚、空调与楼梯 */
    var ox = 16, oz = -74;
    for (var fy = 0; fy < 2; fy++) {
      for (var fwx = -5; fwx <= 5; fwx += 2.5) {
        b.add(M.steel, U.box(0.05, 1.35, 0.06, ox + fwx, 2.4 + fy * 2.5, oz + 4.58));
      }
      b.add(M.steel, U.box(13.1, 0.06, 0.08, ox, 3.1 + fy * 2.5, oz + 4.58));
    }
    b.add(M.blue, U.box(3.4, 0.22, 2.1, ox, 3.25, oz + 5.2));
    b.add(M.glass, U.box(2.7, 1.65, 0.12, ox, 2.2, oz + 4.62));
    for (var ac = -1; ac <= 1; ac++) {
      b.add(M.white, U.box(1.5, 0.8, 1.1, ox + ac * 3.7, 7.1, oz - 2.2));
    }
    b.add(M.darkSteel, U.box(2.2, 7.0, 1.1, ox + 7.1, 3.5, oz - 1.0));
    for (var fs = 0; fs < 12; fs++) {
      b.add(M.steel, U.box(1.8, 0.08, 0.42, ox + 7.1, 0.45 + fs * 0.56, oz - 0.25));
    }

    /* 筒仓环箍、爬梯、输料管与收尘器 */
    for (var si = 0; si < 3; si++) {
      var sx2 = 44 + si * 13;
      for (var ring = 0; ring < 6; ring++) {
        b.add(M.steel, new THREE.TorusGeometry(5.05, 0.12, 6, 28)
          .rotateX(Math.PI / 2).translate(sx2, 2.0 + ring * 2.3, -70));
      }
      for (var sy = 0; sy < 16; sy += 0.8) {
        b.add(M.steel, U.box(0.5, 0.06, 0.08, sx2 - 5.25, 0.4 + sy, -70));
        b.add(M.steel, U.tube({ x: sx2 - 5.35, y: 0.4 + sy, z: -70 },
          { x: sx2 - 4.95, y: 0.4 + sy, z: -70 }, 0.035, 5));
      }
      b.add(M.darkSteel, U.tube({ x: sx2 - 5.35, y: 0, z: -70 },
        { x: sx2 - 5.35, y: 13.2, z: -70 }, 0.045, 6));
      b.add(M.steel, U.tube({ x: sx2, y: 14.7, z: -70 },
        { x: sx2, y: 11.0, z: -78 }, 0.42, 10));
      b.add(M.white, cyl(1.05, 1.15, 2.4, 12, sx2 + 4.0, 1.2, -78));
      b.add(M.darkSteel, cyl(1.18, 1.18, 0.5, 12, sx2 + 4.0, 2.45, -78));
    }

    /* 散货堆场机械：履带式堆取料机 */
    var rz = -49;
    b.add(M.darkSteel, U.box(3.4, 1.2, 5.2, -126, 0.65, rz));
    for (var tr = -1; tr <= 1; tr += 2) {
      b.add(M.rubber, U.box(1.4, 1.5, 7.2, -126 + tr * 1.85, 0.8, rz));
      for (var tw = -3; tw <= 3; tw++) {
        b.add(M.steel, cyl(0.36, 0.36, 0.42, 10, -126 + tr * 1.85, 0.42, rz + tw * 0.95, 0, Math.PI / 2));
      }
    }
    b.add(M.blue, U.box(3.6, 2.4, 3.4, -126, 2.4, rz));
    b.add(M.glass, U.box(2.4, 0.9, 2.0, -126, 2.85, rz + 1.75));
    b.add(M.yellow, U.box(0.5, 15, 0.5, -126, 8.0, rz));
    for (var lb = 0; lb < 8; lb++) {
      b.add(M.yellow, U.tube({ x: -126, y: 14.2, z: rz },
        { x: -113 + lb * 1.8, y: 15.4 - lb * 0.28, z: rz }, 0.12, 5));
    }
    b.add(M.darkSteel, U.box(23, 0.35, 1.1, -116.5, 14.1, rz));
    b.add(M.orange, U.box(2.2, 0.8, 2.4, -104, 13.6, rz));
    for (var cd = 0; cd < 4; cd++) {
      b.add(M.steel, U.tube({ x: -136, y: 0.2, z: rz + 3 },
        { x: -136, y: 5.0, z: rz + 3 }, 0.07, 5));
    }

    b.flush(scene);
  }

  /* ---------------- 作业机械与人员车辆 ---------------- */
  function misc(scene) {
    var b = bucket();

    function wheels(cx, cz, ry, list, mat) {
      list.forEach(function (w) {
        var x = cx + w[0] * Math.cos(ry) - w[1] * Math.sin(ry);
        var z = cz + w[0] * Math.sin(ry) + w[1] * Math.cos(ry);
        b.add(mat, cyl(w[2] || 0.62, w[2] || 0.62, 0.45, 14, x, w[2] || 0.62, z, Math.PI / 2, 0));
        b.add(M.steel, cyl((w[2] || 0.62) * 0.45, (w[2] || 0.62) * 0.45, 0.48, 10, x, w[2] || 0.62, z, Math.PI / 2, 0));
      });
    }

    /* 轮式装载机（散货堆场） */
    (function loader() {
      var x = -20, z = -35, ry = -0.42;
      b.add(M.yellow, U.box(3.4, 1.15, 2.15, x, 1.1, z));
      b.add(M.yellow, U.box(1.65, 2.0, 2.0, x - 0.6, 2.0, z));
      b.add(M.glass, U.box(1.5, 0.95, 1.72, x - 0.58, 2.55, z));
      b.add(M.darkSteel, U.box(1.9, 0.25, 2.2, x - 0.55, 3.15, z));
      b.add(M.yellow, U.box(0.55, 0.48, 0.55, x + 0.5, 1.55, z + 1.0));
      b.add(M.yellow, U.box(0.55, 0.48, 0.55, x + 0.5, 1.55, z - 1.0));
      b.add(M.steel, U.tube({ x: x - 1.4, y: 0.95, z }, { x: x - 3.0, y: 1.1, z }, 0.18, 7));
      b.add(M.darkSteel, U.box(0.9, 1.45, 2.5, x - 3.15, 1.15, z));
      b.add(M.steel, U.box(0.16, 0.1, 2.5, x - 3.62, 0.48, z));
      for (var i = 0; i < 5; i++) {
        b.add(M.darkSteel, U.box(0.55, 0.1, 2.4, x - 3.2, 0.5 + i * 0.28, z));
      }
      wheels(x, z, 0, [[-1.1, 1.02, 0.72], [1.2, 1.02, 0.72], [-1.1, -1.02, 0.72], [1.2, -1.02, 0.72]], M.rubber);
      b.add(M.emissiveWhite, U.box(0.16, 0.22, 0.5, x + 1.7, 2.45, z));
    })();

    /* 正面吊（集装箱堆场） */
    (function reachStacker() {
      var x = 27, z = -28, ry = 0.18;
      b.add(M.blue, U.box(5.2, 1.5, 3.0, x, 1.5, z));
      b.add(M.blue, U.box(2.6, 1.8, 2.8, x - 2.0, 2.6, z));
      b.add(M.glass, U.box(2.4, 0.9, 2.5, x - 2.0, 3.1, z));
      b.add(M.yellow, U.box(4.2, 0.55, 0.68, x + 2.8, 3.3, z));
      b.add(M.yellow, U.box(4.2, 0.55, 0.68, x + 4.0, 4.35, z));
      b.add(M.darkSteel, U.box(0.8, 1.15, 4.2, x + 6.0, 3.1, z));
      b.add(M.orange, U.box(0.35, 0.55, 4.2, x + 6.4, 3.1, z));
      wheels(x, z, 0, [[-2.0, 1.2, 0.82], [1.4, 1.2, 0.82], [-2.0, -1.2, 0.82], [1.4, -1.2, 0.82]], M.rubber);
      b.add(M.emissiveWhite, U.box(0.18, 0.18, 0.18, x - 1.3, 3.85, z));
      b.add(M.orange, cyl(0.2, 0.2, 0.5, 8, x - 1.3, 4.1, z));
    })();

    /* 员工车辆：轿车与皮卡 */
    function car(x, z, col, ry) {
      var arr = [];
      var body = U.paint(col, { metalness: 0.46, roughness: 0.34 });
      b.add(body, U.box(4.1, 0.68, 1.8, x, 0.65, z));
      b.add(body, U.box(2.3, 0.64, 1.62, x + 0.15, 1.2, z));
      b.add(M.glass, U.box(2.0, 0.48, 1.52, x + 0.16, 1.32, z));
      b.add(M.darkSteel, U.box(0.95, 0.28, 1.74, x + 2.02, 0.48, z));
      b.add(M.darkSteel, U.box(0.95, 0.28, 1.74, x - 2.02, 0.48, z));
      b.add(M.emissiveWhite, U.box(0.08, 0.18, 0.34, x + 2.08, 0.66, z + 0.58));
      b.add(M.emissiveWhite, U.box(0.08, 0.18, 0.34, x + 2.08, 0.66, z - 0.58));
      b.add(M.emissiveRed, U.box(0.07, 0.15, 0.3, x - 2.08, 0.62, z + 0.58));
      b.add(M.emissiveRed, U.box(0.07, 0.15, 0.3, x - 2.08, 0.62, z - 0.58));
      [[1.25, 0.78], [-1.25, 0.78], [1.25, -0.78], [-1.25, -0.78]].forEach(function (w) {
        b.add(M.rubber, cyl(0.31, 0.31, 0.24, 12, x + w[0], 0.32, z + w[1], Math.PI / 2));
      });
    }
    car(11, -63, 0xd9dde1, 0);
    car(15.5, -63, 0x25313d, 0);
    car(20, -63, 0x8c2d2a, 0);
    car(24.5, -63, 0x375a7e, 0);

    /* 第二辆待装自卸车 */
    (function dumpTruck() {
      var x = -11, z = -25;
      b.add(M.blue, U.box(7.8, 1.05, 2.45, x, 1.15, z));
      b.add(M.blue, U.box(2.3, 2.15, 2.3, x + 3.4, 2.15, z));
      b.add(M.glass, U.box(0.08, 0.85, 2.0, x + 4.53, 2.55, z));
      b.add(M.darkSteel, U.box(0.28, 0.5, 2.45, x + 4.7, 1.1, z));
      for (var d = 0; d < 4; d++) {
        b.add(M.blue, U.box(0.12, 1.25, 0.1, x - 2.8 + d * 1.5, 1.95, z + 1.28));
      }
      [[-2.8, 1.1], [-1.4, 1.1], [2.3, 1.1], [3.6, 1.1], [-2.8, -1.1], [-1.4, -1.1], [2.3, -1.1], [3.6, -1.1]].forEach(function (w) {
        b.add(M.rubber, cyl(0.62, 0.62, 0.44, 14, x + w[0], 0.62, z + w[1], Math.PI / 2));
      });
      b.add(M.emissiveWhite, U.box(0.1, 0.25, 0.5, x + 4.58, 1.7, z + 0.72));
      b.add(M.emissiveWhite, U.box(0.1, 0.25, 0.5, x + 4.58, 1.7, z - 0.72));
    })();

    /* 港内拖轮 */
    (function tugboat() {
      var x = 72, z = 62, y = -1.25;
      b.add(M.hullDark, U.box(15, 2.0, 5.4, x, y + 0.6, z));
      b.add(M.red, U.box(14.6, 0.55, 5.6, x, y - 0.25, z));
      b.add(M.white, U.box(5.4, 2.3, 4.4, x - 1.0, y + 2.5, z));
      b.add(M.glass, U.box(4.9, 0.8, 4.0, x - 1.0, y + 3.0, z));
      b.add(M.yellow, cyl(0.34, 0.46, 2.8, 10, x - 1.4, y + 4.7, z));
      b.add(M.darkSteel, U.box(0.4, 0.18, 3.0, x - 1.4, y + 5.8, z));
      b.add(M.emissiveWhite, U.box(0.18, 0.18, 0.18, x - 1.4, y + 6.0, z));
      for (var ty = -1; ty <= 1; ty += 2) {
        for (var tx = -5; tx <= 5; tx += 2.5) {
          b.add(M.rubber, cyl(0.45, 0.45, 0.28, 12, x + tx, y + 0.1, z + ty * 2.85, Math.PI / 2));
        }
      }
      b.add(M.steel, U.tube({ x: x - 7, y: y + 0.5, z }, { x: x - 12, y: y - 0.4, z }, 0.08, 5));
    })();

    /* 地面积水、油污、轮胎印与限速标识 */
    [[-24, 8, 4.8, 2.2], [12, -7, 3.4, 1.6], [54, 5, 5.8, 2.4], [-62, -4, 4.2, 1.7], [34, -33, 6.5, 2.0]].forEach(function (p) {
      var g = new THREE.CircleGeometry(1, 30).scale(p[2], p[3], 1).rotateX(-Math.PI / 2).translate(p[0], 0.035, p[1]);
      b.add(M.puddle, g);
    });
    [[15, 2], [19, 1.4], [23, 0.8]].forEach(function (p) {
      b.add(new THREE.MeshBasicMaterial({ color: 0x1c2228, transparent: true, opacity: 0.18, depthWrite: false }),
        new THREE.PlaneGeometry(12, 0.34).rotateX(-Math.PI / 2).translate(p[0], 0.041, p[1]));
    });
    function sign(x, z, text) {
      b.add(M.steel, U.tube({ x: x, y: 0, z: z }, { x: x, y: 3.2, z: z }, 0.07, 6));
      var s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.95),
        new THREE.MeshBasicMaterial({ map: textTex(text, 512, 220, '#1d4f75', '#ffffff', '500 110px sans-serif'), side: THREE.DoubleSide }));
      s.position.set(x, 2.9, z + 0.06);
      scene.add(s);
    }
    sign(-7, 12.2, '限速 5');
    sign(35, 12.2, '注意行人');
    b.flush(scene);
  }

  /* ---------------- 远景：岸桥、防波堤、灯塔 ---------------- */
  function background(scene) {
    var b = bucket();
    for (var i = 0; i < 3; i++) {
      var bx = -120 + i * 78, bz = -146;
      var h = 25;
      /* 四条支腿、下横梁与门框 */
      for (var lx = -1; lx <= 1; lx += 2) {
        for (var lz = -1; lz <= 1; lz += 2) {
          b.add(M.blue, U.box(1.5, h, 1.5, bx + lx * 7.5, h / 2, bz + lz * 6.5));
          b.add(M.darkSteel, U.box(2.2, 0.5, 2.2, bx + lx * 7.5, 0.3, bz + lz * 6.5));
        }
        b.add(M.blue, U.box(1.4, 1.2, 15, bx + lx * 7.5, h - 1.5, bz));
      }
      /* 顶部主梁、前伸臂与后拉杆 */
      b.add(M.blue, U.box(2.6, 2.0, 34, bx, h + 0.5, bz + 2));
      b.add(M.darkSteel, U.box(1.0, 0.12, 34, bx, h + 1.55, bz + 2));
      for (var seg = 0; seg < 8; seg++) {
        var z0 = bz - 13 + seg * 4.2;
        b.add(M.blue, U.box(0.35, 2.4, 0.35, bx - 1.4, h - 0.8, z0));
        b.add(M.blue, U.tube({ x: bx - 1.4, y: h - 2.0, z: z0 }, { x: bx + 1.4, y: h + 1.4, z: z0 + 4.2 }, 0.12, 5));
        b.add(M.blue, U.tube({ x: bx + 1.4, y: h - 2.0, z: z0 }, { x: bx - 1.4, y: h + 1.4, z: z0 + 4.2 }, 0.12, 5));
      }
      /* A 字架、拉索与机器房 */
      b.add(M.blue, U.tube({ x: bx - 5, y: h + 1, z: bz - 10 }, { x: bx, y: h + 10, z: bz - 2 }, 0.28, 7));
      b.add(M.blue, U.tube({ x: bx + 5, y: h + 1, z: bz - 10 }, { x: bx, y: h + 10, z: bz - 2 }, 0.28, 7));
      b.add(M.blue, U.tube({ x: bx, y: h + 10, z: bz - 2 }, { x: bx, y: h + 1.7, z: bz + 18 }, 0.12, 5));
      b.add(M.white, U.box(5.4, 4.0, 4.2, bx, h + 3.2, bz - 9));
      b.add(M.glass, U.box(4.6, 1.1, 3.8, bx, h + 4.1, bz - 6.85));
      /* 小车、司机室与吊具 */
      b.add(M.yellow, U.box(2.2, 1.4, 2.8, bx, h + 1.8, bz + 13));
      b.add(M.white, U.box(1.8, 1.9, 1.8, bx + 2.1, h + 0.8, bz + 13));
      b.add(M.glass, U.box(1.5, 0.7, 1.6, bx + 2.1, h + 1.15, bz + 13));
      b.add(M.darkSteel, U.tube({ x: bx, y: h + 1.2, z: bz + 13 },
        { x: bx, y: 8.0, z: bz + 13 }, 0.07, 5));
      b.add(M.yellow, U.box(6.2, 0.7, 2.0, bx, 8.0, bz + 13));
      for (var cl = -1; cl <= 1; cl += 2) {
        b.add(M.darkSteel, U.tube({ x: bx + cl * 2.6, y: 7.2, z: bz + 13 },
          { x: bx + cl * 2.6, y: 5.3, z: bz + 13 }, 0.035, 4));
      }
    }
    /* 防波堤石块 */
    var rockGeo = new THREE.DodecahedronGeometry(1.8, 0);
    for (var rx = -210; rx <= 210; rx += 6.3) {
      var yy = -0.8 + Math.random() * 1.1;
      var g = rockGeo.clone();
      g.scale(0.7 + Math.random() * 1.2, 0.6 + Math.random() * 0.8, 0.7 + Math.random() * 1.1);
      g.rotateY(Math.random() * 6.3);
      g.translate(rx, yy, 202 + Math.random() * 6);
      b.add(M.concrete, g);
    }
    b.add(M.concrete, U.box(430, 2.2, 8, 0, 0.3, 202));
    /* 灯塔 */
    b.add(M.white, cyl(3.2, 3.8, 11, 18, 145, 6.0, 200));
    b.add(M.red, cyl(3.4, 3.4, 2.0, 18, 145, 12.5, 200));
    b.add(M.darkSteel, U.box(3.8, 0.4, 3.8, 145, 13.6, 200));
    b.add(M.emissiveWhite, cyl(1.5, 1.5, 1.6, 14, 145, 14.4, 200));
    for (var lw = 0; lw < 5; lw++) {
      b.add(M.steel, U.box(0.22, 0.14, 0.22, 145 - 3 + lw * 1.5, 12.0, 200));
    }
    /* 防波堤灯桩与旗杆 */
    b.add(M.red, cyl(0.22, 0.3, 8, 8, -180, 4, 205));
    b.add(M.emissiveRed, cyl(0.28, 0.28, 0.35, 8, -180, 8.2, 205));
    b.flush(scene);
  }

  S._environmentHD = function (scene) {
    materials();
    sky(scene);
    water(scene);
    quay(scene);
    ship(scene);
    truck(scene);
    buildings(scene);
    misc(scene);
    background(scene);
    var old = scene.getObjectByName('lowBollards');
    if (old) old.visible = false;
    S.scene.background = new THREE.Color(0xc7dce9);
    S.scene.fog = new THREE.Fog(0xd3e2eb, 250, 620);
  };

  S._hdTick = function (t) {
    if (S.water && S.water.material.map) {
      S.water.material.map.offset.x = t * 0.0035;
      S.water.material.map.offset.y = t * 0.0012;
      if (S.water.material.bumpMap) {
        S.water.material.bumpMap.offset.x = -t * 0.002;
        S.water.material.bumpMap.offset.y = t * 0.0015;
      }
    }
    if (HD.radar) HD.radar.rotation.y = t * 0.65;
  };

  w.ENVHD = HD;
})(window);
