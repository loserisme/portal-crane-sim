/* Shared, explicitly simulated weather. Wind load is an optional teaching approximation. */
(function (w) {
  'use strict';
  var W = { state: { sky: 'clear', time: 'day', wind: 3, direction: 90, force: false }, ready: false };
  var rain, positions, lamps, last = 0, elapsed = 0, velocity = { x: 0, z: 0 }, panel;
  var $ = function (id) { return document.getElementById(id); };
  W.init = function () {
    if (W.ready) return;
    W.ready = true;
    panel = document.createElement('fieldset'); panel.className = 'weather-config';
    panel.innerHTML = '<legend>气象环境 · 仿真参数</legend>' +
      '<label>天气<select id="weather-sky"><option value="clear">晴天</option><option value="rain">雨天</option></select></label>' +
      '<label>时段<select id="weather-time"><option value="day">白天</option><option value="night">夜间</option></select></label>' +
      '<label>风速（m/s）<input id="weather-wind" type="number" min="0" max="25" step="0.5" value="3"></label>' +
      '<label>风向（来向）<select id="weather-direction"><option value="0">北风</option><option value="90" selected>东风</option><option value="180">南风</option><option value="270">西风</option></select></label>' +
      '<label class="weather-force"><input id="weather-force" type="checkbox">风载影响吊载摆动（教学近似）</label>' +
      '<small>风速为设定值，不是实时气象数据。北为港区陆侧（−Z）。风载采用简化模型，不用于真实设备作业判断。</small>';
    $('settings-page-basic').appendChild(panel);
    var badge = document.createElement('span'); badge.id = 'weather-overview'; badge.className = 'st';
    $('statusbar').insertBefore(badge, $('statusbar').lastElementChild);
    ['sky', 'time', 'wind', 'direction', 'force'].forEach(function (key) {
      $('weather-' + key).addEventListener('change', function () { W.set(key, this.type === 'checkbox' ? this.checked : this.value); });
    });
    var geo = new THREE.BufferGeometry(); positions = new Float32Array(1000 * 6);
    for (var i = 0; i < 1000; i++) {
      positions[i * 6] = (Math.random() - .5) * 110;
      positions[i * 6 + 1] = Math.random() * 65;
      positions[i * 6 + 2] = (Math.random() - .5) * 110;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb4d8ee, transparent: true, opacity: .48, depthWrite: false }));
    rain.frustumCulled = false; rain.name = '仿真降雨'; w.SCENE.scene.add(rain);
    lamps = new THREE.Group(); lamps.name = '港区夜间照明';
    [-90, -30, 30, 90].forEach(function (x) {
      var lamp = new THREE.PointLight(0xffdda3, .85, 85, 2); lamp.position.set(x, 16, 8); lamps.add(lamp);
      var glow = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe1a6 }));
      glow.position.copy(lamp.position); lamps.add(glow);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(.10, .18, 16, 8), new THREE.MeshStandardMaterial({color:0x4b5862,roughness:.6}));
      pole.position.set(x,8,8); w.SCENE.scene.add(pole);
    });
    w.SCENE.scene.add(lamps); W.apply();
  };
  W.set = function (key, value) {
    if (key === 'sky' && ['clear', 'rain'].includes(value)) W.state.sky = value;
    if (key === 'time' && ['day', 'night'].includes(value)) W.state.time = value;
    if (key === 'wind' && Number.isFinite(+value)) W.state.wind = U.clamp(+value, 0, 25);
    if (key === 'direction' && [0, 90, 180, 270].includes(+value)) W.state.direction = +value;
    if (key === 'force') W.state.force = !!value;
    if (W.ready) W.apply();
  };
  W.apply = function () {
    var s = W.state, S = w.SCENE, night = s.time === 'night', wet = s.sky === 'rain';
    var sky = night ? (wet ? 0x101b2b : 0x14253d) : wet ? 0x879ba9 : 0xccd9e6;
    S.scene.background.setHex(sky); S.scene.fog.color.setHex(sky);
    S.scene.fog.near = wet ? 70 : 600; S.scene.fog.far = wet ? 280 : 1600;
    var hd = w.ENVHD;
    if (hd && hd.sky) {
      hd.sky.uniforms.top.value.setHex(night ? 0x040b18 : wet ? 0x536878 : 0x79aed4);
      hd.sky.uniforms.mid.value.setHex(night ? 0x101c2c : wet ? 0x879ba9 : 0xc8dce9);
      hd.sky.uniforms.low.value.setHex(sky);
      hd.sunSprite.visible = !night && !wet;
      hd.clouds.forEach(function (c) { c.visible = !night; c.material.color.setHex(wet ? 0x748491 : 0xffffff); });
      hd.concrete.roughness = wet ? .44 : .94;
    }
    S.sun.intensity = night ? .13 : wet ? .5 : 1.48;
    S.sun.color.setHex(night ? 0xa8c7f5 : wet ? 0xd4e3f3 : 0xfff3e2);
    S.hemisphere.intensity = night ? .17 : wet ? .53 : .46;
    S.fill.intensity = night ? .07 : .24; S.rim.intensity = night ? .06 : .16;
    S.renderer.toneMappingExposure = night ? .70 : .88;
    S.land.material.roughness = wet ? .44 : .94;
    S.water.material.roughness = wet ? .17 : .30;
    rain.visible = wet; lamps.visible = night;
    Object.keys(s).forEach(function (key) { var el = $('weather-' + key); if (el) { if (el.type === 'checkbox') el.checked = s[key]; else el.value = s[key]; } });
    if ($('driver-weather')) $('driver-weather').textContent = W.summary();
    if ($('weather-overview')) { $('weather-overview').textContent = W.summary(); $('weather-overview').title = W.summary(); }
  };
  W.summary = function () {
    var s = W.state, names = {0:'北',90:'东',180:'南',270:'西'};
    return (s.time === 'day' ? '白天' : '夜间') + ' · ' + (s.sky === 'rain' ? '雨天' : '晴天') + ' · ' + names[s.direction] + '风 ' + s.wind.toFixed(1) + ' m/s · 仿真';
  };
  W.acceleration = function () {
    var s = W.state, angle = s.direction * Math.PI / 180;
    // F/m = 0.5 rho Cd A v² / m, representative loaded grab mass; no safety limits inferred.
    var a = s.force ? .5 * 1.225 * 1.2 * 6 * s.wind * s.wind / 6500 : 0;
    velocity.x = -Math.sin(angle) * a; velocity.z = Math.cos(angle) * a;
    return velocity;
  };
  W.update = function () {
    if (!W.ready) return;
    var now = performance.now() / 1000, dt = Math.min(.05, now - (last || now)); last = now; elapsed += dt;
    if (!rain.visible) return;
    rain.position.copy(w.SCENE.camera.position); rain.position.y -= 25;
    var angle = W.state.direction * Math.PI / 180, dx = -Math.sin(angle) * W.state.wind * .65, dz = Math.cos(angle) * W.state.wind * .65;
    for (var i = 0; i < positions.length; i += 6) {
      positions[i] += dx * dt; positions[i + 1] -= 23 * dt; positions[i + 2] += dz * dt;
      if (positions[i + 1] < 0) { positions[i] = (Math.random() - .5) * 110; positions[i + 1] = 65; positions[i + 2] = (Math.random() - .5) * 110; }
      positions[i + 3] = positions[i] + dx * .055; positions[i + 4] = positions[i + 1] - 1.25; positions[i + 5] = positions[i + 2] + dz * .055;
    }
    rain.geometry.attributes.position.needsUpdate = true;
  };
  w.WEATHER = W;
})(window);
