/* =============================================================
 * dock.js — 左右侧栏停靠
 *
 *  · 自动收起：鼠标离开面板约 1.2 s 后滑向屏幕侧边，只留一条拉手
 *  · 边缘滑出：鼠标碰到屏幕左右边缘立即滑出，点击拉手也可展开
 *  · 手动固定：面板顶部的「固定」按钮，锁定后不再自动收起
 *    （状态存 localStorage，刷新后保持）
 *  · 也可以点「收起」立即收进侧边
 * ============================================================= */
(function (w) {
  'use strict';

  var KEY = 'pcrane.dock.v1';
  var HIDE_DELAY = 1200;

  var S = {
    pinned: { left: true, right: false },
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
      tab.textContent = side === 'left' ? '操控' : '状态';
      tab.title = S.tucked[side] ? '展开面板' : '收起面板';
      tab.setAttribute('aria-expanded', String(!S.tucked[side]));
      tab.setAttribute('aria-label', (S.tucked[side] ? '展开' : '收起') + (side === 'left' ? '操控面板' : '状态面板'));
    }

    var pin = $('dock-pin-' + side);
    if (pin) {
      pin.textContent = S.pinned[side] ? '已固定' : '固定';
      pin.classList.toggle('on', S.pinned[side]);
      pin.title = S.pinned[side] ? '取消固定（鼠标离开后自动收起）' : '固定此栏，不再自动收起';
    }

    var p = panels[side];
    if (p) {
      try { p.inert = S.tucked[side]; } catch (e) {}
      p.setAttribute('aria-hidden', S.tucked[side] ? 'true' : 'false');
    }
    w.dispatchEvent(new Event('dockchange'));
  }

  /* ---------------- 动作 ---------------- */
  function untuck(side) {
    clearTimeout(S.timer[side]);
    if (!S.tucked[side]) return;
    S.tucked[side] = false;
    render(side);
  }

  function tuck(side, force) {
    clearTimeout(S.timer[side]);
    if (S.pinned[side] && !force) return;
    if (S.tucked[side]) return;
    S.tucked[side] = true;
    render(side);
  }

  function togglePin(side) {
    S.pinned[side] = !S.pinned[side];
    if (S.pinned[side]) untuck(side);
    render(side);
    save();
  }

  /* 允许自动收起吗：正在往文本框里输入，或正在拖动滑杆时不收 */
  function busy(side) {
    if (S.drag) return true;
    var a = document.activeElement;
    if (!a || !panels[side].contains(a)) return false;
    return true; // Keep all focused controls available to keyboard users.
  }

  function scheduleHide(side) {
    clearTimeout(S.timer[side]);
    if (S.pinned[side] || smallScreen()) return;
    S.timer[side] = setTimeout(function () {
      if (!busy(side) && !S.onEdge[side]) tuck(side);
    }, HIDE_DELAY);
  }

  /* ---------------- 注入面板头部按钮 ---------------- */
  function injectHead(side) {
    var p = panels[side];
    var head = document.createElement('div');
    head.className = 'dock-head';
    head.innerHTML =
      '<strong>' + (side === 'left' ? '机构操控' : '实时状态') + '</strong>' +
      '<button class="dock-btn" id="dock-pin-' + side + '">固定</button>' +
      '<button class="dock-btn" id="dock-collapse-' + side + '">收起</button>';
    p.insertBefore(head, p.firstChild);

    $('dock-pin-' + side).addEventListener('click', function (e) {
      e.stopPropagation();
      togglePin(side);
    });
    $('dock-collapse-' + side).addEventListener('click', function (e) {
      e.stopPropagation();
      S.pinned[side] = false;
      render(side);
      tuck(side, true);
      save();
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
      tab.setAttribute('aria-controls', 'panel-' + side);
      tab.className = 'dock-tab';
      tab.id = 'dock-tab-' + side;
      document.body.appendChild(tab);

      tab.addEventListener('mouseenter', function () { S.onEdge[side] = true; });
      tab.addEventListener('mouseleave', function () { S.onEdge[side] = false; scheduleHide(side); });
      tab.addEventListener('click', function () {
        if (S.tucked[side]) untuck(side);
        else { S.pinned[side] = false; render(side); tuck(side, true); save(); }
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
  w.addEventListener('blur', function () { S.drag = false; });

  /* 窄屏（手机/平板）常显，避免误触 */
  function smallScreen() { return w.innerWidth < 900; }

  function boot() {
    load();
    ['left', 'right'].forEach(function (side) {
      injectHead(side);
      bindPanel(side);
      render(side);
    });
    buildChrome();
    ['left', 'right'].forEach(render);
    /* 首屏先展开，鼠标移开后才开始自动收起 */
    S.tucked.left = S.tucked.right = false;
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
      else { S.pinned[side] = false; render(side); tuck(side, true); }
    },
    state: S
  };
})(window);
