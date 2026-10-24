/* =============================================================
 * ai.js — 门机 AI 助手
 *
 * • 默认接 DeepSeek（OpenAI 兼容接口），可在设置里改 Base URL / 模型 / Key
 * • Key 只存本机 localStorage，不经过任何第三方
 * • 通过 function calling 直接操作门机：设置机构、跑脚本、读状态
 * ============================================================= */
(function (w) {
  'use strict';

  var KT = w.KT, U = w.U, C = w.CFG;

  var STORE_KEY = 'portalcrane.ai.cfg';

  var DEFAULT_CFG = {
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    key: '',
  };

  var AI = {
    cfg: Object.assign({}, DEFAULT_CFG),
    msgs: [],
    busy: false,
    el: {},
  };

  /* ---------------- 配置 ---------------- */
  AI.loadCfg = function () {
    try {
      var raw = w.localStorage.getItem(STORE_KEY);
      if (raw) AI.cfg = Object.assign({}, DEFAULT_CFG, JSON.parse(raw));
    } catch (e) { /* 忽略 */ }
    return AI.cfg;
  };

  AI.saveCfg = function (cfg) {
    AI.cfg = Object.assign({}, AI.cfg, cfg);
    try { w.localStorage.setItem(STORE_KEY, JSON.stringify(AI.cfg)); } catch (e) {}
  };

  /* ---------------- 系统提示 ---------------- */
  var SYS = [
    '你是门座式起重机（抓斗门机）的操作助手，可以直接控制当前网页里的仿真门机。',
    '设备参数：轨距 10 m、基距 12.6 m、臂架 24 m、工作幅度 22.2~32.7 m、起升高度 0.45~26 m、回转 ±180°、大车 ±26 m。',
    '场景：散货船在正前方（回转 -90°、幅度 30 m 附近），船舱内沙面约 2.55 m 高；自卸卡车在 x=23 m 处（回转 0°、幅度 23 m）。',
    '抓斗开度 0~100：0 为闭合，100 为全开。抓取量取决于下放深度与开度，插得深、开得大才抓得满。',
    '需要操作设备时调用工具，不要只在文字里描述。一次可以调用多个工具。',
    '回答用简体中文，简短直接，不要复述参数表。',
  ].join('\n');

  /* ---------------- 工具定义 ---------------- */
  var TOOLS = [
    {
      type: 'function',
      function: {
        name: 'set_crane',
        description: '设置门机各机构的目标位置，只传需要改变的项。机构会按额定速度平滑运行到目标。',
        parameters: {
          type: 'object',
          properties: {
            slew: { type: 'number', description: '回转角（度），-180 ~ 180' },
            radius: { type: 'number', description: '工作幅度（米），22.2 ~ 32.7' },
            hoist: { type: 'number', description: '起升高度（米），抓斗底距轨面，0.45 ~ 26' },
            grab: { type: 'number', description: '抓斗开度百分比，0 闭合 ~ 100 全开' },
            travel: { type: 'number', description: '大车位置（米），-26 ~ 26' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_script',
        description: '执行多行指令脚本，逐行按顺序执行并等待到位。适合编排完整的装卸流程。',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: '每行一条指令，可用：回转/变幅/起升/抓斗/行走/装载/等待/速度/复位，例如 "回转 -90"、"抓斗 0"、"等待 1.2"',
            },
          },
          required: ['code'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_status',
        description: '读取当前门机状态：回转角、幅度、起升高度、抓斗开度、斗内物料、舱内余料、卡车装载数。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_speed',
        description: '设置仿真倍速',
        parameters: {
          type: 'object',
          properties: { speed: { type: 'number', description: '0.5 ~ 8' } },
          required: ['speed'],
        },
      },
    },
  ];

  function execTool(name, args) {
    try {
      if (name === 'set_crane') {
        var done = [];
        if (args.slew != null) { KT.set('slew', args.slew); done.push('回转 ' + args.slew + '°'); }
        if (args.radius != null) { KT.setRadius(args.radius); done.push('幅度 ' + args.radius + ' m'); }
        if (args.hoist != null) { KT.set('hoist', args.hoist); done.push('起升 ' + args.hoist + ' m'); }
        if (args.grab != null) { KT.set('grab', U.clamp(args.grab, 0, 100) / 100); done.push('抓斗 ' + args.grab + '%'); }
        if (args.travel != null) { KT.set('travel', args.travel); done.push('大车 ' + args.travel + ' m'); }
        if (w.UI) w.UI.syncSliders();
        return done.length ? '已下达：' + done.join('，') : '没有有效参数';
      }
      if (name === 'run_script') {
        if (!w.SCRIPT) return '脚本模块不可用';
        var ok = w.SCRIPT.run(args.code);
        return ok ? '脚本已开始执行（' + w.SCRIPT.lines.length + ' 条）' : '脚本启动失败：' + w.SCRIPT.status;
      }
      if (name === 'get_status') {
        var s = KT.ST;
        return JSON.stringify({
          回转角: +U.deg(s.slew).toFixed(1),
          幅度: +s.radius.toFixed(2),
          起升高度: +s.height.toFixed(2),
          抓斗开度: Math.round(s.grabOpen * 100),
          斗内物料: Math.round(s.load * 100),
          舱内余料: Math.round(s.holdRemain * 100),
          卡车装载: (w.DEMO ? w.DEMO.truckLoad : 0) + '/' + C.scene.truck.capacity,
        });
      }
      if (name === 'set_speed') {
        if (w.UI) w.UI.setSpeed(args.speed);
        return '倍速已设为 ' + args.speed + '×';
      }
      return '未知工具：' + name;
    } catch (e) {
      return '执行出错：' + e.message;
    }
  }

  /* ---------------- 消息渲染 ---------------- */
  function pushMsg(role, text) {
    AI.msgs.push({ role: role, content: text });
    render();
  }

  function render() {
    var box = AI.el.msgs;
    if (!box) return;
    box.innerHTML = '';
    for (var i = 0; i < AI.msgs.length; i++) {
      var m = AI.msgs[i];
      if (m.role === 'system' || m.role === 'tool') continue;
      var d = document.createElement('div');
      d.className = 'ai-bubble ' + (m.role === 'user' ? 'me' : 'bot');
      d.textContent = m.content;
      box.appendChild(d);
    }
    if (AI.busy) {
      var t = document.createElement('div');
      t.className = 'ai-bubble bot thinking';
      t.textContent = '思考中…';
      box.appendChild(t);
    }
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- 请求 ---------------- */
  AI.send = function (text) {
    if (AI.busy) return;
    if (!AI.cfg.key) {
      pushMsg('assistant', '还没有填写 API Key。点右上角齿轮，填入 DeepSeek 的 Key（或你自己的 OpenAI 兼容接口）。');
      return;
    }
    if (text && text.trim()) pushMsg('user', text.trim());
    AI.busy = true;
    render();
    loop();
  };

  function loop() {
    var body = {
      model: AI.cfg.model,
      messages: [{ role: 'system', content: SYS }].concat(AI.msgs),
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 900,
    };

    fetch(AI.cfg.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + AI.cfg.key,
      },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.text().then(function (t) {
          if (!r.ok) {
            var msg = 'HTTP ' + r.status;
            try { msg += '：' + (JSON.parse(t).error.message || ''); } catch (e) {}
            throw new Error(msg);
          }
          return JSON.parse(t);
        });
      })
      .then(function (data) {
        var choice = data.choices && data.choices[0];
        var m = choice && choice.message;
        if (!m) throw new Error('返回格式异常');

        var calls = m.tool_calls || [];
        AI.msgs.push({
          role: 'assistant',
          content: m.content || '',
          tool_calls: calls.length ? calls : undefined,
        });

        if (!calls.length) {
          AI.busy = false;
          render();
          return;
        }

        /* 依次执行工具，结果回填 */
        for (var i = 0; i < calls.length; i++) {
          var c = calls[i];
          var args = {};
          try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) {}
          var res = execTool(c.function.name, args);
          AI.msgs.push({ role: 'tool', tool_call_id: c.id, content: res });
        }
        render();
        loop();       // 带工具结果再请求
      })
      .catch(function (err) {
        AI.busy = false;
        pushMsg('assistant', '请求失败：' + err.message +
          '\n\n（若是跨域/CORS 被拦，请换用支持浏览器直连的接口地址）');
      });
  }

  /* ---------------- UI ---------------- */
  AI.init = function () {
    AI.loadCfg();

    var fab = document.getElementById('ai-open');
    var panel = document.getElementById('ai-panel');
    var input = document.getElementById('ai-input');
    var send = document.getElementById('ai-send');
    var setup = document.getElementById('ai-setup-panel');
    var btnSetup = document.getElementById('ai-setup');
    var btnSave = document.getElementById('ai-save');
    var btnClose = document.getElementById('ai-close');
    var inBase = document.getElementById('ai-base');
    var inModel = document.getElementById('ai-model');
    var inKey = document.getElementById('ai-key');

    AI.el = { panel: panel, msgs: document.getElementById('ai-msgs'), input: input };

    function openPanel(show) {
      panel.classList.toggle('hidden', !show);
      if (show) {
        /* 与脚本面板互斥 */
        var cp = document.getElementById('code-panel');
        if (cp) cp.classList.add('hidden');
        input.focus();
      }
    }

    fab.addEventListener('click', function () { openPanel(true); });
    btnClose.addEventListener('click', function () { openPanel(false); });

    btnSetup.addEventListener('click', function () {
      setup.classList.toggle('hidden');
      if (!setup.classList.contains('hidden')) {
        inBase.value = AI.cfg.base;
        inModel.value = AI.cfg.model;
        inKey.value = AI.cfg.key;
        inKey.focus();
      }
    });

    btnSave.addEventListener('click', function () {
      AI.saveCfg({
        base: inBase.value.trim() || DEFAULT_CFG.base,
        model: inModel.value.trim() || DEFAULT_CFG.model,
        key: inKey.value.trim(),
      });
      setup.classList.add('hidden');
      pushMsg('assistant', '配置已保存到本机。可以开始提问了。');
    });

    function doSend() {
      var t = input.value;
      if (!t.trim()) return;
      input.value = '';
      AI.send(t);
    }
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });

    /* 首次使用提示 */
    if (!AI.msgs.length) {
      AI.msgs.push({
        role: 'assistant',
        content: AI.cfg.key
          ? '你好，我可以直接操作这台门机。试试：「把抓斗转到船上，下到沙面抓一斗，再卸到卡车上」。'
          : '你好。先点右上角齿轮填入 API Key（默认 DeepSeek），之后我就能帮你操作门机、解释参数或编写指令脚本。Key 只存在本机浏览器里。',
      });
      render();
    }
  };

  w.AI = AI;
})(window);
