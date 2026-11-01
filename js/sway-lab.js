/* =============================================================
 * sway-lab.js — 回转摆动抑制对比实验台
 *
 * 数据来源：
 *   1) js/sway-data.js 预设曲线（离线 Python 计算，保证首屏秒开）
 *   2) Pyodide 内实时计算（同站点“Python 控制”用同一内核）
 * ============================================================= */
(function (w) {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';

  var SERIES = [
    { key: 'manual', name: '手动操作', color: '#cf4a34' },
    { key: 'trap', name: '梯形加减速', color: '#d98a1f' },
    { key: 'scurve', name: 'S 型加减速', color: '#2b6fb0' },
    { key: 'opt', name: '优化 S 型', color: '#2e8b57' }
  ];

  var PANELS = [
    { field: 'theta', title: '(a) 回转角', unit: '°', zero: false },
    { field: 'omega', title: '(b) 回转角速度', unit: '°/s', zero: true },
    { field: 'alpha', title: '(c) 回转角加速度', unit: '°/s²', zero: true },
    { field: 'jerk', title: '(d) 加加速度', unit: '°/s³', zero: true },
    { field: 'sway', title: '(e) 抓斗切向摆角', unit: '°', zero: true, markers: true }
  ];

  var state = {
    data: null,
    visible: { manual: true, trap: true, scurve: true, opt: true },
    longRange: false,
    hoverT: null,
    R: 26, L: 14, zeta: 0.03,
    py: { ready: false, loading: false, failed: false, compute: null, tune: null }
  };

  var el = {};
  var canvases = [];

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }

  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(1);
    if (a >= 10) return v.toFixed(2);
    return v.toFixed(2);
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function niceNum(range, round) {
    var exp = Math.floor(Math.log(range) / Math.LN10);
    var f = range / Math.pow(10, exp);
    var nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  /* ---------------- 状态条 ---------------- */
  function setStatus(kind, text) {
    if (!el.status) return;
    el.status.className = 'status ' + kind;
    el.status.lastChild.textContent = text;
  }

  /* ---------------- 绘图 ---------------- */
  function seriesData(key, field) {
    var s = state.data.series[key];
    return s ? s[field] : null;
  }

  function drawPanel(cv, panel) {
    var dpr = Math.min(w.devicePixelRatio || 1, 2);
    var W = cv.parentNode.clientWidth || 720;
    var H = cv._h || 128;
    cv.style.height = H + 'px';
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var ml = 54, mr = 14, mt = 26, mb = 18;
    var x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;

    var t = state.data.series.opt.t;
    var xMax = state.longRange
      ? Math.max(40, 0)
      : Math.min(t[t.length - 1], Math.max.apply(null, SERIES.map(function (s) {
          return (state.data.series[s.key] || {}).T || 15;
        })) + 3.0);

    /* 值域 */
    var vmin = Infinity, vmax = -Infinity;
    SERIES.forEach(function (s) {
      if (!state.visible[s.key]) return;
      var arr = seriesData(s.key, panel.field);
      if (!arr) return;
      for (var i = 0; i < arr.length; i++) {
        if (t[i] > xMax) break;
        var v = arr[i];
        if (isFinite(v)) {
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
        }
      }
    });
    if (!isFinite(vmin)) { vmin = -1; vmax = 1; }
    if (vmax - vmin < 1e-6) { vmin -= 1; vmax += 1; }
    var pad = (vmax - vmin) * 0.12;
    vmin -= pad; vmax += pad;
    if (panel.zero) { if (vmin > 0) vmin = 0; if (vmax < 0) vmax = 0; }

    function X(tt) { return x0 + (tt / xMax) * (x1 - x0); }
    function Y(v) { return y1 - (v - vmin) / (vmax - vmin) * (y1 - y0); }

    /* 网格 + 纵轴刻度 */
    var step = niceNum((vmax - vmin) / 4, true);
    while ((y1 - y0) / Math.max(1, Math.round((vmax - vmin) / step)) < 20) step *= 2;
    var tick = Math.ceil(vmin / step) * step;
    ctx.font = '10.5px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    while (tick <= vmax + 1e-9) {
      var y = Y(tick);
      ctx.strokeStyle = Math.abs(tick) < 1e-9 ? 'rgba(24,36,52,.22)' : 'rgba(24,36,52,.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(y) + .5);
      ctx.lineTo(x1, Math.round(y) + .5);
      ctx.stroke();
      ctx.fillStyle = '#8a94a4';
      ctx.fillText(Math.abs(tick) >= 100 ? tick.toFixed(0) : tick.toFixed(Math.abs(step) < 1 ? 1 : 0), x0 - 7, y);
      tick += step;
    }

    /* 横轴刻度 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var xstep = niceNum(xMax / 6, true);
    for (var tx = 0; tx <= xMax + 1e-9; tx += xstep) {
      ctx.fillStyle = '#8a94a4';
      ctx.fillText(tx.toFixed(0), X(tx), y1 + 5);
      ctx.strokeStyle = 'rgba(24,36,52,.05)';
      ctx.beginPath();
      ctx.moveTo(Math.round(X(tx)) + .5, y0);
      ctx.lineTo(Math.round(X(tx)) + .5, y1);
      ctx.stroke();
    }

    /* 停止时刻标记（仅摆角图） */
    if (panel.markers) {
      SERIES.forEach(function (s) {
        if (!state.visible[s.key]) return;
        var T = (state.data.series[s.key] || {}).T;
        if (!T || T > xMax) return;
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = hexA(s.color, .55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(X(T)) + .5, y0);
        ctx.lineTo(Math.round(X(T)) + .5, y1);
        ctx.stroke();
        ctx.restore();
      });
    }

    /* 曲线 */
    SERIES.forEach(function (s) {
      if (!state.visible[s.key]) return;
      var arr = seriesData(s.key, panel.field);
      if (!arr) return;
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < arr.length; i++) {
        var tt = t[i];
        if (tt > xMax) break;
        var v = arr[i];
        if (!isFinite(v)) continue;
        var px = X(tt), py = Y(v);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.key === 'opt' ? 1.9 : 1.45;
      ctx.lineJoin = 'round';
      ctx.stroke();
    });

    /* 悬停十字线 */
    if (state.hoverT !== null) {
      var hx = X(state.hoverT);
      if (hx >= x0 && hx <= x1) {
        ctx.strokeStyle = 'rgba(24,36,52,.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(hx) + .5, y0);
        ctx.lineTo(Math.round(hx) + .5, y1);
        ctx.stroke();
        SERIES.forEach(function (s) {
          if (!state.visible[s.key]) return;
          var arr = seriesData(s.key, panel.field);
          if (!arr) return;
          var idx = Math.min(arr.length - 1, Math.round(state.hoverT / (t[1] - t[0])));
          var v = arr[idx];
          if (!isFinite(v)) return;
          ctx.beginPath();
          ctx.arc(hx, Y(v), 2.6, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }
    }

    /* 坐标轴 */
    ctx.strokeStyle = 'rgba(24,36,52,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + .5, y0);
    ctx.lineTo(Math.round(x0) + .5, y1);
    ctx.lineTo(x1, Math.round(y1) + .5);
    ctx.stroke();

    /* 标题 / 单位 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#33404f';
    ctx.font = '600 11.5px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillText(panel.title, x0 - 40, 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8a94a4';
    ctx.font = '10.5px ui-monospace, Consolas, monospace';
    ctx.fillText(panel.unit, x1, 12);
  }

  function renderCharts() {
    if (!state.data) return;
    panels.forEach(function (p, i) {
      if (canvases[i]) drawPanel(canvases[i], p);
    });
  }

  var panels = PANELS;

  function panelHeight() {
    var v = document.querySelector('.view');
    var avail = (v ? v.clientHeight : 820) - 116;   /* 扣掉工具栏、提示与间隙 */
    return Math.max(92, Math.min(172, Math.floor(avail / 5)));
  }

  function buildCharts() {
    var host = $('charts');
    host.innerHTML = '';
    canvases = [];
    panels.forEach(function (p) {
      var box = document.createElement('div');
      box.className = 'chart-box';
      var cv = document.createElement('canvas');
      cv._h = panelHeight();
      box.appendChild(cv);
      host.appendChild(box);
      canvases.push(cv);

      cv.addEventListener('mousemove', function (ev) {
        var rect = cv.getBoundingClientRect();
        var ml = 54, mr = 14;
        var W = rect.width;
        var xMax = state.longRange ? 40 : Math.min(60, maxT() + 3);
        var rel = (ev.clientX - rect.left - ml) / (W - mr - ml);
        state.hoverT = Math.max(0, Math.min(xMax, rel * xMax));
        updateReadout();
        renderCharts();
      });
      cv.addEventListener('mouseleave', function () {
        state.hoverT = null;
        updateReadout();
        renderCharts();
      });
    });
    renderCharts();
  }

  function maxT() {
    var m = 0;
    SERIES.forEach(function (s) {
      var T = (state.data.series[s.key] || {}).T || 0;
      if (T > m) m = T;
    });
    return m;
  }

  function updateReadout() {
    var box = $('readout');
    if (!box) return;
    if (state.hoverT === null) { box.innerHTML = '<span class="ro-hint">在曲线上移动鼠标可读取数值</span>'; return; }
    var t0 = state.data.series.opt.t;
    var idx = Math.min(t0.length - 1, Math.round(state.hoverT / (t0[1] - t0[0])));
    var html = '<span class="ro-t">t = ' + t0[idx].toFixed(2) + ' s</span>';
    SERIES.forEach(function (s) {
      if (!state.visible[s.key]) return;
      var v = (state.data.series[s.key] || {}).sway;
      if (!v) return;
      html += '<span class="ro-item"><i style="background:' + s.color + '"></i>' +
        s.name + ' <b>' + v[idx].toFixed(2) + '°</b></span>';
    });
    box.innerHTML = html;
  }

  /* ---------------- 指标表 ---------------- */
  function renderMetrics() {
    var body = $('m-body');
    if (!body) return;
    var keys = SERIES.map(function (s) { return s.key; });
    var rows = keys.map(function (k) { return state.data.metrics[k]; });

    var mins = {
      T: Math.min.apply(null, rows.map(function (r) { return r.T; })),
      peak: Math.min.apply(null, rows.map(function (r) { return r.peak; })),
      residual: Math.min.apply(null, rows.map(function (r) { return r.residual; })),
      decay: Math.min.apply(null, rows.map(function (r) { return r.decayResolved === false ? 999 : r.decay; })),
      jerk: Math.min.apply(null, rows.map(function (r) { return r.jerk; }))
    };

    var html = '';
    SERIES.forEach(function (s, i) {
      var m = rows[i];
      var decayTxt = m.decayResolved === false ? '≥' + m.decay.toFixed(0) : m.decay.toFixed(0);
      var cls = function (k, v) { return (Math.abs(v - mins[k]) < 1e-6 && isnanSafe(v)) ? ' class="best"' : ''; };
      var off = state.visible[s.key] ? '' : ' class="off"';
      html += '<tr' + off + '>' +
        '<td><span class="dot" style="background:' + s.color + '"></span>' + s.name + '</td>' +
        '<td>' + m.T.toFixed(1) + '</td>' +
        '<td' + cls('peak', m.peak) + '>' + m.peak.toFixed(2) + '</td>' +
        '<td' + cls('residual', m.residual) + '>' + m.residual.toFixed(2) + '</td>' +
        '<td' + cls('decay', m.decayResolved === false ? 999 : m.decay) + '>' + decayTxt + '</td>' +
        '<td' + cls('jerk', m.jerk) + '>' + fmt(m.jerk) + '</td>' +
        '</tr>';
    });
    body.innerHTML = html;
  }

  function isnanSafe(v) { return isFinite(v); }

  /* ---------------- 图例 ---------------- */
  function buildLegend() {
    var box = $('legend');
    box.innerHTML = '';
    SERIES.forEach(function (s) {
      var b = document.createElement('div');
      b.className = 'chip';
      b.dataset.key = s.key;
      b.innerHTML = '<i style="background:' + s.color + '"></i><span>' + s.name + '</span>';
      b.addEventListener('click', function () {
        state.visible[s.key] = !state.visible[s.key];
        b.classList.toggle('off', !state.visible[s.key]);
        renderCharts();
        renderMetrics();
        updateReadout();
      });
      box.appendChild(b);
    });

    var sp = document.createElement('div');
    sp.className = 'spacer';
    box.appendChild(sp);

    var ro = document.createElement('div');
    ro.id = 'readout';
    ro.className = 'readout';
    ro.innerHTML = '<span class="ro-hint">在曲线上移动鼠标可读取数值</span>';
    box.appendChild(ro);

    var lab = document.createElement('label');
    lab.className = 'switch';
    lab.innerHTML = '<input type="checkbox" id="sw-long"' + (state.longRange ? ' checked' : '') +
      '> 显示停止后衰减（0–40 s）';
    lab.querySelector('input').addEventListener('change', function (e) {
      state.longRange = e.target.checked;
      renderCharts();
    });
    box.appendChild(lab);
  }

  /* ---------------- 数据应用 ---------------- */
  function applyData(d) {
    state.data = d;
    if (d.params) {
      state.R = d.params.R; state.L = d.params.L; state.zeta = d.params.zeta;
      $('p-r').value = d.params.R; $('p-l').value = d.params.L; $('p-z').value = d.params.zeta;
      $('p-r-v').textContent = d.params.R.toFixed(1);
      $('p-l-v').textContent = d.params.L.toFixed(1);
      $('p-z-v').textContent = d.params.zeta.toFixed(3);
      $('h-period').textContent = d.params.period.toFixed(2);
      $('h-freq').textContent = (1 / d.params.period).toFixed(3);
    }
    renderCharts();
    renderMetrics();
    updateReadout();
  }

  /* ---------------- Pyodide ---------------- */
  function loadPython() {
    if (state.py.loading || state.py.ready) return;
    state.py.loading = true;
    setStatus('wait', 'Python 内核加载中…');

    function boot() {
      w.loadPyodide({ indexURL: CDN }).then(function (py) {
        py.runPython(w.SWAY_PY_SRC);
        state.py.compute = py.globals.get('compute');
        state.py.tune = py.globals.get('tune');
        state.py.ready = true;
        state.py.loading = false;
        ['p-r', 'p-l', 'p-z'].forEach(function (id) { $(id).disabled = false; });
        $('btn-tune').disabled = false;
        if (readQuery().R || readQuery().L || readQuery().z) recompute(true);
        setStatus('ok', 'Python 就绪（Pyodide ' + (py.version || '') + '）');
      }).catch(function (e) {
        state.py.failed = true;
        state.py.loading = false;
        setStatus('fail', 'Python 内核加载失败，显示离线预设曲线');
        console.warn('[sway-lab] pyodide failed', e);
      });
    }

    if (w.loadPyodide) { boot(); return; }

    var s = document.createElement('script');
    s.src = CDN + 'pyodide.js';
    s.onload = boot;
    s.onerror = function () {
      state.py.failed = true;
      state.py.loading = false;
      setStatus('fail', '无法访问 Python 内核（CDN），显示离线预设曲线');
    };
    document.head.appendChild(s);

    setTimeout(function () {
      if (!state.py.ready && !state.py.failed) {
        setStatus('wait', 'Python 内核仍在加载…（可先用离线曲线）');
      }
    }, 12000);
  }

  var pending = null;

  function recompute(immediate) {
    if (!state.py.ready) return;
    clearTimeout(pending);
    var run = function () {
      setStatus('busy', 'Python 计算中…');
      setTimeout(function () {
        var t0 = performance.now();
        try {
          var json = state.py.compute(state.R, state.L, state.zeta);
          applyData(JSON.parse(json));
          setStatus('ok', 'Python 就绪 · 计算 ' + Math.round(performance.now() - t0) + ' ms');
        } catch (e) {
          console.error(e);
          setStatus('fail', '计算失败：' + (e && e.message ? e.message : e));
        }
      }, 30);
    };
    if (immediate) run(); else pending = setTimeout(run, 320);
  }

  /* ---------------- 交互 ---------------- */
  function bindControls() {
    [['p-r', 'R', 'p-r-v', 1], ['p-l', 'L', 'p-l-v', 1], ['p-z', 'zeta', 'p-z-v', 3]]
      .forEach(function (cfg) {
        var inp = $(cfg[0]);
        inp.addEventListener('input', function () {
          var v = parseFloat(inp.value);
          state[cfg[1]] = v;
          $(cfg[2]).textContent = v.toFixed(cfg[3]);
          if (cfg[1] === 'L') {
            var p = 2 * Math.PI / Math.sqrt(9.81 / v);
            $('h-period').textContent = p.toFixed(2);
            $('h-freq').textContent = (1 / p).toFixed(3);
          }
          recompute(false);
        });
      });

    $('btn-reset').addEventListener('click', function () {
      state.R = 26; state.L = 14; state.zeta = 0.03;
      $('p-r').value = 26; $('p-l').value = 14; $('p-z').value = 0.03;
      $('p-r-v').textContent = '26.0'; $('p-l-v').textContent = '14.0'; $('p-z-v').textContent = '0.030';
      if (state.py.ready) {
        try { state.py.compute(26, 14, 0.03); } catch (e) {}
      }
      recompute(true);
    });

    $('btn-tune').addEventListener('click', function () {
      if (!state.py.ready) return;
      var btn = this;
      btn.disabled = true;
      setStatus('busy', '差分进化整定中…');
      setTimeout(function () {
        try {
          var json = state.py.tune(state.R, state.L, state.zeta);
          var p = JSON.parse(json);
          setStatus('ok', '整定完成 · T=' + p.T.toFixed(2) + ' s');
          applyData(JSON.parse(state.py.compute(state.R, state.L, state.zeta)));
        } catch (e) {
          console.error(e);
          setStatus('fail', '整定失败：' + (e && e.message ? e.message : e));
        }
        btn.disabled = false;
      }, 40);
    });

    $('btn-csv').addEventListener('click', exportCsv);

    var rt;
    w.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        canvases.forEach(function (c) { c._h = panelHeight(); });
        renderCharts();
      }, 160);
    });
  }

  function exportCsv() {
    if (!state.data) return;
    var lines = ['方案,t/s,回转角/°,角速度/(°/s),角加速度/(°/s²),加加速度/(°/s³),切向摆角/°'];
    SERIES.forEach(function (s) {
      var d = state.data.series[s.key];
      for (var i = 0; i < d.t.length; i++) {
        lines.push([s.name, d.t[i], d.theta[i], d.omega[i], d.alpha[i], d.jerk[i], d.sway[i]].join(','));
      }
    });
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sway_compare_R' + state.R + '_L' + state.L + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------------- 启动 ---------------- */
  function readQuery() {
    var q = {};
    (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    return q;
  }

  function applyQuery() {
    var q = readQuery();
    var hit = false;
    if (q.R) { state.R = Math.max(18, Math.min(32, parseFloat(q.R))); hit = true; }
    if (q.L) { state.L = Math.max(6, Math.min(26, parseFloat(q.L))); hit = true; }
    if (q.z) { state.zeta = Math.max(0.005, Math.min(0.12, parseFloat(q.z))); hit = true; }
    if (!hit) return false;
    $('p-r').value = state.R; $('p-l').value = state.L; $('p-z').value = state.zeta;
    $('p-r-v').textContent = state.R.toFixed(1);
    $('p-l-v').textContent = state.L.toFixed(1);
    $('p-z-v').textContent = state.zeta.toFixed(3);
    var per = 2 * Math.PI / Math.sqrt(9.81 / state.L);
    $('h-period').textContent = per.toFixed(2);
    $('h-freq').textContent = (1 / per).toFixed(3);
    return true;
  }

  function boot() {
    el.status = $('py-status');
    if (!w.SWAY_PRESET) {
      setStatus('fail', '缺少预设数据 js/sway-data.js');
      return;
    }
    buildLegend();
    buildCharts();
    applyData(w.SWAY_PRESET);
    renderCharts();
    renderMetrics();
    bindControls();
    applyQuery();
    loadPython();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  w.SWAY_LAB = state;
})(window);
