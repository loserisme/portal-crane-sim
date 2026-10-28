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
    '你是门座式起重机（抓斗门机）的控制助手，可以直接控制当前网页里的仿真门机，也能为学生编写控制程序。',
    '设备参数：轨距 8.2 m、基距 11.74 m、臂架 26.5 m、工作幅度约 22~33 m、起升高度 0.45~26 m、回转 ±180°、大车 ±26 m。',
    '场景：散货船在正前方（回转 -90°、幅度 30 m 附近），船舱内沙面约 2.55 m 高；自卸卡车在 x=23 m 处（回转 0°、幅度 23 m）。',
    '抓斗开度 0~100：0 为闭合，100 为全开。抓取量取决于下放深度与开度，插得深、开得大才抓得满。',
    '平台提供两套编程入口：脚本（行式指令，适合流程编排）与 Python（真 CPython，适合算法控制）。'
    + '用户要算法、闭环、反馈、防摇摆、定量抓取时，写 Python；只是流程动作时，写脚本。'
    + '需要操作设备时调用工具，不要只在文字里描述。一次可以调用多个工具。',
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
    {
      type: 'function',
      function: {
        name: 'write_script',
        description: '把行式指令脚本写入「脚本」页（不自动运行）。每行一条：回转/变幅/起升/抓斗/行走/装载/等待/速度/复位。',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: '脚本文本，# 开头为注释' },
            run: { type: 'boolean', description: '是否立即运行，默认 false' },
          },
          required: ['code'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_python',
        description: '把 Python 控制程序写入「Python」页（不自动运行）。必须定义 control(dt) 作为每帧回调，可选 setup()。'
          + '可用接口：crane.status() 返回 dict，字段有 slew(回转角°)/alpha(臂架角°)/radius(幅度m)/hoist(起升m)/grab(开度0~1)/load(填充率0~1)/holdLevel(料面m)/holdRemain(舱内余料0~1)/swayX/swayZ(两向摆角,弧度)/swayVX/swayVZ(摆角速度)/swayMag(合成摆角,弧度)/travel(大车m)/grabPos{x,y,z}；'
          + 'crane.slew(deg)/radius(m)/hoist(m)/grab(0~1)/travel(m)/speed(倍速)/snap()/reset()/log(...)/plot(keys)/plot_compare(keys)/mark(name)/clear_plot()。',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Python 源码，需包含 control(dt)' },
            run: { type: 'boolean', description: '是否立即运行，默认 false' },
          },
          required: ['code'],
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
      if (name === 'write_script') {
        if (!w.UI || !w.UI.setScriptCode) return '脚本面板不可用';
        w.UI.setScriptCode(args.code);
        if (args.run && w.SCRIPT) { w.SCRIPT.run(args.code); return '已写入脚本页并开始运行'; }
        return '已写入脚本页（未运行）';
      }
      if (name === 'write_python') {
        if (!w.UI || !w.UI.setPyCode) return 'Python 面板不可用';
        w.UI.setPyCode(args.code);
        if (args.run && w.PY) {
          w.PY.run(args.code);
          return '已写入 Python 页并开始运行（首次会加载 Pyodide，约需数秒）';
        }
        return '已写入 Python 页（未运行）';
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

  /* 通用一次性请求（供曲线评估等外部功能调用） */
  AI.askText = function (system, user) {
    if (!AI.cfg.key) return Promise.reject(new Error('尚未配置 API Key'));
    var body = {
      model: AI.cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: 900,
    };
    return fetch(AI.cfg.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI.cfg.key },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) {
          var msg = 'HTTP ' + r.status;
          try { msg += '：' + (JSON.parse(t).error.message || ''); } catch (e) {}
          throw new Error(msg);
        }
        var d = JSON.parse(t);
        var m = d.choices && d.choices[0] && d.choices[0].message;
        return (m && m.content) || '(空回复)';
      });
    });
  };

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
      max_tokens: 4096,   // 生成完整程序经 tool_calls 返回，900 会被截断
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

        /* 输出被截断且没有工具调用：提示重试而不是静默失败 */
        if (choice.finish_reason === 'length' && !calls.length) {
          AI.msgs.push({ role: 'assistant', content: m.content || '' });
          AI.busy = false;
          render();
          pushMsg('assistant', '（回复因长度限制被截断，请把要求拆小一些再试，例如分两步生成）');
          return;
        }

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
          var args = null, parseErr = '';
          try { args = JSON.parse(c.function.arguments || '{}'); }
          catch (e) { parseErr = e.message; }
          if (!args || typeof args !== 'object') {
            /* 参数被截断/非法 JSON：让模型重发，绝不能拿 undefined 去写面板 */
            AI.msgs.push({
              role: 'tool', tool_call_id: c.id,
              content: '参数 JSON 解析失败（' + (parseErr || '非对象') + '），通常是长度截断所致。'
                + '请重新调用 ' + c.function.name + '，确保 arguments 是完整合法的 JSON；若代码很长请精简。',
            });
            continue;
          }
          if ((c.function.name === 'write_script' || c.function.name === 'write_python') && !args.code) {
            AI.msgs.push({
              role: 'tool', tool_call_id: c.id,
              content: '缺少 code 参数，请重新调用并附上完整代码。',
            });
            continue;
          }
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
          ? '你好，我可以直接操作这台门机，也能给你写控制程序。试试：「把抓斗转到船上抓一斗再卸到卡车上」，或者「写一段防摇摆的 Python 控制」。'
          : '你好。先点右上角齿轮填入 API Key（默认 DeepSeek），之后我就能帮你操作门机、编写脚本或 Python 控制程序。Key 只存在本机浏览器里。',
      });
      render();
    }
  };

  w.AI = AI;
})(window);
