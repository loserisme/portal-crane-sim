/* Precision inputs reuse the original sliders and their control-ownership handlers. */
(function (w) {
  'use strict';
  function init() {
    var controls = [], compact = w.matchMedia('(max-width:760px)'), previous = null;
    var tools = document.createElement('nav'); tools.id = 'workspace-tools'; tools.setAttribute('aria-label', '场景面板');
    var icons = { left: 'M4 3v14M10 3v14M16 3v14M2 7h4M8 13h4M14 6h4', right: 'M3 3v14h14M6 13V9m4 4V5m4 8v-6', scene: 'M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4' };
    ['left', 'right', 'scene'].forEach(function (side) {
      var button = document.createElement('button'); button.type = 'button'; button.dataset.workspace = side;
      if (side !== 'scene') button.setAttribute('aria-controls', 'panel-' + side);
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true'); path.setAttribute('d', icons[side]); svg.appendChild(path);
      var text = document.createElement('span'); text.textContent = side === 'left' ? '操控' : side === 'right' ? '状态' : '专注场景';
      button.appendChild(svg); button.appendChild(text); tools.appendChild(button);
    });
    document.body.appendChild(tools);
    var hint = document.createElement('p'); hint.className = 'control-hint'; hint.textContent = '拖动滑块调整 · 输入数值精调';
    document.querySelector('#panel-left section').insertBefore(hint, document.querySelector('#panel-left .ctrl'));
    ['slew', 'radius', 'hoist', 'grab', 'travel'].forEach(function (id) {
      var slider = document.getElementById(id), label = document.querySelector('label[for="' + id + '"]').textContent;
      var unit = id === 'slew' ? '°' : id === 'grab' ? '%' : 'm';
      var group = document.createElement('div'); group.className = 'precision-control';
      var input = document.createElement('input'); input.type = 'number'; input.id = id + '-number';
      input.min = slider.min; input.max = slider.max; input.step = slider.step;
      input.setAttribute('aria-label', label + '目标值（' + unit + '）'); input.setAttribute('inputmode', 'decimal');
      var minus = document.createElement('button'), plus = document.createElement('button'), suffix = document.createElement('span');
      minus.type = plus.type = 'button'; minus.textContent = '−'; plus.textContent = '+';
      minus.setAttribute('aria-label', '减小' + label); plus.setAttribute('aria-label', '增大' + label);
      minus.title = '减少 ' + slider.step + ' ' + unit; plus.title = '增加 ' + slider.step + ' ' + unit;
      suffix.className = 'precision-unit'; suffix.textContent = unit;
      [minus, input, suffix, plus].forEach(function (el) { group.appendChild(el); });
      slider.parentElement.querySelector('.ctrl-head').appendChild(group);
      function refresh() {
        if (document.activeElement !== input) input.value = String(+slider.value);
        minus.disabled = +slider.value <= +slider.min; plus.disabled = +slider.value >= +slider.max;
        slider.style.setProperty('--range-progress', (100 * (+slider.value - +slider.min) / (+slider.max - +slider.min)) + '%');
      }
      function commit(value) {
        if (!Number.isFinite(value)) { input.value = slider.value; return; }
        value = Math.max(+slider.min, Math.min(+slider.max, value));
        var steps = Math.round((value - +slider.min) / +slider.step);
        slider.value = String(Number((+slider.min + steps * +slider.step).toFixed(6)));
        input.value = slider.value;
        slider.dispatchEvent(new Event('input', { bubbles: true })); refresh();
      }
      input.addEventListener('change', function () { commit(input.valueAsNumber); });
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(input.valueAsNumber); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); input.value = slider.value; input.blur(); }
      });
      minus.addEventListener('click', function () { commit(+slider.value - +slider.step); });
      plus.addEventListener('click', function () { commit(+slider.value + +slider.step); });
      slider.addEventListener('input', refresh); controls.push(refresh); refresh();
    });
    function updateTools() {
      var state = w.DOCK.state, focus = state.tucked.left && state.tucked.right;
      document.body.classList.toggle('workspace-focus', focus);
      tools.querySelectorAll('[data-workspace]').forEach(function (button) {
        var side = button.dataset.workspace;
        button.setAttribute('aria-pressed', String(side === 'scene' ? focus : !state.tucked[side]));
      });
      tools.querySelector('[data-workspace=scene] span').textContent = compact.matches ? '场景' : focus ? '恢复面板' : '专注场景';
    }
    tools.addEventListener('click', function (e) {
      var button = e.target.closest('button[data-workspace]'); if (!button) return;
      var side = button.dataset.workspace, state = w.DOCK.state;
      if (side === 'scene') {
        if (compact.matches) {
          w.DOCK.tuck('left'); w.DOCK.tuck('right'); previous = null;
        } else if (state.tucked.left && state.tucked.right) {
          var show = previous || { left: true, right: !compact.matches };
          ['left', 'right'].forEach(function (s) { if (show[s]) w.DOCK.untuck(s); }); previous = null;
        } else {
          previous = { left: !state.tucked.left, right: !state.tucked.right };
          w.DOCK.tuck('left'); w.DOCK.tuck('right');
        }
      } else {
        previous = null;
        if (state.tucked[side]) {
          if (compact.matches) w.DOCK.tuck(side === 'left' ? 'right' : 'left');
          w.DOCK.untuck(side);
        } else w.DOCK.tuck(side);
      }
      updateTools();
    });
    function resize() {
      previous = null;
      if (compact.matches) { w.DOCK.tuck('right'); w.DOCK.tuck('left'); }
      else { w.DOCK.untuck('left'); w.DOCK.untuck('right'); }
      updateTools();
    }
    w.addEventListener('dockchange', updateTools); compact.addEventListener('change', resize); resize();
    // Other simulation modules also update the original sliders programmatically.
    setInterval(function () { if (!document.hidden) controls.forEach(function (refresh) { refresh(); }); }, 200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
