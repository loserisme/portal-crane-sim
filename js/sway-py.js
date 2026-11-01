/* =============================================================
 * sway-py.js — 摆动抑制对比实验的浏览器内 Python 源码（Pyodide）
 *
 * 与 analysis/sway_suppression.py 同一套模型：
 *   回转坐标系下的球面摆（含科氏、离心、欧拉三项）+ RK4 积分
 * 输出 4 条回转规划（手动 / 梯形 / 经验 S / DE 整定 S）的
 * 角度、角速度、角加速度、加加速度与抓斗切向摆角。
 *
 * 纯 Python 实现（仅 math / json），无需 numpy，加载快、体积小。
 * ============================================================= */
(function (w) {
  'use strict';

  w.SWAY_PY_SRC = String.raw`
import json, math, random

G = 9.81
THETA = math.pi / 2.0
V_MAX = 1.6 * 2.0 * math.pi / 60.0      # 额定回转 1.6 r/min
A_REF, J_REF = 0.035, 0.100             # 经验 S 型参数

# DE 离线整定结果（标称工况 R=26, L=14, zeta=0.03）
OPT = {"a1": 0.026435, "j1": 0.209389, "a2": 0.023641, "j2": 0.209814,
       "T": 16.311538}


def _sramp(v, a, j):
    """加速段 jerk 分段 [(duration, jerk)]。"""
    tj = a / j
    ta = v / a
    if ta < tj:
        t1 = math.sqrt(v / j)
        return [(t1, j), (t1, -j)]
    return [(tj, j), (ta - tj, 0.0), (tj, -j)]


def _s_curve(v, a1, j1, a2, j2, theta, dt=0.004):
    segs = _sramp(v, a1, j1) + [(0.0, 0.0)] + [(d, -j) for d, j in _sramp(v, a2, j2)]
    t_acc = sum(d for d, _ in _sramp(v, a1, j1))
    t_dec = sum(d for d, _ in _sramp(v, a2, j2))
    d_const = theta - v * t_acc / 2.0 - v * t_dec / 2.0
    if d_const < -1e-9:
        return None
    t_const = d_const / v
    segs = _sramp(v, a1, j1) + [(t_const, 0.0)] + [(d, -j) for d, j in _sramp(v, a2, j2)]
    T = t_acc + t_const + t_dec

    ts, ths, oms, als, jks = [0.0], [0.0], [0.0], [0.0], [segs[0][1]]
    th = om = al = tt = 0.0
    for dur, jk in segs:
        n = max(int(round(dur / dt)), 1)
        h = dur / n
        for _ in range(n):
            th += om * h + 0.5 * al * h * h + jk * h ** 3 / 6.0
            om += al * h + 0.5 * jk * h * h
            al += jk * h
            tt += h
            ts.append(tt); ths.append(th); oms.append(om); als.append(al); jks.append(jk)
    return ts, ths, oms, als, jks, T


def _trapezoid(v, a, theta, dt=0.004):
    t_acc = v / a
    T = theta / v + t_acc
    n = int(round(T / dt)) + 1
    ts = [i * dt for i in range(n)]
    als = [a if t <= t_acc else (-a if t >= T - t_acc else 0.0) for t in ts]
    oms = [0.0] * n
    for i in range(1, n):
        oms[i] = oms[i - 1] + als[i - 1] * dt
    s = sum(oms) * dt
    k = theta / s if s else 1.0
    oms = [o * k for o in oms]
    als = [v * k for v in als]
    ths = []
    acc = 0.0
    for o in oms:
        ths.append(acc)
        acc += o * dt
    jks = [0.0] * n
    for i in range(1, n):
        jks[i] = (als[i] - als[i - 1]) / dt
    return ts, ths, oms, als, jks, T


def _manual(R, L, zeta, dt=0.004):
    tau, tau_slew = 0.30, 0.12
    knots = [(0.0, 0.0), (1.0, 0.45), (3.6, 0.78), (6.6, 1.00),
             (10.2, 0.72), (11.8, 0.45), (12.6, 0.0)]
    t_stop = knots[-1][0]
    T = t_stop + 3 * tau + 3 * tau_slew
    n = int(round(T / dt)) + 1
    ts = [i * dt for i in range(n)]

    random.seed(11)
    cmd = [0.0] * n
    ki = 1
    for i in range(n):
        tq = ts[i]
        while ki < len(knots) and tq >= knots[ki][0]:
            ki += 1
        lv = knots[ki - 1][1] if tq >= knots[0][0] else 0.0
        cmd[i] = lv * V_MAX

    # 操作抖动：低通白噪声（约 ±1.2% 额定速度）
    noise = [random.gauss(0.0, 0.012 * V_MAX) for _ in range(n)]
    win = max(int(0.15 / dt), 3)
    sm = [0.0] * n
    run = 0.0
    for i in range(n):
        run += noise[i]
        if i >= win:
            run -= noise[i - win]
        sm[i] = run / win
    for i in range(n):
        cmd[i] += sm[i]

    slew = [0.0] * n
    for i in range(n - 1):
        slew[i + 1] = slew[i] + dt / tau_slew * (cmd[i] - slew[i])

    oms = [0.0] * n
    als = [0.0] * n
    for i in range(n - 1):
        als[i] = (slew[i] - oms[i]) / tau
        oms[i + 1] = oms[i] + als[i] * dt

    ths = []
    acc = 0.0
    for o in oms:
        ths.append(acc)
        acc += o * dt
    k = THETA / ths[-1] if ths[-1] else 1.0
    ths = [v * k for v in ths]
    oms = [v * k for v in oms]
    als = [v * k for v in als]
    jks = [0.0] * n
    for i in range(1, n - 1):
        jks[i] = (als[i + 1] - als[i - 1]) / (2 * dt)
    return ts, ths, oms, als, jks, T


def _solve_v(T, a1, j1, a2, j2):
    """给定节拍反解 v_max：0.5v^2(1/a1+1/a2) + v(0.5(a1/j1+a2/j2) - T) + theta = 0"""
    A = 0.5 * (1.0 / a1 + 1.0 / a2)
    B = 0.5 * (a1 / j1 + a2 / j2) - T
    C = THETA
    disc = B * B - 4 * A * C
    if disc <= 0:
        return None
    v = (-B - math.sqrt(disc)) / (2 * A)
    if v <= 1e-3 or v > 1.05 * V_MAX:
        return None
    return v


def _simulate(ts, oms, als, R, L, zeta, dt=0.004, tail=25.0):
    """球面摆 RK4 积分，返回与 ts 对齐的切向摆角(deg) 与延长段数据。"""
    w0sq = G / L
    c = 2.0 * zeta * math.sqrt(w0sq)
    x = vx = y = vy = 0.0
    T_end = ts[-1] + tail
    n = int(math.ceil(T_end / dt))
    out_t, out_g = [], []

    def deriv(x, vx, y, vy, om, al):
        ax = -w0sq * L * math.sin(x / L) - c * vx + 2 * om * vy + om * om * (R + x) + al * y
        ay = -w0sq * L * math.sin(y / L) - c * vy - 2 * om * vx + om * om * y - al * (R + x)
        return vx, ax, vy, ay

    k = 0
    n_last = len(ts) - 1
    for i in range(n + 1):
        tq = i * dt
        if tq <= ts[n_last]:
            while k < n_last - 1 and ts[k + 1] <= tq:
                k += 1
            d = ts[k + 1] - ts[k]
            f = (tq - ts[k]) / d if d > 0 else 0.0
            f = 0.0 if f < 0.0 else (1.0 if f > 1.0 else f)
            j1 = min(k + 1, n_last)
            om = oms[k] + (oms[j1] - oms[k]) * f
            al = als[k] + (als[j1] - als[k]) * f
        else:
            om = al = 0.0
        out_t.append(tq)
        g = y / L
        g = max(-0.999, min(0.999, g))
        out_g.append(math.degrees(math.asin(g)))
        if i == n:
            break
        k1 = deriv(x, vx, y, vy, om, al)
        k2 = deriv(x + 0.5 * dt * k1[0], vx + 0.5 * dt * k1[1],
                   y + 0.5 * dt * k1[2], vy + 0.5 * dt * k1[3], om, al)
        k3 = deriv(x + 0.5 * dt * k2[0], vx + 0.5 * dt * k2[1],
                   y + 0.5 * dt * k2[2], vy + 0.5 * dt * k2[3], om, al)
        k4 = deriv(x + dt * k3[0], vx + dt * k3[1],
                   y + dt * k3[2], vy + dt * k3[3], om, al)
        x += dt / 6.0 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
        vx += dt / 6.0 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
        y += dt / 6.0 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
        vy += dt / 6.0 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3])
    return out_t, out_g


def _metrics(ts, oms, als, jks, T, st, sv, R, L, zeta):
    peak = 0.0
    rms = 0.0
    cnt = 0
    for tq, g in zip(st, sv):
        if tq <= T:
            peak = max(peak, abs(g))
            rms += g * g
            cnt += 1
    rms = math.sqrt(rms / max(cnt, 1))
    post = [abs(g) for tq, g in zip(st, sv) if T < tq <= T + 10.0]
    post_max = max(post) if post else 0.0
    post_rms = math.sqrt(sum(v * v for v in post) / len(post)) if post else 0.0
    tail_t = [tq for tq in st if tq >= T]
    tail_g = [g for tq, g in zip(st, sv) if tq >= T]
    last = 0
    for i, g in enumerate(tail_g):
        if abs(g) > 2.0:
            last = i
    resolved = bool(tail_t) and last < len(tail_t) - 1
    decay = (tail_t[last] - T) if resolved else (tail_t[-1] - T if tail_t else 0.0)
    return {
        "T": round(T, 2),
        "peak": round(peak, 2),
        "residual": round(post_max, 2),
        "rms": round(post_rms, 2),
        "rmsMotion": round(rms, 2),
        "decay": round(decay, 1),
        "decayResolved": resolved,
        "jerk": round(max(abs(v) for v in jks) * 57.29577951308232, 1),
        "omega": round(max(oms) * 57.29577951308232, 2),
        "alpha": round(max(abs(v) for v in als) * 57.29577951308232, 2),
    }


def _pack(ts, ths, oms, als, jks, st, sv, T, R, L, zeta, target=520):
    """下采样到约 target 点；轨迹量按时间插值，角度类全部转成 deg。"""
    step = max(1, len(st) // target)
    idx = list(range(0, len(st), step))
    k = 57.29577951308232
    t_out, th_out, om_out, al_out, jk_out, sw_out = [], [], [], [], [], []
    j = 0
    for ii, i in enumerate(idx):
        tq = st[i]
        a0 = i
        b0 = idx[ii + 1] if ii + 1 < len(idx) else len(ts)
        while j < len(ts) - 2 and ts[j + 1] <= tq:
            j += 1
        d = ts[j + 1] - ts[j] if j + 1 < len(ts) else 0.0
        f = (tq - ts[j]) / d if d > 0 else 0.0
        f = min(max(f, 0.0), 1.0)
        j1 = min(j + 1, len(ts) - 1)
        t_out.append(round(tq, 3))
        th_out.append(round((ths[j] + (ths[j1] - ths[j]) * f) * k, 2))
        om_out.append(round((oms[j] + (oms[j1] - oms[j]) * f) * k, 3))
        al_out.append(round((als[j] + (als[j1] - als[j]) * f) * k, 3))
        seg = jks[a0:min(b0, len(jks))] or [0.0]
        jk_out.append(round(max(seg, key=lambda v: abs(v)) * k, 2))
        sw_out.append(round(sv[i], 3))
    return {"t": t_out, "theta": th_out, "omega": om_out, "alpha": al_out,
            "jerk": jk_out, "sway": sw_out}


def compute(R=26.0, L=14.0, zeta=0.03):
    """主入口：返回四方案曲线与指标（JSON 字符串）。"""
    R, L, zeta = float(R), float(L), float(zeta)
    res = {}

    # ① 手动
    ts, ths, oms, als, jks, T = _manual(R, L, zeta)
    st, sv = _simulate(ts, oms, als, R, L, zeta)
    res["manual"] = {"series": _pack(ts, ths, oms, als, jks, st, sv, T, R, L, zeta),
                     "metrics": _metrics(ts, oms, als, jks, T, st, sv, R, L, zeta),
                     "note": "分档推杆 + 手柄 0.12s / 传动 0.30s 滞后"}

    # ② 梯形
    ts, ths, oms, als, jks, T = _trapezoid(V_MAX, A_REF, THETA)
    st, sv = _simulate(ts, oms, als, R, L, zeta)
    res["trap"] = {"series": _pack(ts, ths, oms, als, jks, st, sv, T, R, L, zeta),
                   "metrics": _metrics(ts, oms, als, jks, T, st, sv, R, L, zeta),
                   "note": "a = %.3f rad/s2" % A_REF}

    # ③ 经验 S 型
    ts, ths, oms, als, jks, T = _s_curve(V_MAX, A_REF, J_REF, A_REF, J_REF, THETA)
    st, sv = _simulate(ts, oms, als, R, L, zeta)
    res["scurve"] = {"series": _pack(ts, ths, oms, als, jks, st, sv, T, R, L, zeta),
                     "metrics": _metrics(ts, oms, als, jks, T, st, sv, R, L, zeta),
                     "note": "a = %.3f, j = %.3f" % (A_REF, J_REF)}

    # ④ DE 整定 S 型
    p = OPT
    v = _solve_v(p["T"], p["a1"], p["j1"], p["a2"], p["j2"])
    if v:
        ts, ths, oms, als, jks, T = _s_curve(v, p["a1"], p["j1"], p["a2"], p["j2"], THETA)
    else:
        ts, ths, oms, als, jks, T = _s_curve(V_MAX, A_REF, J_REF, A_REF, J_REF, THETA)
    st, sv = _simulate(ts, oms, als, R, L, zeta)
    res["opt"] = {"series": _pack(ts, ths, oms, als, jks, st, sv, T, R, L, zeta),
                  "metrics": _metrics(ts, oms, als, jks, T, st, sv, R, L, zeta),
                  "note": "a = %.4f / %.4f, j = %.3f, T = %.2fs" % (p["a1"], p["a2"], p["j1"], p["T"])}

    return json.dumps({"params": {"R": R, "L": L, "zeta": zeta, "theta": 90.0,
                                  "period": round(2 * math.pi / math.sqrt(G / L), 3),
                                  "vmax": round(V_MAX, 4)},
                       "order": ["manual", "trap", "scurve", "opt"],
                       "series": {k: v["series"] for k, v in res.items()},
                       "metrics": {k: v["metrics"] for k, v in res.items()},
                       "note": {k: v["note"] for k, v in res.items()}},
                      ensure_ascii=False)


def tune(R=26.0, L=14.0, zeta=0.03):
    """浏览器内小型差分进化：整定 (a_acc, j_acc, a_dec, j_dec, T)。"""
    R, L, zeta = float(R), float(L), float(zeta)
    base = _s_curve(V_MAX, A_REF, J_REF, A_REF, J_REF, THETA)
    T_base = base[5]

    def cost(p):
        v = _solve_v(p[4], p[0], p[1], p[2], p[3])
        if not v:
            return 1e3
        out = _s_curve(v, p[0], p[1], p[2], p[3], THETA, dt=0.02)
        if not out:
            return 1e3
        ts, ths, oms, als, jks, T = out
        st, sv = _simulate(ts, oms, als, R, L, zeta, dt=0.02, tail=8.0)
        m = _metrics(ts, oms, als, jks, T, st, sv, R, L, zeta)
        pen = 3.0 * max(0.0, m["peak"] - 11.0) + 2.0 * max(0.0, T - T_base)
        return 2.5 * m["peak"] + 3.0 * m["residual"] + 1.0 * m["rms"] + 0.6 * m["rmsMotion"] + pen

    random.seed(2026)
    NP = 14
    bounds = [(0.012, 0.035), (0.03, 0.25), (0.012, 0.035), (0.03, 0.25),
              (T_base, T_base + 1.8)]
    pop = [[random.uniform(b[0], b[1]) for b in bounds] for _ in range(NP)]
    fit = [cost(p) for p in pop]

    for gen in range(18):
        for i in range(NP):
            a, b, c = random.sample(range(NP), 3)
            F = 0.6
            trial = []
            for j in range(5):
                val = pop[a][j] + F * (pop[b][j] - pop[c][j])
                lo, hi = bounds[j]
                trial.append(min(hi, max(lo, val)))
            cf = cost(trial)
            if cf < fit[i]:
                pop[i], fit[i] = trial, cf

    best = pop[fit.index(min(fit))]
    cur = [OPT["a1"], OPT["j1"], OPT["a2"], OPT["j2"], OPT["T"]]
    if cost(cur) <= cost(best):
        best = cur
    OPT["a1"], OPT["j1"], OPT["a2"], OPT["j2"], OPT["T"] = best
    return json.dumps({"a1": round(best[0], 6), "j1": round(best[1], 6),
                       "a2": round(best[2], 6), "j2": round(best[3], 6),
                       "T": round(best[4], 4), "cost": round(min(fit), 3)},
                      ensure_ascii=False)


def reset_opt(a1, j1, a2, j2, T):
    OPT["a1"], OPT["j1"], OPT["a2"], OPT["j2"], OPT["T"] = float(a1), float(j1), float(a2), float(j2), float(T)
    return "ok"
`;
})(window);
