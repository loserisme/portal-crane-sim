/* 港区精细模型与陆侧扩建。米制尺寸；+z 海侧。按设施合并网格，以保留视锥裁剪。 */
(function (w) {
  'use strict';
  var P = {}, M, api, root;
  var V = function (p) { return { x: p[0], y: p[1], z: p[2] }; };

  function part(name, x, z, angle) {
    var group = new THREE.Group();
    group.name = name; group.position.set(x || 0, 0, z || 0); group.rotation.y = angle || 0;
    root.add(group);
    var batch = api.bucket();
    return {
      group: group,
      box: function (m, a, b, c, x, y, z) { batch.add(m, U.box(a, b, c, x, y, z)); },
      rod: function (m, a, b, r) { batch.add(m, U.tube(V(a), V(b), r || 0.035, 8)); },
      beam: function (m, a, b, width, height) { batch.add(m, U.member(V(a), V(b), width, height)); },
      cyl: function (m, r, h, x, y, z, rx) { batch.add(m, api.cyl(r, r, h, 24, x, y, z, rx)); },
      geo: function (m, g) { batch.add(m, g); },
      end: function () { batch.flush(group); return group; }
    };
  }

  function railing(p, a, b, height, material) {
    height = height || 1.1; material = material || M.yellow;
    var len = Math.hypot(b[0] - a[0], b[2] - a[2]), steps = Math.max(1, Math.ceil(len / 1.8));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      p.rod(material, [x, y, z], [x, y + height, z], 0.035);
    }
    [0.52, 1].forEach(function (h) {
      p.rod(material, [a[0], a[1] + height * h, a[2]], [b[0], b[1] + height * h, b[2]], 0.033);
    });
  }

  function ladder(p, x, z, y0, y1) {
    [-0.32, 0.32].forEach(function (dx) { p.rod(M.steel, [x + dx, y0, z], [x + dx, y1 + 0.8, z], 0.035); });
    for (var y = y0 + 0.25; y < y1; y += 0.32) p.rod(M.steel, [x - 0.32, y, z], [x + 0.32, y, z], 0.026);
    for (var cy = y0 + 2; cy < y1; cy += 1.4) {
      p.geo(M.yellow, new THREE.TorusGeometry(0.48, 0.026, 5, 16, Math.PI * 1.5).rotateX(Math.PI / 2).translate(x, cy, z + 0.25));
    }
  }

  function stair(p, x, z, rise, run, width) {
    var n = Math.ceil(rise / 0.22);
    for (var i = 0; i < n; i++) p.box(M.steel, width, 0.08, run / n + 0.04, x, (i + 1) * rise / n, z - i * run / n);
    [-width / 2, width / 2].forEach(function (dx) {
      p.beam(M.blue, [x + dx, 0.1, z + 0.2], [x + dx, rise, z - run], 0.1, 0.2);
      railing(p, [x + dx, 0.1, z], [x + dx, rise, z - run]);
    });
  }

  function sign(p, text, width, height, x, y, z, color) {
    var mat = new THREE.MeshStandardMaterial({ map: api.textTex(text, 1024, 128, color || '#173851', '#eff4f3', '600 65px sans-serif'), roughness: 0.75 });
    p.geo(mat, new THREE.PlaneGeometry(width, height).translate(x, y, z));
  }

  function wheel(p, x, z, r, width) {
    var y = r, side = Math.sign(z) || 1;
    p.geo(M.rubber, new THREE.TorusGeometry(r * 0.73, r * 0.27, 10, 24).translate(x, y, z));
    p.cyl(M.rubber, r * 0.93, width, x, y, z, Math.PI / 2);
    p.cyl(M.steel, r * 0.5, width + 0.04, x, y, z, Math.PI / 2);
    p.cyl(M.darkSteel, r * 0.22, width + 0.07, x, y, z, Math.PI / 2);
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      p.cyl(M.white, r * 0.045, 0.05, x + Math.cos(a) * r * 0.34, y + Math.sin(a) * r * 0.34, z + side * (width / 2 + 0.05), Math.PI / 2);
    }
    for (var t = 0; t < 20; t++) {
      var g = U.box(r * 0.16, 0.045, width * 0.95, 0, r - 0.015, 0);
      g.rotateZ(t * Math.PI / 10).translate(x, y, z); p.geo(M.rubber, g);
    }
  }

  /* 侧面轮廓挤出：斜风挡、收腰车头及铲斗不再用整块方盒表示。 */
  function profile(points, depth) {
    var s = new THREE.Shape(); points.forEach(function (v, i) { if (i) s.lineTo(v[0], v[1]); else s.moveTo(v[0], v[1]); }); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 1, steps: 1 }).translate(0, 0, -depth / 2);
  }

  function cab(p, x, paint) {
    p.geo(paint, profile([[x - 1.1, 1.25], [x + 1.35, 1.25], [x + 1.35, 2.5], [x + 0.95, 3.7], [x - 0.95, 3.7]], 2.35));
    p.beam(M.glass, [x + 1.32, 2.55, 0], [x + 0.99, 3.52, 0], 0.04, 2.08);
    for (var s = -1; s <= 1; s += 2) {
      p.geo(M.glass, profile([[x - 0.88, 2.5], [x + 1.15, 2.5], [x + 0.85, 3.5], [x - 0.88, 3.5]], 0.02).translate(0, 0, s * 1.215));
      p.rod(paint, [x - 0.25, 2.48, s * 1.24], [x - 0.25, 3.53, s * 1.24], 0.04);
      p.box(M.steel, 0.28, 0.06, 0.05, x - 0.55, 2.18, s * 1.25);
      p.box(M.darkSteel, 0.85, 0.1, 0.38, x, 1.05, s * 1.2);
      p.rod(M.steel, [x + 0.9, 3.3, s * 1.2], [x + 1.1, 3.3, s * 1.65]);
      p.box(M.darkSteel, 0.16, 0.48, 0.25, x + 1.1, 3.2, s * 1.65);
      p.box(M.emissiveWhite, 0.06, 0.22, 0.45, x + 1.4, 1.7, s * 0.8);
      p.rod(M.rubber, [x + 1.34, 2.62, s * 0.3], [x + 1.17, 3.08, s * 0.65], 0.018);
    }
    p.box(M.darkSteel, 0.1, 0.5, 1.4, x + 1.42, 2.02, 0);
    for (var j = 0; j < 5; j++) p.box(M.steel, 0.03, 0.035, 1.25, x + 1.48, 1.83 + j * 0.09, 0);
    p.box(M.steel, 0.18, 0.24, 2.5, x + 1.4, 1.23, 0);
    p.cyl(M.orange, 0.13, 0.2, x, 3.88, 0);
  }

  function tractor(x, z, angle) {
    var p = part('港区牵引车', x, z, angle);
    p.box(M.darkSteel, 12.8, 0.25, 2.1, -2.4, 1.05, 0); cab(p, 3.4, M.blue);
    [-6.5, -5.2, -0.3, 3.6].forEach(function (ax) { [-1.15, 1.15].forEach(function (az) { wheel(p, ax, az, 0.62, 0.4); }); });
    p.box(M.red, 9.6, 0.2, 2.5, -3.6, 1.68, 0);
    for (var r = -7; r < 1; r += 0.85) p.box(M.steel, 0.09, 0.12, 2.35, r, 1.8, 0);
    p.cyl(M.steel, 0.36, 1.6, 1.2, 0.85, 1.02, Math.PI / 2);
    [-1, 1].forEach(function (s) { p.box(M.emissiveRed, 0.06, 0.18, 0.4, -8.5, 1.4, s * 0.9); });
    p.end();
  }

  function loader(x, z, angle) {
    var p = part('铰接式装载机', x, z, angle);
    p.geo(M.yellow, profile([[-3.2, 0.9], [-3.1, 2.2], [-1.1, 2.35], [0, 1.6], [1.7, 1.2], [1.7, 0.8]], 2.35));
    p.geo(M.glass, profile([[-1.6, 2.2], [-1.3, 3.65], [0.1, 3.65], [0.65, 2.2]], 1.85));
    [[-1.6, 2.2, -1], [-1.6, 2.2, 1], [0.65, 2.2, -1], [0.65, 2.2, 1]].forEach(function (a) {
      p.beam(M.yellow, a, [a[0] < 0 ? -1.3 : 0.1, 3.7, a[2]], 0.08, 0.08);
    });
    p.box(M.yellow, 1.8, 0.12, 2.12, -0.6, 3.75, 0);
    [-1.9, 1.45].forEach(function (ax) { [-1.3, 1.3].forEach(function (az) { wheel(p, ax, az, 0.87, 0.55); }); });
    [-0.78, 0.78].forEach(function (s) {
      p.beam(M.yellow, [0.5, 1.2, s], [3.1, 0.8, s], 0.25, 0.36);
      p.rod(M.darkSteel, [-0.15, 1.9, s], [1.4, 1.5, s], 0.13);
      p.rod(M.steel, [1.4, 1.5, s], [2.75, 0.8, s], 0.075);
    });
    p.geo(M.yellowDark, profile([[2.8, 0.3], [2.8, 1.45], [3.0, 1.5], [3.15, 0.5], [4.2, 0.22], [4.2, 0.12]], 2.9));
    [-1.5, 1.5].forEach(function (s) { p.geo(M.yellow, profile([[2.8, 0.25], [2.8, 1.4], [3.4, 1.05], [4.2, 0.2]], 0.08).translate(0, 0, s)); });
    for (var t = -1.2; t <= 1.2; t += 0.4) p.box(M.steel, 0.4, 0.1, 0.16, 4.25, 0.17, t);
    for (var g = 0; g < 9; g++) p.box(M.darkSteel, 0.04, 0.07, 1.8, -3.2, 1.1 + g * 0.1, 0);
    p.cyl(M.darkSteel, 0.095, 1.5, -2.3, 2.8, -0.6); p.cyl(M.orange, 0.14, 0.24, -0.6, 3.94, 0);
    p.end();
  }

  function reachStacker(x, z) {
    var p = part('伸缩臂集装箱正面吊', x, z);
    p.box(M.blue, 6.6, 1.15, 3.2, 0, 1.5, 0); cab(p, -1, M.blue);
    [-2.2, 2.1].forEach(function (ax) { [-1.6, 1.6].forEach(function (az) { wheel(p, ax, az, 1, 0.65); }); });
    p.beam(M.blue, [-2.2, 2.4, 0], [2.6, 5.8, 0], 0.9, 1.15);
    p.beam(M.steel, [1.8, 5.23, 0], [5.4, 7.6, 0], 0.62, 0.78);
    [-0.9, 0.9].forEach(function (s) { p.rod(M.darkSteel, [-0.8, 1.8, s], [1, 4.4, s], 0.18); p.rod(M.steel, [1, 4.4, s], [2.3, 5.55, s], 0.1); });
    p.box(M.yellow, 6.1, 0.35, 2.35, 5.35, 6.8, 0); p.cyl(M.darkSteel, 0.42, 0.7, 5.35, 7.25, 0);
    [-1, 1].forEach(function (a) { [-1, 1].forEach(function (s) { p.box(M.darkSteel, 0.3, 0.5, 0.26, 5.35 + a * 2.8, 6.55, s * 1); }); });
    p.end();
  }

  function warehouse(x, z, name) {
    var p = part(name, x, z);
    p.box(M.concrete, 92, 1.1, 53, 0, 0.55, 0);
    p.box(M.cladding, 90, 12, 50, 0, 7.1, 0);
    [-45, 45].forEach(function (sx) {
      p.geo(M.cladding, profile([[-25, 13.1], [0, 16], [25, 13.1]], 0.15).rotateY(Math.PI / 2).translate(sx, 0, 0));
    });
    for (var side = -1; side <= 1; side += 2) {
      p.beam(M.roof, [-46, 16, 0], [-46, 13, side * 26], 0.18, 0.18);
      p.geo(M.roof, U.box(93, 0.22, 26.3, 0, 0, 0).rotateX(side * 0.115).translate(0, 14.5, side * 13));
      p.box(M.blue, 92, 0.55, 0.25, 0, 12.7, side * 25.2);
      for (var bx = -42; bx <= 42; bx += 7) p.box(M.steel, 0.16, 12, 0.24, bx, 7, side * 25.12);
      for (var dx = -35; dx <= 35; dx += 14) {
        p.box(M.darkSteel, 6.2, 5.2, 0.22, dx, 3.7, side * 25.25);
        for (var sl = 0; sl < 17; sl++) p.box(M.steel, 5.8, 0.055, 0.04, dx, 1.3 + sl * 0.3, side * 25.39);
        p.box(M.blue, 7, 0.18, 3.2, dx, 6.6, side * 26.2);
        [-3.5, 3.5].forEach(function (off) { p.cyl(M.yellow, 0.16, 1.2, dx + off, 0.6, side * 26); });
      }
      p.box(M.concrete, 91, 1, 3.2, 0, 0.5, side * 26.6);
      for (var drain = -43; drain <= 43; drain += 43) p.rod(M.steel, [drain, 0.1, side * 25.5], [drain, 13, side * 25.5], 0.1);
    }
    for (var i = -38; i <= 38; i += 9.5) {
      p.box(M.white, 3.2, 0.7, 2, i, 16.5, 0); p.cyl(M.darkSteel, 0.55, 0.4, i, 17.05, 0);
      p.geo(M.solar, U.box(6.8, 0.08, 8, 0, 0, 0).rotateX(0.115).translate(i, 14.95, 11));
    }
    sign(p, name + '  /  LOGISTICS', 27, 2.2, 0, 10, 25.3);
    stair(p, 43, 29.5, 1.1, 2.5, 1.6); p.end();
  }

  function gantry(x, z, num) {
    var p = part('轨道式场桥 ' + num, x, z);
    [-26, 26].forEach(function (s) {
      p.box(M.steel, 0.18, 0.18, 96, s, 0.12, 0);
      [-7, 7].forEach(function (zz) {
        p.box(M.blue, 2.1, 1.1, 4.6, s, 1.05, zz);
        for (var j = -1; j <= 1; j++) p.cyl(M.darkSteel, 0.5, 1.65, s, 0.56, zz + j * 1.3, Math.PI / 2);
        p.beam(M.blue, [s, 1.6, zz], [s * 0.92, 20, zz * 0.45], 1.1, 1.1);
      });
      p.beam(M.blue, [s, 4, -7], [s * 0.94, 17, 3], 0.35, 0.35);
      p.beam(M.blue, [s, 4, 7], [s * 0.94, 17, -3], 0.35, 0.35);
      p.box(M.blue, 2, 1.2, 15, s, 5.2, 0);
    });
    [-3.2, 3.2].forEach(function (zz) {
      p.box(M.blue, 60, 1.5, 1.2, 0, 20, zz);
      p.box(M.steel, 60, 0.1, 0.12, 0, 20.81, zz);
      p.box(M.darkSteel, 60, 0.12, 1.1, 0, 20.7, zz + 1.1);
      railing(p, [-30, 20.8, zz + 1.6], [30, 20.8, zz + 1.6]);
      for (var r = -28; r <= 28; r += 2) p.box(M.blue, 0.12, 1.55, 1.3, r, 20, zz);
    });
    p.box(M.blue, 5, 1, 8.6, 6, 21.2, 0);
    p.box(M.white, 2.6, 2.8, 2, 6, 18.8, 5.6); p.box(M.glass, 2.4, 1.4, 2.05, 6, 19, 5.6);
    [-2.8, 2.8].forEach(function (xx) { [-1, 1].forEach(function (zz) { p.rod(M.rubber, [6 + xx, 21, zz], [6 + xx, 11.5, zz], 0.035); }); });
    p.box(M.yellow, 6.3, 0.5, 2.5, 6, 11.3, 0);
    p.cyl(M.darkSteel, 0.55, 3, 6, 22.15, 0, Math.PI / 2); ladder(p, -26, 7.8, 0, 21);
    sign(p, 'PORT  ' + num, 8, 1, -8, 20, 3.83); p.end();
  }

  function conveyor(x, z, length, height) {
    var p = part('桁架输送廊道', x, z);
    p.box(M.rubber, length, 0.14, 1.6, 0, height, 0);
    for (var i = -length / 2; i < length / 2; i += 3) {
      p.cyl(M.steel, 0.12, 1.9, i, height - 0.1, 0, Math.PI / 2);
      [-1.2, 1.2].forEach(function (s) { p.beam(M.blue, [i, height - 1.4, s], [i + 3, height + 0.2, s], 0.09, 0.09); });
    }
    [-1.2, 1.2].forEach(function (s) {
      p.box(M.blue, length, 0.16, 0.16, 0, height - 1.4, s); p.box(M.blue, length, 0.16, 0.16, 0, height + 0.2, s);
      p.box(M.steel, length, 0.1, 0.7, 0, height, s * 1.6); railing(p, [-length / 2, height, s * 1.9], [length / 2, height, s * 1.9]);
    });
    for (var st = -length / 2 + 3; st < length / 2; st += 15) {
      [-1.3, 1.3].forEach(function (s) { p.box(M.concrete, 1.2, 0.4, 1.2, st, 0.2, s); p.beam(M.blue, [st, 0, s], [st, height, s], 0.18, 0.18); });
      p.beam(M.blue, [st, 0.5, -1.3], [st, height - 1.5, 1.3], 0.12, 0.12);
    }
    p.end();
  }

  function bulkTerminal() {
    var p = part('散货储运区', 236, -195);
    p.box(M.concrete, 124, 0.2, 113, 0, 0.1, 0);
    [-30, -10, 10, 30].forEach(function (x) {
      p.cyl(M.white, 7, 23, x, 15, -28);
      p.geo(M.steel, new THREE.ConeGeometry(7.2, 3.5, 32).translate(x, 28.2, -28));
      p.geo(M.steel, new THREE.ConeGeometry(6.8, 5, 32).rotateX(Math.PI).translate(x, 3, -28));
      for (var h = 5; h <= 26; h += 3) p.geo(M.steel, new THREE.TorusGeometry(7.03, 0.065, 5, 32).rotateX(Math.PI / 2).translate(x, h, -28));
      [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { p.beam(M.blue, [x + a * 4.5, 0, -28 + b * 4.5], [x + a * 4.5, 5, -28 + b * 4.5], 0.3, 0.3); }); });
      ladder(p, x, -20.7, 0, 27); p.cyl(M.steel, 0.45, 8, x, 29, -28);
    });
    p.box(M.steel, 84, 0.18, 2.5, 0, 27, -28); railing(p, [-42, 27, -26.7], [42, 27, -26.7]);
    [-29, 20].forEach(function (x, n) {
      p.box(M.concrete, 41, 2.2, 0.35, x, 1.1, 47);
      [-20, 20].forEach(function (s) { p.box(M.concrete, 0.35, 2.2, 44, x + s, 1.1, 25); });
      var g = new THREE.PlaneGeometry(36, 39, 28, 28).rotateX(-Math.PI / 2), a = g.attributes.position;
      for (var i = 0; i < a.count; i++) { var xx = a.getX(i) / 18, zz = a.getZ(i) / 19.5; a.setY(i, Math.max(0, 1 - xx * xx) * Math.max(0, 1 - zz * zz) * (6 + 0.25 * Math.sin(xx * 27 + zz * 13))); }
      g.computeVertexNormals(); g.translate(x, 0.2, 25); p.geo(n ? M.ore : M.coal, g);
    });
    p.end(); conveyor(236, -197, 96, 11); loader(218, -141, Math.PI * 0.2);
  }

  function roads() {
    var p = part('道路与港区设施');
    /* 新道路在既有码头后侧，不覆盖轨道和教学作业区域。 */
    [-120, -275, -379].forEach(function (z) {
      p.box(M.asphalt, 620, 0.065, 14, 0, 0.045, z);
      [-6.4, 6.4].forEach(function (s) { p.box(M.white, 620, 0.02, 0.13, 0, 0.09, z + s); });
      for (var x = -305; x < 310; x += 9) { if (Math.abs(x) > 12 && Math.abs(Math.abs(x) - 150) > 10) p.box(M.yellow, 4.5, 0.02, 0.16, x, 0.09, z); }
    });
    [-150, 0, 150].forEach(function (x) {
      p.box(M.asphalt, 14, 0.07, 290, x, 0.048, -255);
      for (var z = -392; z < -110; z += 9) { if (Math.abs(z + 275) > 12 && Math.abs(z + 379) > 12 && Math.abs(z + 120) > 12) p.box(M.yellow, 0.15, 0.02, 4.5, x, 0.1, z); }
      [-6.4, 6.4].forEach(function (s) { p.box(M.white, 0.13, 0.02, 277, x + s, 0.11, -254); });
    });
    for (var px = -300; px <= 300; px += 60) {
      [-105, -262, -390].forEach(function (pz) {
        if (Math.abs(px) < 20) return;
        p.box(M.concrete, 1.3, 0.5, 1.3, px, 0.25, pz);
        p.cyl(M.steel, 0.16, 18, px, 9, pz); p.box(M.darkSteel, 3.3, 0.15, 1.8, px, 18, pz);
        [-1, 1].forEach(function (dx) { [-0.5, 0.5].forEach(function (dz) { p.box(M.emissiveWhite, 0.8, 0.12, 0.5, px + dx, 17.9, pz + dz); }); });
      });
    }
    [-150, 0, 150].forEach(function (x) { for (var c = -4; c <= 4; c++) p.box(M.white, 0.5, 0.02, 3, x + c, 0.14, -363); });
    p.end();
    var g = part('港区出入口', 0, -373);
    [-16, 16].forEach(function (x) { g.box(M.concrete, 1, 5.6, 1, x, 2.8, 0); });
    g.box(M.blue, 35, 0.6, 10, 0, 5.8, 0); g.box(M.white, 34.5, 0.2, 9.6, 0, 5.4, 0);
    [-10, 10].forEach(function (x) {
      g.box(M.white, 2.3, 2.8, 3.5, x, 1.4, 0); g.box(M.glass, 2.4, 1.1, 3.6, x, 1.9, 0);
      g.box(M.yellow, 0.35, 1.1, 0.45, x + 2, 0.55, 4);
      g.box(M.white, 5.5, 0.12, 0.1, x > 0 ? x - 3 : x + 3, 1.1, 4);
      for (var stripe = 0; stripe < 5; stripe++) g.box(M.red, 0.4, 0.13, 0.12, (x > 0 ? x - 5 : x + 1) + stripe, 1.1, 4);
    });
    sign(g, '港区物流中心  /  PORT LOGISTICS', 25, 1.35, 0, 5.85, 5.06); g.end();
  }

  function tugboat() {
    var p = part('港作拖轮', 72, 62, -0.18), shape = new THREE.Shape();
    shape.moveTo(-7, -2.6); shape.lineTo(3.8, -2.6); shape.quadraticCurveTo(9, -2.3, 9.2, 0); shape.quadraticCurveTo(9, 2.3, 3.8, 2.6); shape.lineTo(-7, 2.6); shape.quadraticCurveTo(-8.2, 0, -7, -2.6);
    p.geo(M.hullDark, new THREE.ExtrudeGeometry(shape, {depth:2.4, bevelEnabled:true, bevelSize:0.18, bevelThickness:0.18, bevelSegments:2,curveSegments:20}).rotateX(-Math.PI / 2).translate(0, -1.65, 0));
    p.geo(M.hatch, new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2).translate(0, 0.96, 0));
    p.box(M.white, 5.3, 2.4, 3.5, 0.8, 2.15, 0);
    p.geo(M.white, profile([[-1.8, 3.3], [3.5, 3.3], [3.15, 5.1], [-1.6, 5.1]], 4.15));
    for (var s = -1; s <= 1; s += 2) {
      for (var i = 0; i < 5; i++) p.box(M.glass, 0.75, 0.8, 0.04, -1.1 + i * 0.9, 4.25, s * 2.12);
      for (var tx = -5.5; tx <= 5.5; tx += 1.5) p.geo(M.rubber, new THREE.TorusGeometry(0.43, 0.16, 8, 18).translate(tx, 0.12, s * 2.75));
      railing(p, [-6.7, 1, s * 2.45], [4.8, 1, s * 2.45], 0.85, M.white);
      ladder(p, -1.8, s * 1.86, 1, 3.4);
      p.cyl(M.yellow, 0.25, 2.3, -2.7, 3.7, s * 1.3); p.cyl(M.darkSteel, 0.27, 0.2, -2.7, 4.9, s * 1.3);
    }
    p.box(M.white, 5.7, 0.15, 4.65, 0.8, 5.18, 0);
    for (var k = -1; k <= 1; k++) p.box(M.glass, 0.04, 0.83, 1.05, 3.38, 4.2, k * 1.2);
    p.box(M.blue, 2.4, 0.45, 1.7, -4.7, 1.18, 0); p.cyl(M.steel, 0.5, 1.3, -4.7, 1.75, 0, Math.PI / 2);
    for (var r = -0.5; r <= 0.5; r += 0.12) p.geo(M.rubber, new THREE.TorusGeometry(0.47, 0.045, 5, 20).translate(-4.7, 1.75, r));
    p.cyl(M.white, 0.08, 3.3, 0, 6.7, 0); p.box(M.steel, 2.8, 0.08, 0.08, 0, 7.4, 0);
    p.box(M.white, 1.8, 0.14, 0.3, 0, 8.4, 0); p.cyl(M.emissiveWhite, 0.1, 0.15, 0, 8.65, 0);
    p.geo(M.orange, new THREE.TorusGeometry(0.32, 0.09, 8, 24).translate(0.4, 2.2, 1.8));
    [-1, 1].forEach(function (s) {
      p.box(M.white, 0.8, 1.6, 0.05, 1.7, 1.8, s * 1.79);
      p.geo(M.glass, new THREE.CircleGeometry(0.2, 20).translate(1.7, 2.18, s * 1.83));
      p.box(M.steel, 0.14, 0.04, 0.06, 1.93, 1.65, s * 1.86);
      p.cyl(M.darkSteel, 0.2, 0.55, 6.2, 1.25, s * 1.2);
      p.rod(M.darkSteel, [5.85, 1.5, s * 1.2], [6.55, 1.5, s * 1.2], 0.1);
      p.box(M.white, 0.3, 0.18, 0.26, 1.7, 5.4, s * 2);
      p.cyl(s > 0 ? M.emissiveGreen : M.emissiveRed, 0.1, 0.12, 1.7, 5.55, s * 2);
    });
    railing(p, [4.8, 1, -2.45], [7.6, 1, -1.5], 0.85, M.white);
    railing(p, [7.6, 1, -1.5], [8.4, 1, 0], 0.85, M.white);
    railing(p, [8.4, 1, 0], [7.6, 1, 1.5], 0.85, M.white);
    railing(p, [7.6, 1, 1.5], [4.8, 1, 2.45], 0.85, M.white);
    sign(p, 'PORT TUG 06', 3, 0.38, 0.7, 1.4, 2.82); p.end();
  }

  function shipDetail() {
    var sh = w.CFG.scene.ship, p = part('散货船检修平台与甲板设施', sh.x, sh.z), dy = sh.deckY;
    var sx = -sh.length / 2 + 8;
    [-1, 1].forEach(function (side) {
      var z = side * 8.2;
      [dy + 3.1, dy + 5.3, dy + 7.3].forEach(function (y) {
        p.box(M.white, 12.6, 0.12, 1.1, sx, y, z); railing(p, [sx - 6.3, y, z + side * 0.5], [sx + 6.3, y, z + side * 0.5], 0.9, M.white);
      });
      for (var i = -5; i <= 5; i += 2.5) {
        p.box(M.white, 0.065, 5.8, 0.08, sx + i, dy + 5.4, side * 8.25);
        p.geo(M.orange, new THREE.TorusGeometry(0.32, 0.09, 8, 24).translate(sx + i, dy + 3.7, side * 8.85));
      }
      ladder(p, sx + 6.8, side * 7.7, dy, dy + 8.4);
      var boatZ = side * (sh.width / 2 + 1);
      p.geo(M.orange, new THREE.SphereGeometry(1, 24, 12).scale(2.15, 0.75, 0.8).translate(sx - 1.1, dy + 2.4, boatZ));
      p.geo(M.orange, profile([[sx - 2.5, dy + 2.5], [sx - 2, dy + 3.25], [sx - 0.4, dy + 3.25], [sx + 0.5, dy + 2.5]], 1.15).translate(0, 0, boatZ));
      for (var win = 0; win < 3; win++) p.box(M.glass, 0.35, 0.3, 0.05, sx - 1.8 + win * 0.55, dy + 2.95, boatZ + side * 0.62);
      [-2.6, 0.5].forEach(function (dx) {
        p.beam(M.white, [sx + dx, dy + 1.3, side * 8.3], [sx + dx, dy + 4, boatZ], 0.12, 0.16);
        p.rod(M.rubber, [sx + dx, dy + 4, boatZ], [sx + dx, dy + 2.8, boatZ], 0.025);
      });
      for (var hx = -26; hx <= 26; hx += 2) p.box(M.hatch, 0.12, 1.4, 0.2, hx, dy + 0.85, side * (sh.holdHalfW + 0.3));
      for (var pipe = 0; pipe < 3; pipe++) p.rod(M.steel, [-27, dy + 0.15 + pipe * 0.11, side * 7.65], [27, dy + 0.15 + pipe * 0.11, side * 7.65], 0.045);
      for (var cap = -24; cap <= 24; cap += 12) {
        p.cyl(M.white, 0.18, 0.85, cap, dy + 0.42, side * 8);
        p.geo(M.white, new THREE.SphereGeometry(0.23, 16, 8).translate(cap, dy + 0.85, side * 8));
      }
    });
    /* 绞盘与齿轮机座、甲板排水口。 */
    [35, 40].forEach(function (x) {
      p.box(M.blue, 1.6, 0.2, 2.5, x, dy + 0.1, 0); p.cyl(M.steel, 0.5, 1.7, x, dy + 0.9, 0, Math.PI / 2);
      for (var r = -0.7; r <= 0.7; r += 0.12) p.geo(M.rubber, new THREE.TorusGeometry(0.48, 0.045, 5, 24).translate(x, dy + 0.9, r));
      [-1, 1].forEach(function (s) { p.cyl(M.yellow, 0.65, 0.12, x, dy + 0.9, s * 0.9, Math.PI / 2); });
    });
    p.end();
    /* 作业卡车保留装载对象与坐标，只增强底盘、轮胎、车门和风挡细部。 */
    var t = w.CFG.scene.truck, tr = part('自卸车精细附件', t.x, t.z);
    [-4.72, -3.3, 3.3, 4.72].forEach(function (x) { [-1.05, 1.05].forEach(function (z) { wheel(tr, x, z, 0.74, 0.51); }); });
    [-1, 1].forEach(function (s) {
      tr.box(M.blue, 0.07, 1.06, 0.08, 4.3, 2.92, s * 1.31);
      tr.box(M.steel, 0.3, 0.05, 0.04, 3.45, 2.28, s * 1.32);
      tr.rod(M.rubber, [5.71, 2.42, s * 0.3], [5.71, 3.05, s * 0.75], 0.02);
      tr.box(M.white, 8.7, 0.075, 0.025, -1.35, 2, s * 1.43);
      for (var i = -5; i <= 2; i++) tr.box(M.red, 0.3, 0.08, 0.03, i, 2, s * 1.45);
    }); tr.end();
  }

  function forklift(x, z, angle) {
    var p = part('液压叉车', x, z, angle);
    p.geo(M.yellow, profile([[-1.3, 0.35], [-1.5, 1.4], [-0.8, 1.7], [0.9, 1.2], [1, 0.35]], 1.4));
    [-0.9, 0.85].forEach(function (a) { [-0.72, 0.72].forEach(function (b) { wheel(p, a, b, 0.38, 0.25); }); });
    p.box(M.darkSteel, 0.45, 0.12, 0.5, -0.3, 1.3, 0); p.box(M.darkSteel, 0.12, 0.55, 0.5, -0.57, 1.6, 0);
    [-0.62, 0.62].forEach(function (s) {
      p.beam(M.darkSteel, [-1, 1.4, s], [-0.85, 2.6, s], 0.06, 0.06);
      p.beam(M.darkSteel, [0.65, 1.4, s], [0.65, 2.6, s], 0.06, 0.06);
      p.beam(M.darkSteel, [1.05, 0.3, s], [1.05, 3.4, s], 0.12, 0.12);
      p.beam(M.steel, [1.17, 0.5, s * 0.65], [1.17, 3.1, s * 0.65], 0.07, 0.07);
      p.box(M.steel, 1.5, 0.08, 0.14, 1.85, 0.43, s * 0.7);
      p.box(M.darkSteel, 0.09, 0.8, 0.16, 1.18, 0.85, s * 0.7);
    });
    p.box(M.darkSteel, 1.75, 0.1, 1.5, -0.15, 2.65, 0);
    for (var i = -0.5; i < 0.6; i += 0.2) p.box(M.steel, 1.6, 0.05, 0.05, -0.15, 2.72, i);
    p.cyl(M.steel, 0.065, 2.5, 1, 1.65, 0); p.box(M.darkSteel, 0.14, 0.22, 1.3, 1.15, 0.8, 0);
    p.geo(M.rubber, new THREE.TorusGeometry(0.19, 0.025, 6, 16).rotateY(Math.PI / 2).translate(0.45, 1.7, 0));
    p.end();
  }

  function car(x, z, col, angle) {
    var p = part('港区巡检车', x, z, angle), paint = U.paint(col, {metalness:0.35,roughness:0.4});
    p.geo(paint, profile([[-2.2, 0.45], [-2.2, 0.9], [-1.6, 1.05], [-0.9, 1.65], [0.85, 1.65], [1.5, 1], [2.3, 0.85], [2.3, 0.45]], 1.7));
    p.geo(M.glass, profile([[-1.45, 1.08], [-0.85, 1.55], [0.78, 1.55], [1.33, 1.08]], 1.74));
    [-0.15, 0.7].forEach(function (px) { p.box(paint, 0.06, 0.55, 1.79, px, 1.3, 0); });
    p.box(paint, 1.75, 0.08, 1.8, 0, 1.65, 0);
    [-1.4, 1.45].forEach(function (a) { [-0.83, 0.83].forEach(function (b) { wheel(p, a, b, 0.34, 0.23); }); });
    [-1, 1].forEach(function (s) {
      p.box(M.emissiveWhite, 0.06, 0.17, 0.42, 2.34, 0.72, s * 0.57);
      p.box(M.emissiveRed, 0.06, 0.17, 0.3, -2.23, 0.75, s * 0.6);
      p.box(M.darkSteel, 0.23, 0.12, 0.21, 1, 1.12, s * 0.98);
      p.box(M.steel, 0.21, 0.035, 0.03, 0.2, 0.98, s * 0.9);
    }); p.end();
  }

  function administration() {
    var p = part('调度楼与停车区', 72, -333);
    p.box(M.concrete, 47, 0.25, 39, 0, 0.125, 0);
    p.box(M.white, 33, 10.5, 17, 0, 5.3, 0);
    for (var level = 0; level < 3; level++) {
      p.box(M.blue, 33.3, 0.35, 17.3, 0, 3.35 + level * 3.3, 0);
      for (var x = -14; x <= 14; x += 3.5) {
        [-1, 1].forEach(function (s) { p.box(M.darkSteel, 2.5, 1.65, 0.12, x, 2.1 + level * 3.3, s * 8.55); p.box(M.glass, 2.28, 1.45, 0.14, x, 2.1 + level * 3.3, s * 8.6); });
      }
    }
    p.box(M.blue, 34, 0.35, 18, 0, 10.8, 0); p.box(M.blue, 6.5, 0.2, 3.2, 0, 3.3, 9.3);
    p.box(M.glass, 3.1, 2.6, 0.15, 0, 1.5, 8.7); sign(p, '港区调度中心', 10, 1.1, 0, 9.5, 8.7);
    for (var ac = -12; ac <= 12; ac += 6) { p.box(M.white, 1.8, 1, 1.2, ac, 11.4, -3); p.cyl(M.darkSteel, 0.4, 0.1, ac, 11.95, -3); }
    for (var pk = -19; pk <= 19; pk += 3) p.box(M.white, 0.12, 0.02, 5.5, pk, 0.28, 15.8);
    p.end();
    for (var i = 0; i < 5; i++) car(56 + i * 6, -316, i % 2 ? 0x244a69 : 0xbfc7cc, Math.PI / 2);
    [11, 15.5, 20, 24.5].forEach(function (x, i) { car(x, -63, [0xd9dde1, 0x25313d, 0x8c2d2a, 0x375a7e][i], 0); });
    var racks = part('备件与钢材堆场', -78, -329);
    for (var row = 0; row < 4; row++) {
      racks.box(M.concrete, 40, 0.18, 9, 0, 0.09, row * 10 - 15);
      for (var i = -3; i <= 3; i++) {
        racks.cyl(M.steel, 0.55, 8.5, i * 1.2, 0.85, row * 10 - 15, Math.PI / 2);
        racks.cyl(M.darkSteel, 0.45, 0.02, i * 1.2, 0.85, row * 10 - 10.72, Math.PI / 2);
      }
      [-12, 12].forEach(function (x) {
        racks.cyl(M.blue, 0.95, 1.8, x, 1.1, row * 10 - 15, Math.PI / 2);
        [-1, 1].forEach(function (s) { racks.cyl(M.yellow, 1.15, 0.1, x, 1.1, row * 10 - 15 + s * 0.95, Math.PI / 2); });
      });
    } racks.end(); forklift(-55, -320, 0.4);
  }

  function landscape() {
    var p = part('港区外陆地与绿化');
    p.box(M.ground, 8000, 0.4, 4000, 0, -0.6, -1984);
    /* 出入口接入外部道路，围墙外仍有连续陆地。 */
    p.box(M.asphalt, 26, 0.05, 180, 0, -0.21, -488);
    p.box(M.asphalt, 1400, 0.05, 22, 0, -0.21, -560);
    for (var i = -680; i < 690; i += 12) p.box(M.white, 6, 0.02, 0.2, i, -0.18, -560);
    p.box(M.grass, 636, 0.08, 5, 0, 0.1, -393);
    p.box(M.grass, 4, 0.08, 400, -312, 0.1, -190); p.box(M.grass, 4, 0.08, 400, 312, 0.1, -190);
    // The green belt stops at the entrance.
    p.box(M.asphalt, 26, 0.06, 24, 0, 0.16, -392);
    p.end();
    var trees = [];
    [-13.5, -88].forEach(function (z) { [-150,-110,-64,-20,22,64,110,150].forEach(function (x) { trees.push([x,z]); }); });
    for (var x = -300; x <= 300; x += 24) if (Math.abs(x) > 24) trees.push([x,-393]);
    for (var z = -360; z < -30; z += 30) { trees.push([-312,z]); trees.push([312,z]); }
    var trunks = part('树干与种植池'), leaves = [], rnd = function (v) { var s = Math.sin(v * 91.731) * 143758.5453; return s - Math.floor(s); };
    trees.forEach(function (v, index) {
      var x=v[0],z=v[1]; trunks.box(M.concrete,2.5,0.2,2.5,x,0.1,z); trunks.box(M.earth,2.2,0.05,2.2,x,0.22,z);
      trunks.cyl(M.bark,0.13,2.7,x,1.55,z);
      for (var b=0;b<7;b++) {
        var a=b*2.4, r=0.7+rnd(index+b)*0.8, bx=x+Math.cos(a)*r, bz=z+Math.sin(a)*r, by=3.2+rnd(index+b+4)*1.5;
        trunks.rod(M.bark,[x,2,z],[bx,by,bz],0.065);
        for(var c=0;c<5;c++) leaves.push([bx+(rnd(b*9+c+index)-0.5)*1.2,by+(rnd(c*7+index)-0.5),bz+(rnd(c*13+index)-0.5)*1.2,0.5+rnd(c+index)*0.45]);
      }
    }); trunks.end();
    var leafGeo=new THREE.IcosahedronGeometry(1,1), leafMat=U.paint(0x355b34,{roughness:1}), inst=new THREE.InstancedMesh(leafGeo,leafMat,leaves.length), obj=new THREE.Object3D();
    leaves.forEach(function(v,i){obj.position.set(v[0],v[1],v[2]);obj.scale.set(v[3],v[3]*0.7,v[3]);obj.rotation.set(i, i*0.6, i*0.3);obj.updateMatrix();inst.setMatrixAt(i,obj.matrix);inst.setColorAt(i,new THREE.Color().setRGB(0.65+rnd(i)*0.35,0.8+rnd(i+1)*0.2,0.65+rnd(i+2)*0.3));});
    inst.name='实例化树冠';inst.castShadow=true;inst.receiveShadow=true;root.add(inst);
  }

  P.build = function (scene, helpers) {
    api = helpers; M = helpers.materials;
    root = new THREE.Group(); root.name = '扩建港区'; scene.add(root);
    /* 压型钢板采用微法线起伏，不依赖外部贴图下载。 */
    var cv = document.createElement('canvas'); cv.width = cv.height = 128; var ctx = cv.getContext('2d');
    ctx.fillStyle = '#b4bcc3'; ctx.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 128; i += 16) { ctx.fillStyle = '#7e8994'; ctx.fillRect(i, 0, 4, 128); ctx.fillStyle = '#d6dce1'; ctx.fillRect(i + 5, 0, 3, 128); }
    var map = new THREE.CanvasTexture(cv); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(12, 2); map.anisotropy = 4; map.encoding = THREE.sRGBEncoding;
    M.cladding = new THREE.MeshStandardMaterial({color:0xa2acb4,map:map,bumpMap:map,bumpScale:0.035,metalness:0.35,roughness:0.66});
    M.roof = U.paint(0x36506a, {metalness:0.4,roughness:0.62}); M.solar = U.paint(0x172c43, {metalness:0.6,roughness:0.3});
    M.ground=U.paint(0x707568,{roughness:1});M.earth=U.paint(0x4f4434,{roughness:1});M.bark=U.paint(0x60503e,{roughness:0.95});
    landscape();
    roads(); warehouse(-235, -190, '01 综合仓储'); warehouse(-235, -324, '02 设备库'); warehouse(235, -324, '03 转运仓');
    gantry(-52, -205, '01'); gantry(68, -205, '02'); bulkTerminal();
    loader(-20, -35, Math.PI); loader(-100, -62, 0.2); reachStacker(27, -28);
    tractor(90, -117, 0); tractor(-150, -248, Math.PI / 2); tractor(150, -310, -Math.PI / 2); tractor(-230, -272, Math.PI);
    tugboat(); shipDetail();
    forklift(46,9.6,-0.4);forklift(-14,-9.2,2.6);forklift(-96,-24,1.2);administration();
    P.root = root;
  };
  w.PORT_ENV = P;
})(window);
