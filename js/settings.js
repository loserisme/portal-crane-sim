/* Moving existing controls preserves their live bindings. */
(function (w) {
  'use strict';
  var panel, head, drag = null, selected = 'basic', initialized = false;
  var $ = function (id) { return document.getElementById(id); };
  function clampPosition(x, y) {
    var margin = 8;
    panel.style.left = Math.max(margin, Math.min(w.innerWidth - panel.offsetWidth - margin, x)) + 'px';
    panel.style.top = Math.max(margin, Math.min(w.innerHeight - panel.offsetHeight - margin, y)) + 'px';
    panel.style.right = 'auto';
  }
  function fit() { if (!panel || panel.classList.contains('hidden')) return; var r = panel.getBoundingClientRect(); clampPosition(r.left, r.top); }
  function minimize(on) {
    panel.classList.toggle('settings-minimized', on);
    $('settings-content').classList.toggle('hidden', on);
    $('settings-minimize').textContent = on ? '+' : '−';
    $('settings-minimize').title = on ? '还原' : '最小化';
    $('settings-minimize').setAttribute('aria-label', on ? '还原设置' : '最小化设置');
    $('settings-minimize').setAttribute('aria-expanded', String(!on)); fit();
  }
  function tab(name, focus) {
    if (!['basic', 'connection', 'help'].includes(name)) return;
    selected = name;
    panel.querySelectorAll('[data-settings-tab]').forEach(function (button) {
      var on = button.dataset.settingsTab === name;
      button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1;
      $('settings-page-' + button.dataset.settingsTab).classList.toggle('hidden', !on);
      if (on && focus) button.focus();
    }); fit();
  }
  var S = {};
  S.open = function (name) {
    if (!initialized) return;
    panel.classList.remove('hidden'); minimize(false); tab(name || selected);
    $('settings-open').setAttribute('aria-expanded', 'true');
    $('settings-tab-' + selected).focus({ preventScroll: true }); fit();
  };
  S.close = function () {
    panel.classList.add('hidden'); drag = null;
    $('settings-open').setAttribute('aria-expanded', 'false'); $('settings-open').focus({ preventScroll: true });
  };
  S.init = function () {
    if (initialized) return;
    initialized = true; panel = $('settings-panel'); head = $('settings-head');
    $('settings-basic-host').appendChild($('settings-basic')); $('settings-basic').classList.remove('hidden');
    $('settings-connection-host').appendChild($('ws-panel')); $('ws-panel').classList.remove('hidden');
    $('settings-open').addEventListener('click', function () { S.open(); });
    $('settings-close').addEventListener('click', S.close);
    $('settings-minimize').addEventListener('click', function () { minimize(!panel.classList.contains('settings-minimized')); });
    panel.querySelectorAll('[data-settings-tab]').forEach(function (button) {
      button.addEventListener('click', function () { tab(button.dataset.settingsTab); });
      button.addEventListener('keydown', function (e) {
        var tabs = ['basic', 'connection', 'help'], i = tabs.indexOf(selected);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); tab(tabs[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3], true); }
        if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); tab(e.key === 'Home' ? 'basic' : 'help', true); }
      });
    });
    // Settings keystrokes must not drive the crane or truck underneath the window.
    panel.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); S.close(); } });
    head.addEventListener('keydown', function (e) {
      if (e.target !== head || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); var r = panel.getBoundingClientRect(), step = e.shiftKey ? 30 : 10;
      clampPosition(r.left + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), r.top + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0));
    });
    head.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      var r = panel.getBoundingClientRect(); drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      head.setPointerCapture(e.pointerId); head.focus({ preventScroll: true }); e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) { if (drag && drag.id === e.pointerId) clampPosition(drag.left + e.clientX - drag.x, drag.top + e.clientY - drag.y); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (event) { head.addEventListener(event, function () { drag = null; }); });
    w.addEventListener('resize', fit);
    $('settings-opacity').addEventListener('input', function () { panel.style.setProperty('--settings-alpha', this.value / 100); $('settings-opacity-value').textContent = this.value + '%'; });
    $('settings-defaults').addEventListener('click', function () {
      w.UI.setSpeed(1);
      document.querySelector('#seg-sway [data-v="on"]').click();
      document.querySelector('#seg-quality [data-v="mid"]').click();
      var defaults = { grid: true, tags: false, radius: true, trace: false };
      document.querySelectorAll('#chips button').forEach(function (b) { if (b.classList.contains('on') !== defaults[b.dataset.k]) b.click(); });
      $('settings-opacity').value = 96; $('settings-opacity').dispatchEvent(new Event('input'));
    });
  };
  w.SETTINGS = S;
})(window);
