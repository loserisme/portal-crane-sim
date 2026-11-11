/* 管理看板：沿用原管理入口，数据库只读查询，按页加载与导出。 */
(function () {
  'use strict';
  var USER = 'njitzdh', PASS = 'njitzdh', KEY = 'crane.admin';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return n == null ? '—' : Number(n).toLocaleString('zh-CN'); };
  var dateText = function (s) { var d = new Date(s); return s && Number.isFinite(+d) ? d.toLocaleString('zh-CN', { hour12: false }) : '—'; };
  var title = { overview: '统计概览', visits: '访问记录', scores: '实训成绩' };
  var features = { script: '动作编程', python: '算法设计', ai: 'AI 控制', ai_eval: 'AI 评估', train: '实训面板', report: '生成报告', hover: '结构悬停', docx: '实训 Word 导出', comp: '综合实验', comp_docx: '综合实验 Word 导出' };
  var state = { logged: false, tab: 'overview', from: null, to: null, job: null, timer: null, ip: true };
  var tables = { visits: { rows: [], page: 0, size: 20, query: '', total: null, valid: false }, scores: { rows: [], page: 0, size: 20, query: '', total: null, valid: false } };
  var geos = new Map(), geoJobs = new Map();

  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function empty(message) { return '<div class="empty"><strong>暂无数据</strong>' + esc(message) + '</div>'; }
  function notice(message) { $('global-message').textContent = message; $('global-message').classList.toggle('hidden', !message); }
  function cancel() { if (state.job) { state.job.controller.abort(); clearTimeout(state.job.timeout); state.job = null; } }
  function params(select, limit, offset, order, withDate) {
    var p = new URLSearchParams({ select: select, limit: limit, offset: offset || 0, order: order || 'created_at.desc,id.desc' });
    if (withDate !== false) {
      if (state.from) p.append('created_at', 'gte.' + state.from.toISOString());
      if (state.to) p.append('created_at', 'lt.' + state.to.toISOString());
    }
    return p;
  }
  function visitsOnly(p) { p.append('or', '(ua.is.null,ua.neq.heartbeat)'); return p; }
  function summaryNote(result, noun) {
    return result.total !== null && result.total <= result.rows.length ? '所选时段全部 ' + fmt(result.total) + ' 条' + noun
      : '基于最近 ' + fmt(result.rows.length) + ' 条' + noun + '样本，不代表全量分布';
  }
  function setBusy(busy) {
    $('refresh').disabled = busy; $('refresh').textContent = busy ? '读取中…' : '刷新数据';
    if (state.tab !== 'overview') {
      var t = tables[state.tab];
      $('export-' + state.tab).disabled = busy || !t.valid || !t.rows.length;
      $('prev-' + state.tab).disabled = busy || !t.valid || t.page === 0;
      $('next-' + state.tab).disabled = busy || !t.valid || (t.total == null ? t.rows.length < t.size : (t.page + 1) * t.size >= t.total);
    }
    $('view-' + state.tab).setAttribute('aria-busy', String(busy));
  }
  async function refresh() {
    if (!state.logged) return;
    cancel(); notice('');
    var job = { controller: new AbortController(), tab: state.tab };
    state.job = job; job.timeout = setTimeout(function () { job.controller.abort(); }, 20000);
    setBusy(true); $('meta').textContent = '正在读取' + title[job.tab] + '…';
    if (job.tab !== 'overview') $('message-' + job.tab).textContent = '正在读取，请稍候…';
    try {
      if (!window.STATS || !STATS.isEnabled()) throw new Error('统计服务尚未配置');
      if (job.tab === 'overview') {
        var result = await Promise.all([
          STATS.adminQuery('visits', visitsOnly(params('created_at', 1000)), job.controller.signal),
          STATS.adminQuery('events', params('feature', 1000), job.controller.signal),
          STATS.adminQuery('scores', params('id', 1), job.controller.signal),
          STATS.adminQuery('visits', new URLSearchParams({ select: 'sid', created_at: 'gte.' + new Date(Date.now() - 300000).toISOString(), order: 'created_at.desc,id.desc', limit: 1000 }), job.controller.signal)
        ]);
        if (state.job !== job || !state.logged) return;
        renderOverview(result);
      } else {
        var data;
        try { data = await queryTable(job.tab, job.controller.signal); }
        catch (e) {
          if (job.tab !== 'visits' || e.code !== '42703' || !state.ip) throw e;
          state.ip = false; data = await queryTable(job.tab, job.controller.signal);
        }
        if (state.job !== job || !state.logged) return;
        var t = tables[job.tab];
        // 删除数据或筛选变化后页码可能越界，回到第一页重新读取。
        if (!data.rows.length && t.page && data.total !== null && t.page * t.size >= data.total) { t.page = 0; data = await queryTable(job.tab, job.controller.signal); }
        if (state.job !== job || !state.logged) return;
        t.rows = data.rows; t.total = data.total; t.valid = true; renderTable(job.tab);
        $('message-' + job.tab).classList.remove('error');
        $('message-' + job.tab).textContent = job.tab === 'visits' && !state.ip ? 'IP 字段尚未配置，当前可搜索页面与设备。' : '数据已更新 · 查询应用于全部符合条件的记录';
      }
      $('meta').textContent = title[job.tab] + '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    } catch (e) {
      if (state.job !== job || !state.logged) return;
      var message = e.name === 'AbortError' ? '请求超时，请重试' : e.message || '网络连接失败，请重试';
      notice(message + '。页面保留上次成功读取的数据。'); $('meta').textContent = '本次更新未完成';
      if (job.tab !== 'overview') { tables[job.tab].valid = false; $('message-' + job.tab).textContent = message + '；以下如有记录，为上次读取结果。'; $('message-' + job.tab).classList.add('error'); }
      job.controller.abort();
    } finally {
      clearTimeout(job.timeout);
      if (state.job === job) { state.job = null; setBusy(false); }
    }
  }

  function renderOverview(r) {
    $('k-total').textContent = fmt(r[0].total); $('k-events').textContent = fmt(r[1].total); $('k-scores').textContent = fmt(r[2].total);
    var online = new Set(r[3].rows.map(function (x) { return x.sid; }).filter(Boolean)).size;
    var partial = r[3].total === null || r[3].total > r[3].rows.length;
    $('k-online').textContent = (partial ? '≥ ' : '') + fmt(online);
    $('k-online').title = partial ? '活跃记录超过当前读取量，此处为在线标识数下限' : '最近 5 分钟出现过的浏览器标识数';
    var counts = new Map(); r[1].rows.forEach(function (x) { var key = String(x.feature || '未命名功能'); counts.set(key, (counts.get(key) || 0) + 1); });
    var entries = Array.from(counts).sort(function (a, b) { return b[1] - a[1]; });
    $('feat-note').textContent = summaryNote(r[1], '事件');
    $('feat').innerHTML = entries.length ? entries.map(function (x) { var pct = 100 * x[1] / r[1].rows.length; return '<div class="frow"><div class="frow-head"><span>' + esc(features[x[0]] || x[0]) + '</span><span>' + fmt(x[1]) + ' 次 · ' + pct.toFixed(1) + '%</span></div><div class="track"><i style="width:' + pct.toFixed(2) + '%"></i></div></div>'; }).join('') : empty('所选时段没有功能使用记录');
    renderTrend(r[0]);
  }
  function renderTrend(result) {
    var last = state.to ? new Date(+state.to - 1) : new Date(); last.setHours(0, 0, 0, 0);
    var first = state.from ? new Date(state.from) : new Date(last.getFullYear(), last.getMonth(), last.getDate() - 13);
    var cap = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 30);
    if (first < cap) first = cap;
    var days = [], counts = new Map();
    for (var d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) { var k = dayKey(d); days.push(k); counts.set(k, 0); }
    result.rows.forEach(function (r) { var key = dayKey(new Date(r.created_at)); if (counts.has(key)) counts.set(key, counts.get(key) + 1); });
    $('trend-note').textContent = summaryNote(result, '访问') + ' · 展示 ' + days.length + ' 天（本地时区）';
    if (!result.rows.length) { $('trend').innerHTML = empty('所选时段没有页面访问'); return; }
    var max = Math.max(1, ...Array.from(counts.values())), step = 500 / days.length;
    var bars = days.map(function (k, i) {
      var value = counts.get(k), height = value / max * 150, x = 38 + step * i, label = k.slice(5);
      return '<rect x="' + x.toFixed(1) + '" y="' + (174 - height).toFixed(1) + '" width="' + Math.max(3, step - 7).toFixed(1) + '" height="' + height.toFixed(1) + '" rx="3"><title>' + k + '：' + value + ' 次访问</title></rect>' + (i % Math.ceil(days.length / 7) === 0 || i === days.length - 1 ? '<text x="' + (x + step / 2 - 3).toFixed(1) + '" y="195" text-anchor="middle">' + label + '</text>' : '');
    }).join('');
    $('trend').innerHTML = '<svg viewBox="0 0 550 210" role="img" aria-label="每日访问分布"><title>' + days.map(function (k) { return k + '：' + counts.get(k) + '次'; }).join('；') + '</title><line class="baseline" x1="32" x2="542" y1="24" y2="24"/><line class="baseline" x1="32" x2="542" y1="99" y2="99"/><line class="baseline" x1="32" x2="542" y1="174" y2="174"/><text x="2" y="28">' + max + '</text><text x="2" y="178">0</text>' + bars + '</svg>';
  }

  function queryTable(kind, signal) {
    var t = tables[kind];
    var select = kind === 'scores' ? 'id,name,no,total,detail,created_at' : 'id,sid,ua,path,created_at' + (state.ip ? ',ip' : '');
    var order = kind === 'scores' ? $('sort-scores').value + '.nullslast,id.desc' : 'created_at.desc,id.desc';
    var p = params(select, t.size, t.page * t.size, order);
    if (kind === 'visits') visitsOnly(p);
    if (t.query) {
      var fields = kind === 'scores' ? ['name', 'no'] : (state.ip ? ['ip', 'path', 'ua'] : ['path', 'ua']);
      var pattern = JSON.stringify('*' + t.query + '*');
      p.append('and', '(or(' + fields.map(function (field) { return field + '.ilike.' + pattern; }).join(',') + '))');
    }
    return STATS.adminQuery(kind, p, signal);
  }
  function scoreInfo(row) {
    var detail = Array.isArray(row.detail) ? row.detail.filter(function (x) { return x && typeof x === 'object'; }) : [];
    return { detail: detail, max: detail.length ? detail.length * 100 : null, done: detail.filter(function (x) { return x.state === 'done'; }).length, total: Number.isFinite(Number(row.total)) && row.total !== null ? Number(row.total) : null };
  }
  function device(ua) { return /Mobile|Android|iPhone|iPad/i.test(ua || '') ? '移动设备' : /Windows/i.test(ua || '') ? 'Windows' : /Mac/i.test(ua || '') ? 'macOS' : /Linux/i.test(ua || '') ? 'Linux' : '其他 / 未记录'; }
  function renderTable(kind) {
    var t = tables[kind], head, rows;
    if (kind === 'visits') {
      head = '<th>访问时间</th><th>IP 地址 / 归属地</th><th>设备</th><th>访问页面</th>';
      rows = t.rows.map(function (r) {
        var geo = r.ip ? geos.get(r.ip) : null;
        return '<tr><td class="mono">' + esc(dateText(r.created_at)) + '</td><td><span class="mono">' + esc(r.ip || '未记录') + '</span><br>' + (geo ? '<span class="muted">' + esc(geo) + '</span>' : r.ip ? '<button data-geo="' + esc(r.ip) + '">' + (geoJobs.has(r.ip) ? '查询中…' : '查询归属地') + '</button>' : '') + '</td><td title="' + esc(r.ua || '') + '"><span class="badge">' + device(r.ua) + '</span></td><td class="mono">' + esc(r.path || '—') + '</td></tr>';
      }).join('');
    } else {
      head = '<th>姓名 / 学号</th><th>总分 / 满分</th><th>任务完成</th><th>提交时间</th><th>操作</th>';
      rows = t.rows.map(function (r, i) { var s = scoreInfo(r); return '<tr><td>' + esc(r.name || '未填写') + '<br><span class="mono">' + esc(r.no || '未填写学号') + '</span></td><td><span class="score">' + fmt(s.total) + '</span> <span class="muted">/ ' + (s.max || '未知') + '</span></td><td>' + (s.max ? s.done + ' / ' + s.detail.length + ' 项' : '无任务明细') + '</td><td class="mono">' + esc(dateText(r.created_at)) + '</td><td><button data-detail="' + i + '">查看详情</button></td></tr>'; }).join('');
    }
    $(kind === 'visits' ? 'visitbox' : 'scorebox').innerHTML = rows ? '<table><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>' : empty(t.query ? '没有匹配的记录，试试更换关键词或时间范围' : '所选时段没有记录');
    $('count-' + kind).textContent = t.total === null ? '共计暂不可用 · 本页 ' + t.rows.length + ' 条' : '共 ' + fmt(t.total) + ' 条 · 当前 ' + (t.rows.length ? t.page * t.size + 1 : 0) + '–' + (t.page * t.size + t.rows.length) + ' 条';
    $('page-' + kind).textContent = (t.page + 1) + ' / ' + (t.total === null ? '?' : Math.max(1, Math.ceil(t.total / t.size)));
  }
  async function lookupGeo(ip) {
    if (geoJobs.has(ip)) return;
    if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1') { geos.set(ip, '内网地址'); renderTable('visits'); return; }
    var ctl = new AbortController(); geoJobs.set(ip, ctl); renderTable('visits');
    var timeout = setTimeout(function () { ctl.abort(); }, 12000);
    try {
      var response = await fetch('https://ipwho.is/' + encodeURIComponent(ip) + '?lang=zh-CN', { signal: ctl.signal });
      if (!response.ok) throw Error(); var data = await response.json();
      if (!data.success) throw Error();
      geos.set(ip, [data.country, data.region, data.city].filter(Boolean).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).join(' ') || '未提供位置');
    } catch (e) { if (state.logged) notice('归属地暂时查询失败，可点击按钮重试。'); }
    finally { clearTimeout(timeout); geoJobs.delete(ip); if (state.logged && state.tab === 'visits') renderTable('visits'); }
  }
  function showDetail(index) {
    var r = tables.scores.rows[index]; if (!r) return; var s = scoreInfo(r);
    $('detail-title').textContent = (r.name || '未填写姓名') + ' · ' + (r.no || '未填写学号');
    $('detail-body').innerHTML = '<div class="detail-summary"><strong>总分 ' + fmt(s.total) + ' / ' + (s.max || '未知') + '</strong><span>完成 ' + s.done + ' / ' + s.detail.length + ' 项</span></div><p class="muted">提交时间：' + esc(dateText(r.created_at)) + '</p>' + (s.detail.length ? '<div class="table-scroll"><table><thead><tr><th>任务</th><th>得分</th><th>状态</th></tr></thead><tbody>' + s.detail.map(function (x) { return '<tr><td>' + esc(x.title || x.id || '未命名任务') + '</td><td>' + esc(x.score == null ? '—' : x.score) + ' / 100</td><td>' + esc({ done: '已完成', doing: '进行中', idle: '未开始' }[x.state] || '未完成') + '</td></tr>'; }).join('') + '</tbody></table></div>' : empty('这条提交未附带任务明细，因此不推断满分'));
    $('score-dialog').showModal();
  }
  function exportPage(kind) {
    var t = tables[kind]; if (!t.valid || !t.rows.length) return;
    var data = kind === 'visits' ? [['访问时间', 'IP 地址', '设备', '页面']].concat(t.rows.map(function (r) { return [dateText(r.created_at), r.ip || '', device(r.ua), r.path || '']; })) : [['姓名', '学号', '总分', '满分', '完成任务数', '总任务数', '提交时间']].concat(t.rows.map(function (r) { var s = scoreInfo(r); return [r.name || '', r.no || '', s.total, s.max, s.done, s.detail.length, dateText(r.created_at)]; }));
    var csv = data.map(function (row) { return row.map(function (cell) { var value = String(cell == null ? '' : cell); if (/^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value)) value = "'" + value; return '"' + value.replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    var url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); var a = document.createElement('a'); a.href = url; a.download = title[kind] + '_' + dayKey(new Date()) + '_第' + (t.page + 1) + '页.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function applyPeriod() {
    var mode = $('period').value, now = new Date(), from = null, to = null;
    $('custom-dates').classList.toggle('hidden', mode !== 'custom');
    if (mode === 'custom') {
      if (!$('date-from').value || !$('date-to').value) { notice('请选择起始和结束日期'); return false; }
      from = new Date($('date-from').value + 'T00:00:00'); to = new Date($('date-to').value + 'T00:00:00'); to.setDate(to.getDate() + 1);
      if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to) { notice('结束日期不能早于起始日期'); return false; }
    } else if (mode !== 'all') { from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (mode === 'today' ? 0 : Number(mode) - 1)); to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); }
    state.from = from; state.to = to;
    $('range-label').textContent = from ? dayKey(from) + ' — ' + dayKey(new Date(+to - 1)) + ' · 本地时区' : '全部历史记录';
    Object.keys(tables).forEach(function (k) { tables[k].page = 0; tables[k].valid = false; });
    notice(''); return true;
  }
  function navigate(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-tab]').forEach(function (b) { var selected = b.dataset.tab === tab; b.classList.toggle('active', selected); if (selected) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    Object.keys(title).forEach(function (k) { $('view-' + k).classList.toggle('hidden', k !== tab); });
    $('page-title').textContent = title[tab]; refresh();
  }
  function login() {
    state.logged = true; $('login').classList.add('hidden'); $('dash').classList.remove('hidden'); $('p').value = ''; $('p').type = 'password'; $('show-password').textContent = '显示'; $('show-password').setAttribute('aria-pressed', 'false');
    applyPeriod(); navigate('overview');
  }
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault(); if ($('u').value.trim() !== USER || $('p').value !== PASS) { $('err').classList.remove('hidden'); return; }
    try { sessionStorage.setItem(KEY, '1'); } catch (ignore) {} $('err').classList.add('hidden'); login();
  });
  $('show-password').addEventListener('click', function () { var visible = $('p').type === 'password'; $('p').type = visible ? 'text' : 'password'; this.textContent = visible ? '隐藏' : '显示'; this.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码'); this.setAttribute('aria-pressed', String(visible)); });
  $('logout').addEventListener('click', function () {
    state.logged = false; cancel(); clearInterval(state.timer); state.timer = null; $('auto-refresh').checked = false;
    geoJobs.forEach(function (ctl) { ctl.abort(); }); geoJobs.clear(); geos.clear();
    try { sessionStorage.removeItem(KEY); } catch (ignore) {}
    $('score-dialog').close(); $('dash').classList.add('hidden'); $('login').classList.remove('hidden'); $('p').value = ''; $('u').focus();
    Object.keys(tables).forEach(function (k) { tables[k].rows = []; tables[k].valid = false; tables[k].total = null; $(k === 'visits' ? 'visitbox' : 'scorebox').textContent = ''; });
    ['k-total', 'k-online', 'k-events', 'k-scores', 'feat', 'trend', 'detail-body'].forEach(function (id) { $(id).textContent = '—'; });
  });
  document.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { navigate(b.dataset.tab); }); });
  $('refresh').addEventListener('click', refresh);
  $('period').addEventListener('change', function () { if (applyPeriod()) refresh(); });
  $('filters').addEventListener('submit', function (e) { e.preventDefault(); if (applyPeriod()) refresh(); });
  $('auto-refresh').addEventListener('change', function () { clearInterval(state.timer); state.timer = this.checked ? setInterval(function () { if (state.logged && !document.hidden && !state.job && !$('score-dialog').open) refresh(); }, 60000) : null; });
  Object.keys(tables).forEach(function (kind) {
    $('search-' + kind).addEventListener('submit', function (e) { e.preventDefault(); tables[kind].query = $('query-' + kind).value.trim(); tables[kind].page = 0; refresh(); });
    $('clear-' + kind).addEventListener('click', function () { $('query-' + kind).value = ''; tables[kind].query = ''; tables[kind].page = 0; refresh(); });
    $('size-' + kind).addEventListener('change', function () { tables[kind].size = Number(this.value); tables[kind].page = 0; refresh(); });
    $('prev-' + kind).addEventListener('click', function () { if (tables[kind].page > 0) { tables[kind].page--; refresh(); } });
    $('next-' + kind).addEventListener('click', function () { tables[kind].page++; refresh(); });
    $('export-' + kind).addEventListener('click', function () { exportPage(kind); });
  });
  $('sort-scores').addEventListener('change', function () { tables.scores.page = 0; refresh(); });
  $('scorebox').addEventListener('click', function (e) { var b = e.target.closest('[data-detail]'); if (b) showDetail(Number(b.dataset.detail)); });
  $('visitbox').addEventListener('click', function (e) { var b = e.target.closest('[data-geo]'); if (b) lookupGeo(b.dataset.geo); });
  $('close-detail').addEventListener('click', function () { $('score-dialog').close(); });
  $('score-dialog').addEventListener('click', function (e) { if (e.target === this) { var r = this.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.close(); } });
  $('date-to').value = dayKey(new Date()); var week = new Date(); week.setDate(week.getDate() - 6); $('date-from').value = dayKey(week);
  try { if (sessionStorage.getItem(KEY) === '1') login(); } catch (ignore) {}
})();
