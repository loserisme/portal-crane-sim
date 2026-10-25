/* =============================================================
 * stats.js — 访问统计与实训成绩上报（Supabase）
 *
 * 配置：把下面两个值填成你自己 Supabase 项目的
 *   SUPABASE_URL 形如 https://xxxxxxxx.supabase.co
 *   SUPABASE_KEY 是 Project Settings → API 里的 anon public key
 * 两者都会出现在前端，Supabase 的 anon key 本就是设计成公开的，
 * 靠 RLS 策略控制能做什么（见 docs/supabase-setup.sql）。
 * ============================================================= */
(function (w) {
  'use strict';

  /* ============ 配置区：只改这两行 ============ */
  var SUPABASE_URL = 'https://nzzrpytebouloppehxfy.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56enJweXRlYm91bG9wcGVoeGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MjI5MTAsImV4cCI6MjEwODQ5ODkxMH0.fa-KLGFnHKldHMlnhQOwX7X5sN50bnlZkAEu1tBClXY';
  /* =========================================== */

  var S = {
    sid: null,
    total: 0,
    online: 0,
    enabled: false,
    lastVisitAt: 0,
    onTotal: null,
  };

  var ONLINE_WINDOW = 5 * 60 * 1000;   // 5 分钟内有心跳算在线

  function ready() {
    return !!(SUPABASE_URL && SUPABASE_KEY && w.fetch);
  }

  function ensureSid() {
    var k = 'crane.sid';
    var v = null;
    try { v = w.localStorage.getItem(k); } catch (e) {}
    if (!v) {
      v = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { w.localStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=minimal',
    };
    if (opts.count) headers['Prefer'] = 'count=exact';
    if (opts.range) headers['Range'] = opts.range;

    return fetch(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body,
    });
  }

  /* ---------------- 上报 ---------------- */

  S.init = function () {
    if (!ready()) {
      console.info('[stats] 未配置 Supabase，统计功能关闭');
      return;
    }
    S.enabled = true;
    S.sid = ensureSid();

    /* 记录本次访问（走 RPC，由数据库从请求头取客户端 IP） */
    api('rpc/log_visit', {
      method: 'POST',
      body: JSON.stringify({
        p_sid: S.sid,
        p_ua: (navigator.userAgent || '').slice(0, 140),
        p_path: location.pathname,
      }),
    }).then(function (r) {
      if (r.ok) { S.refresh(); return; }
      /* RPC 还没建（未执行增量 SQL）时退回直接插入，仅少 IP 字段 */
      return api('visits', {
        method: 'POST',
        body: JSON.stringify({
          sid: S.sid,
          ua: (navigator.userAgent || '').slice(0, 140),
          path: location.pathname,
        }),
      }).then(function (r2) {
        if (!r2.ok) console.warn('[stats] visit insert', r2.status);
        S.refresh();
      });
    }).catch(function (e) { console.warn('[stats] visit', e.message); });

    /* 心跳：每 2 分钟一条，用于实时在线人数 */
    setInterval(function () {
      api('rpc/log_visit', {
        method: 'POST',
        body: JSON.stringify({ p_sid: S.sid, p_ua: 'heartbeat', p_path: location.pathname }),
      }).then(function (r) {
        if (r.ok) return;
        return api('visits', {
          method: 'POST',
          body: JSON.stringify({ sid: S.sid, ua: 'heartbeat', path: location.pathname }),
        });
      }).catch(function () {});
    }, 120000);
  };

  /* 功能使用埋点 */
  S.track = function (feature, detail) {
    if (!S.enabled) return;
    api('events', {
      method: 'POST',
      body: JSON.stringify({
        sid: S.sid,
        feature: String(feature).slice(0, 40),
        detail: detail ? String(detail).slice(0, 120) : null,
      }),
    }).catch(function () {});
  };

  /* 实训成绩上报 */
  S.reportScore = function (name, no, total, detail) {
    if (!S.enabled) return;
    api('scores', {
      method: 'POST',
      body: JSON.stringify({
        sid: S.sid,
        name: String(name || '').slice(0, 20),
        no: String(no || '').slice(0, 24),
        total: Number(total) || 0,
        detail: detail || null,
      }),
    }).catch(function () {});
  };

  /* ---------------- 读取 ---------------- */

  /* 总访问：用 Content-Range 拿精确条数，不拉数据 */
  S.refresh = function () {
    if (!S.enabled) return;

    api('visits?select=id', { count: true, range: '0-0' })
      .then(function (r) {
        var cr = r.headers.get('content-range') || '';
        var n = parseInt((cr.split('/')[1] || '0'), 10);
        if (isFinite(n)) {
          S.total = n;
          if (typeof S.onTotal === 'function') S.onTotal(n);
        }
      }).catch(function () {});

    /* 实时在线：最近 5 分钟出现过的 sid 去重 */
    var since = new Date(Date.now() - ONLINE_WINDOW).toISOString();
    api('visits?select=sid&created_at=gte.' + encodeURIComponent(since))
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        var set = {};
        (rows || []).forEach(function (x) { set[x.sid] = 1; });
        S.online = Object.keys(set).length;
      }).catch(function () {});
  };

  /* ---------------- 后台数据 ---------------- */

  S.fetchAll = function () {
    if (!ready()) return Promise.reject(new Error('未配置 Supabase'));
    var since = new Date(Date.now() - ONLINE_WINDOW).toISOString();

    return Promise.all([
      api('visits?select=id', { count: true, range: '0-0' }).then(function (r) {
        var cr = r.headers.get('content-range') || '';
        return parseInt((cr.split('/')[1] || '0'), 10) || 0;
      }),
      api('visits?select=sid&created_at=gte.' + encodeURIComponent(since)).then(function (r) { return r.json(); }),
      api('events?select=feature&limit=20000').then(function (r) { return r.json(); }),
      api('scores?select=*&order=created_at.desc&limit=500').then(function (r) { return r.json(); }),
      api('visits?select=ip,sid,ua,path,created_at&ua=neq.heartbeat&order=created_at.desc&limit=40')
        .then(function (r) {
          if (r.ok) return r.json();
          /* ip 列还没加（未执行增量 SQL）→ 退回不带 ip 的查询 */
          return api('visits?select=sid,ua,path,created_at&ua=neq.heartbeat&order=created_at.desc&limit=40')
            .then(function (r2) { return r2.json(); })
            .catch(function () { return []; });
        }),
    ]).then(function (res) {
      var set = {};
      (res[1] || []).forEach(function (x) { set[x.sid] = 1; });
      var cnt = {};
      (res[2] || []).forEach(function (x) { cnt[x.feature] = (cnt[x.feature] || 0) + 1; });
      return {
        totalVisits: res[0],
        online: Object.keys(set).length,
        events: cnt,
        eventTotal: (res[2] || []).length,
        scores: res[3] || [],
        recent: res[4] || [],
      };
    });
  };

  /* 配置齐了就能读，不需要先 init（后台页面用） */
  S.isEnabled = function () { return ready(); };
  S.cfg = function () { return { url: SUPABASE_URL, hasKey: !!SUPABASE_KEY }; };

  w.STATS = S;
})(window);
