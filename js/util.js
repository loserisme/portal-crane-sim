/* =============================================================
 * util.js — 数学工具与几何构造辅助
 * ============================================================= */
(function (w) {
  'use strict';

  var V3 = THREE.Vector3;

  var U = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    rad: function (d) { return d * Math.PI / 180; },
    deg: function (r) { return r * 180 / Math.PI; },

    /* 一阶低通（时间常数 tau 秒） */
    smooth: function (current, target, tau, dt) {
      if (tau <= 0) return target;
      var k = 1 - Math.exp(-dt / tau);
      return current + (target - current) * k;
    },

    /* 匀加速趋近：以 maxRate 把 current 推向 target，返回新值 */
    approach: function (current, target, maxRate, dt) {
      var d = target - current;
      var step = maxRate * dt;
      if (Math.abs(d) <= step) return target;
      return current + Math.sign(d) * step;
    },

    /* 两圆交点，返回上方（y 较大）的解；无解返回 null */
    circleIntersect: function (c1, r1, c2, r2) {
      var dx = c2.x - c1.x, dy = c2.y - c1.y;
      var d = Math.hypot(dx, dy);
      if (d < 1e-6 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
      var a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
      var h2 = r1 * r1 - a * a;
      var h = h2 > 0 ? Math.sqrt(h2) : 0;
      var mx = c1.x + a * dx / d, my = c1.y + a * dy / d;
      var rx = -dy / d * h, ry = dx / d * h;
      var p1 = { x: mx + rx, y: my + ry };
      var p2 = { x: mx - rx, y: my - ry };
      return p1.y >= p2.y ? p1 : p2;
    },

    /* ---------- 几何构造 ---------- */

    /* 两点之间的方杆（截面 sx × sy），沿 z 拉伸后旋到方向 */
    member: function (p1, p2, sx, sy) {
      var a = new V3(p1.x, p1.y, p1.z || 0);
      var b = new V3(p2.x, p2.y, p2.z || 0);
      var dir = new V3().subVectors(b, a);
      var len = dir.length();
      if (len < 1e-5) return null;
      var g = new THREE.BoxGeometry(sx, sy, len);
      var q = new THREE.Quaternion().setFromUnitVectors(
        new V3(0, 0, 1), dir.normalize()
      );
      var m = new THREE.Matrix4().compose(
        a.clone().add(b).multiplyScalar(0.5), q, new V3(1, 1, 1)
      );
      g.applyMatrix4(m);
      return g;
    },

    /* 两点之间的圆管 */
    tube: function (p1, p2, r, seg) {
      var a = new V3(p1.x, p1.y, p1.z || 0);
      var b = new V3(p2.x, p2.y, p2.z || 0);
      var dir = new V3().subVectors(b, a);
      var len = dir.length();
      if (len < 1e-5) return null;
      var g = new THREE.CylinderGeometry(r, r, len, seg || 8, 1);
      var q = new THREE.Quaternion().setFromUnitVectors(
        new V3(0, 1, 0), dir.normalize()
      );
      var m = new THREE.Matrix4().compose(
        a.clone().add(b).multiplyScalar(0.5), q, new V3(1, 1, 1)
      );
      g.applyMatrix4(m);
      return g;
    },

    /* 长方体（可绕 y 轴旋转），坐标为几何中心 */
    box: function (wid, hgt, dep, x, y, z, ry) {
      var g = new THREE.BoxGeometry(wid, hgt, dep);
      var m = new THREE.Matrix4();
      if (ry) {
        m.makeRotationY(ry);
        m.setPosition(x, y, z);
      } else {
        m.makeTranslation(x, y, z);
      }
      g.applyMatrix4(m);
      return g;
    },

    /* 合并几何数组，返回单个 BufferGeometry */
    merge: function (list) {
      var arr = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i]) arr.push(list[i]);
      }
      if (!arr.length) return new THREE.BufferGeometry();
      var g = THREE.BufferGeometryUtils.mergeBufferGeometries(arr, false);
      for (var j = 0; j < arr.length; j++) arr[j].dispose();
      return g;
    },

    /* 创建 Mesh 并挂载 */
    mesh: function (geom, mat, parent, shadow) {
      var m = new THREE.Mesh(geom, mat);
      if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; }
      if (parent) parent.add(m);
      return m;
    },

    /* 标准工程漆材质 */
    paint: function (hex, opts) {
      opts = opts || {};
      return new THREE.MeshStandardMaterial({
        color: hex,
        metalness: opts.metalness != null ? opts.metalness : 0.30,
        roughness: opts.roughness != null ? opts.roughness : 0.55,
        flatShading: !!opts.flat,
        side: opts.side || THREE.FrontSide,
      });
    },
  };

  w.U = U;
})(window);
