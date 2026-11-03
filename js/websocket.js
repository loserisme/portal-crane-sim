/* WebSocket v1: browser simulation endpoint; shared Python bridge, explicit ownership. */
(function (w) {
  'use strict';
  var socket = null, timer = null, lastSeen = 0, simTime = 0, lastEmit = 0, seq = 0;
  var api = { connected: false, active: false, executing: false }, bridge = w.PY.bridge;
  var methods = ['capabilities', 'ping', 'acquire', 'release', 'status', 'set', 'slew', 'radius', 'hoist', 'grab', 'travel', 'speed', 'snap', 'slew_rate', 'slew_free', 'seg_name', 'log', 'reset', 'run_script', 'plot', 'mark', 'reset_seg', 'plot_compare', 'clear_plot', 'records'];
  var fields = ['hoist', 'radius', 'slew', 'slewRate', 'load', 'grab', 'swayZ', 'swayVZ', 'swayX', 'swayMag'];
  function $(id) { return document.getElementById(id); }
  function show(message) { if ($('ws-status')) $('ws-status').textContent = message; }
  function send(data) { if (socket && socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 1048576) socket.send(JSON.stringify(data)); }
  function fail(message, code) { var e = new Error(message); e.code = code || 'INVALID_PARAMS'; throw e; }
  function number(v) { if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6) fail('需要有限数值，绝对值不超过 1000000'); return v; }
  function text(v, max) { if (typeof v !== 'string' || v.length > max) fail('字符串格式或长度不正确'); return v; }
  function keys(v, defaults) { if (v == null) return JSON.stringify(defaults); if (!Array.isArray(v) || !v.length || v.length > fields.length || !v.every(function (k) { return fields.includes(k); })) fail('不支持的曲线字段'); return JSON.stringify(v); }
  function status() { return JSON.parse(bridge.status()); }
  function capabilities() { return { protocol: 1, methods: methods, statusFields: Object.keys(status()), plotFields: fields, units: { slew: 'deg', alpha: 'deg', swayX: 'rad', swayZ: 'rad', swayVX: 'rad/s', swayVZ: 'rad/s', length: 'm', slew_rate: 'deg/s' }, telemetryHz: 20, recordLimit: w.PY.recMax }; }
  api.release = function (reason) {
    if (!api.active) return;
    api.active = false;
    if (w.SCRIPT.running) w.SCRIPT.stop();
    w.KT.stopDriver(); // 同时清除所有目标跟随速度，保留真实姿态及摆动。
    w.UI.syncSliders(); show('已连接 · ' + (reason || '远程控制已停止'));
    send({ v: 1, type: 'event', event: 'released', reason: reason || '主动停止' });
  };
  api.localTakeover = function (reason) { if (!api.executing) api.release(reason); };
  function acquire() {
    if (document.hidden) fail('请保持仿真页面可见后再接管', 'PAGE_HIDDEN');
    if (w.PY.loading) fail('浏览器 Python 正在加载，请稍后接管', 'BUSY');
    if (!api.active) {
      if (w.DRIVER.active || (w.TRUCK_DRIVER && w.TRUCK_DRIVER.active)) w.SCENE.applyView('iso');
      if (w.PY.running) w.PY.stop();
      if (w.DEMO.running) w.DEMO.stop();
      if (w.SCRIPT.running) w.SCRIPT.stop();
      w.KT.stopDriver(); api.active = true; show('已连接 · Python 远程控制中');
    }
    return { active: true, simTime: simTime };
  }
  function invoke(method, args) {
    if (!methods.includes(method)) fail('未知方法：' + method, 'METHOD_NOT_FOUND');
    if (!Array.isArray(args)) fail('params 必须是数组');
    var arity = { capabilities: [0,0], ping: [0,0], acquire: [0,0], release: [0,0], status: [0,0], set: [2,2], slew: [1,1], radius: [1,1], hoist: [1,1], grab: [1,1], travel: [1,1], speed: [1,1], snap: [0,0], slew_rate: [1,1], slew_free: [0,0], seg_name: [1,2], log: [1,1], reset: [0,0], run_script: [1,1], plot: [0,1], mark: [0,1], reset_seg: [0,0], plot_compare: [0,1], clear_plot: [0,0], records: [0,0] }[method];
    if (args.length < arity[0] || args.length > arity[1]) fail('参数数量不正确');
    if (method === 'capabilities') return capabilities();
    if (method === 'ping') return { simTime: simTime, active: api.active };
    if (method === 'status') return status();
    if (method === 'records') return { samples: w.PY.rec, names: w.PY.segNames, segment: w.PY.seg };
    if (method === 'acquire') return acquire();
    if (method === 'release') { api.release(); return true; }
    if (!api.active) fail('请先接管远程控制', 'NOT_OWNER');
    switch (method) {
      case 'set':
        if (!['slew', 'alpha', 'radius', 'hoist', 'grab', 'travel'].includes(args[0])) fail('不支持的机构名称');
        bridge.set(args[0], number(args[1])); break;
      case 'slew': case 'radius': case 'hoist': case 'grab': case 'travel': bridge.set(method, number(args[0])); break;
      case 'speed': bridge.setSpeed(number(args[0])); break;
      case 'snap': bridge.snap(); break;
      case 'slew_rate': bridge.slewRate(number(args[0])); break;
      case 'slew_free': bridge.slewFree(); break;
      case 'seg_name':
        var i = args[1] == null ? -1 : number(args[1]);
        if (i !== -1 && (!Number.isInteger(i) || i < 0 || i > 3)) fail('分段编号为 0 到 3');
        bridge.segName(i, text(args[0], 120)); break;
      case 'log': bridge.log(text(args[0], 4000)); break;
      case 'reset': bridge.reset(); break;
      case 'run_script': var result = bridge.runScript(text(args[0], 64000)); if (result !== 'ok') fail(result, 'SCRIPT_ERROR'); return result;
      case 'plot': return bridge.plot(keys(args[0], ['hoist', 'load']));
      case 'mark': return bridge.mark(args[0] == null ? null : text(args[0], 120));
      case 'reset_seg': return bridge.resetSeg();
      case 'plot_compare': return bridge.plotCompare(keys(args[0], ['swayMag']));
      case 'clear_plot': return bridge.clearPlot();
    }
    w.UI.syncSliders(); return true;
  }
  api.disconnect = function (reason) {
    api.release(reason || '连接已断开'); api.connected = false;
    clearInterval(timer); timer = null;
    if (socket) { var old = socket; socket = null; old.close(1000, 'disconnect'); }
    if ($('ws-connect')) $('ws-connect').disabled = false;
    show(reason || '未连接');
  };
  api.connect = function (url, token) {
    api.disconnect();
    try {
      var target = new URL(url), loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
      if (!['ws:', 'wss:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) fail('请输入有效的 WebSocket 地址，不要在地址中附带口令');
      if (target.protocol === 'ws:' && !loopback) fail('非本机连接请使用 wss://');
      if (typeof token !== 'string' || token.length < 16 || token.length > 256) fail('配对口令需要 16～256 个字符');
      socket = new WebSocket(target.href);
    } catch (e) { show(e.message); return; }
    $('ws-connect').disabled = true; show('连接中…'); lastSeen = Date.now();
    var current = socket;
    current.onopen = function () { if (socket === current) send({ v: 1, type: 'hello', token: token }); };
    current.onmessage = function (event) {
      if (current !== socket) return;
      if (typeof event.data !== 'string' || event.data.length > 131072) { api.disconnect('消息过大'); return; }
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { send({ v: 1, type: 'response', id: null, error: { code: 'INVALID_JSON', message: '无效 JSON' } }); return; }
      if (!msg || msg.v !== 1) { api.disconnect('协议版本不兼容'); return; }
      lastSeen = Date.now();
      if (!api.connected) {
        if (msg.type !== 'welcome') { api.disconnect('配对认证失败'); return; }
        api.connected = true; show('已连接 · 等待远程接管');
        send({ v: 1, type: 'ready', capabilities: capabilities() }); return;
      }
      if (msg.type === 'ping') { send({ v: 1, type: 'pong' }); return; }
      if (msg.type !== 'request') return;
      if (typeof msg.id !== 'string' || msg.id.length > 100) { send({ v: 1, type: 'response', id: null, error: { code: 'INVALID_REQUEST', message: '需要字符串 id' } }); return; }
      try {
        api.executing = true;
        var result = invoke(msg.method, msg.params === undefined ? [] : msg.params);
        send({ v: 1, type: 'response', id: msg.id, result: result === undefined ? null : result });
      } catch (e) { send({ v: 1, type: 'response', id: msg.id, error: { code: e.code || 'INTERNAL_ERROR', message: String(e.message) } }); }
      finally { api.executing = false; }
    };
    current.onerror = function () { if (socket === current) api.disconnect('连接失败：检查 Python 服务、口令及浏览器本地网络权限'); };
    current.onclose = function (e) { if (socket === current) api.disconnect(e.code === 4001 ? '配对口令或来源校验失败' : e.code === 4002 ? '服务已有另一个仿真页面连接' : '连接已断开'); };
    timer = setInterval(function () { if (Date.now() - lastSeen > 5000) api.disconnect('连接超时，远程控制已停止'); }, 500);
  };
  api.update = function (dt) {
    simTime += dt;
    if (api.active) w.PY.recordRemote(dt);
    if (api.connected && performance.now() - lastEmit >= 50) {
      lastEmit = performance.now();
      send({ v: 1, type: 'event', event: 'state', seq: ++seq, simTime: simTime, active: api.active, state: status() });
    }
  };
  api.init = function () {
    $('ws-open').addEventListener('click', function () { $('ws-panel').classList.toggle('hidden'); });
    $('ws-close').addEventListener('click', function () { $('ws-panel').classList.add('hidden'); });
    $('ws-form').addEventListener('submit', function (e) { e.preventDefault(); api.connect($('ws-url').value.trim(), $('ws-token').value.trim()); });
    $('ws-disconnect').addEventListener('click', function () { api.disconnect(); });
    $('ws-release').addEventListener('click', function () { api.release('网页停止远程控制'); });
    ['slew', 'radius', 'hoist', 'grab', 'travel', 'btn-reset'].forEach(function (id) { var el = $(id); if (el) el.addEventListener(id === 'btn-reset' ? 'click' : 'input', function () { api.localTakeover('页面手动控制接管'); }, true); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) api.release('页面已进入后台'); });
    w.addEventListener('pagehide', function () { api.disconnect(); });
    // 口令仅放 URL fragment，读取后立即从地址栏清除，不发送到静态托管服务器。
    var fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.has('ws')) {
      var url = fragment.get('ws'), token = fragment.get('token') || '';
      fragment.delete('ws'); fragment.delete('token');
      history.replaceState(null, '', location.pathname + location.search + (fragment.toString() ? '#' + fragment : ''));
      $('ws-url').value = url; $('ws-token').value = token; $('ws-panel').classList.remove('hidden'); api.connect(url, token);
    }
  };
  w.WSAPI = api;
})(window);
