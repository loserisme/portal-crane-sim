/* =============================================================
 * dock.js — 左右侧栏停靠
 *
 *  · 自动收起：鼠标离开面板约 1.2 s 后滑向屏幕侧边，只留一条拉手
 *  · 边缘滑出：鼠标碰到屏幕左右边缘展开；拉手支持点击与键盘操作
 *  · 手动固定：面板顶部的「固定」按钮，锁定后不再自动收起
 *    （状态存 localStorage，刷新后保持）
 *  · 也可以点「收起」立即收进侧边
 * ============================================================= */
(function (w) {
  'use strict';

  var KEY = 'pcrane.dock.v1';
  var HIDE_DELAY = 1200;
  var narrow = false;

  var S = {
    pinned: { left: false, right: false },
    tucked: { left: false, right: false },
    timer: { left: 0, right: 0 },
    onEdge: { left: false, right: false },
    drag: false
  };

  function $(id) { return document.getElementById(id); }

  var panels = { left: $('panel-left'), right: $('panel-right') };
  if (!panels.left || !panels.right) return;

  /* ---------------- 持久化 ---------------- */
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (d && d.pinned) {
        S.pinned.left = !!d.pinned.left;
        S.pinned.right = !!d.pinned.right;
      }
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ pinned: S.pinned })); } catch (e) {}
  }

  /* ---------------- 状态渲染 ---------------- */
  function render(side) {
    var b = document.body;
    b.classList.toggle('tuck-' + side, S.tucked[side]);
    b.classList.toggle('pin-' + side, S.pinned[side]);

    var tab = $('dock-tab-' + side);
    if (tab) {
      tab.querySelector('.dock-arrow').textContent = S.tucked[side]
        ? (side === 'left' ? '›' : '‹')
        : (side === 'left' ? '‹' : '›');
      tab.title = S.tucked[side] ? '展开面板' : '收起面板';
      tab.setAttribute('aria-expanded', String(!S.tucked[side]));
      tab.setAttribute('aria-label', (S.tucked[side] ? '展开' : '收起') + (side === 'left' ? '机构操控' : '实时状态'));
    }

    var pin = $('dock-pin-' + side);
    if (pin) {
      pin.textContent = S.pinned[side] ? '已固定' : '固定';
      pin.classList.toggle('on', S.pinned[side]);
      pin.setAttribute('aria-pressed', String(S.pinned[side]));
      pin.title = S.pinned[side] ? '取消固定（鼠标离开后自动收起）' : '固定此栏，不再自动收起';
    }

    var p = panels[side];
    if (p) {
      try { p.inert = S.tucked[side]; } catch (e) {}
      p.setAttribute('aria-hidden', S.tucked[side] ? 'true' : 'false');
    }
  }

  /* ---------------- 动作 ---------------- */
  function untuck(side) {
    clearTimeout(S.timer[side]);
    if (smallScreen()) tuck(side === 'left' ? 'right' : 'left', true);
    if (!S.tucked[side]) return;
    S.tucked[side] = false;
    render(side);
  }

  function tuck(side, force) {
    clearTimeout(S.timer[side]);
    if (S.pinned[side] && !force) return;
    if (S.tucked[side]) return;
    if (panels[side].contains(document.activeElement)) {
      var tab = $('dock-tab-' + side);
      if (tab) tab.focus({preventScroll:true});
    }
    S.tucked[side] = true;
    render(side);
  }

  function togglePin(side) {
    S.pinned[side] = !S.pinned[side];
    if (S.pinned[side]) untuck(side);
    render(side);
    save();
  }
  function closePanel(side) {
    if(!smallScreen()) S.pinned[side] = false;
    tuck(side, true);
    render(side);
    if(!smallScreen()) save();
  }

  /* 允许自动收起吗：正在往文本框里输入，或正在拖动滑杆时不收 */
  function busy(side) {
    if (S.drag) return true;
    var a = document.activeElement;
    if (!a || !panels[side].contains(a)) return false;
    if (a.matches(':focus-visible')) return true;
    var tag = (a.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input' && /^(text|number|search|email|password)$/i.test(a.type || 'text')) return true;
    return false;
  }

  function scheduleHide(side) {
    clearTimeout(S.timer[side]);
    if (S.pinned[side] || smallScreen()) return;
    S.timer[side] = setTimeout(function () {
      if (!busy(side) && !S.onEdge[side] && !panels[side].matches(':hover')) tuck(side);
    }, HIDE_DELAY);
  }

  /* ---------------- 注入面板头部按钮 ---------------- */
  function injectHead(side) {
    var p = panels[side];
    var head = document.createElement('div');
    head.className = 'dock-head';
    var icon = side === 'left' ? '<path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 7h6"/>' : '<path d="M3 19h18M6 15V9M12 15V4M18 15v-4"/>';
    head.innerHTML =
      '<div class="dock-title"><span class="dock-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'+icon+'</svg></span>'+(side==='left'?'机构操控':'实时状态')+'</div>'+
      '<button class="dock-btn" id="dock-pin-' + side + '" aria-label="固定'+(side==='left'?'机构操控':'实时状态')+'">固定</button>' +
      '<button class="dock-btn dock-collapse" id="dock-collapse-' + side + '" title="收起此栏" aria-label="收起'+(side==='left'?'机构操控':'实时状态')+'">'+(side==='left'?'‹':'›')+'</button>';
    p.insertBefore(head, p.firstChild);

    $('dock-pin-' + side).addEventListener('click', function (e) {
      e.stopPropagation();
      togglePin(side);
    });
    $('dock-collapse-' + side).addEventListener('click', function (e) {
      e.stopPropagation();
      closePanel(side);
    });
  }

  /* ---------------- 拉手与边缘感应 ---------------- */
  function buildChrome() {
    ['left', 'right'].forEach(function (side) {
      var edge = document.createElement('div');
      edge.className = 'dock-edge';
      edge.id = 'dock-edge-' + side;
      document.body.appendChild(edge);

      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'dock-tab';
      tab.id = 'dock-tab-' + side;
      tab.setAttribute('aria-controls', 'panel-' + side);
      tab.innerHTML='<span class="dock-arrow" aria-hidden="true"></span><span class="dock-tab-label" aria-hidden="true">'+(side==='left'?'操控':'状态')+'</span>';
      document.body.appendChild(tab);

      tab.addEventListener('mouseenter', function () { S.onEdge[side] = true; clearTimeout(S.timer[side]); });
      tab.addEventListener('mouseleave', function () { S.onEdge[side] = false; scheduleHide(side); });
      tab.addEventListener('click', function (e) {
        if (S.tucked[side]) { untuck(side); if(e.detail===0) panels[side].querySelector(smallScreen()?'.dock-collapse':'.dock-btn').focus(); }
        else closePanel(side);
      });

      /* 停在边缘上时保持展开，移开才计时收起 */
      edge.addEventListener('mouseenter', function () { S.onEdge[side] = true; untuck(side); });
      edge.addEventListener('mouseleave', function () { S.onEdge[side] = false; scheduleHide(side); });
    });
  }

  /* ---------------- 面板自身事件 ---------------- */
  function bindPanel(side) {
    var p = panels[side];

    p.addEventListener('mouseenter', function () { untuck(side); });
    p.addEventListener('mouseleave', function () { scheduleHide(side); });
    p.addEventListener('focusin', function () { untuck(side); });
    p.addEventListener('focusout', function () { scheduleHide(side); });

    /* 拖动滑杆时即使鼠标移出面板也不收起 */
    p.addEventListener('pointerdown', function (e) {
      var t = e.target;
      if (t && t.tagName === 'INPUT' && t.type === 'range') S.drag = true;
    });
    p.addEventListener('input', function () { untuck(side); });
  }

  w.addEventListener('pointerup', function () { S.drag = false; });
  w.addEventListener('pointercancel', function () { S.drag = false; });
  w.addEventListener('blur', function () { S.drag = false; });

  /* Narrow screens show one panel at a time; retain desktop pin preferences. */
  function smallScreen() { return w.innerWidth <= 900; }
  w.addEventListener('resize', function () {
    if (narrow === smallScreen()) return;
    narrow = smallScreen();
    if(narrow) { tuck('right',true); untuck('left'); }
    else { untuck('left'); untuck('right'); }
  });

  function boot() {
    load();
    narrow = smallScreen();
    ['left', 'right'].forEach(function (side) {
      injectHead(side);
      bindPanel(side);
      render(side);
    });
    buildChrome();
    ['left', 'right'].forEach(render);
    /* 首屏先展开，鼠标移开后才开始自动收起 */
    S.tucked.left = S.tucked.right = false;
    if (narrow) S.tucked.right = true;
    ['left', 'right'].forEach(render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* 对外接口（便于调试/演示） */
  w.DOCK = {
    tuck: function (side) { tuck(side, true); },
    untuck: untuck,
    pin: function (side, on) {
      S.pinned[side] = !!on;
      if (on) untuck(side);
      render(side); save();
    },
    toggle: function (side) {
      if (S.tucked[side]) untuck(side);
      else closePanel(side);
    },
    state: S
  };
})(window);
