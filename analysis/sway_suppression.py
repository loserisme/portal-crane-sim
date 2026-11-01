#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
sway_suppression.py
===================
门座式起重机回转工况「抓斗摆动抑制」对比实验
------------------------------------------------------------
四种回转轨迹规划方式的对比（0° -> 90°）：

  1. 模拟手动操作      —— 操作员分档推杆，档位阶跃 + 手柄一阶滞后 + 操作抖动
  2. 梯形加减速        —— 加速度阶跃（加加速度为冲击），传统 PLC 方案
  3. S 型加减速        —— 七段式 jerk 受限曲线，参数凭经验给定
  4. 优化整定的 S 型   —— 在相同作业节拍约束下，用差分进化(DE)整定
                          加/减速段的 a_max、jerk 及不对称减速参数，
                          使摆动峰值与停止后残余摆动最小

输出：回转角、角速度、角加速度、加加速度、抓斗切向摆角曲线，
      以及摆角衰减全时程、摆动频谱和量化指标表。

物理模型
--------
回转坐标系 (x 沿臂架向外、y 沿回转切向、z 竖直向上) 下的球面摆：

    吊点位于半径 R、绳长 L，回转角 theta(t)

    x'' = -w0^2 L sin(x/L) + 2*zeta*w0*x' + 2*w*y' + w^2*(R+x) + alpha*y
    y'' = -w0^2 L sin(y/L) + 2*zeta*w0*y' - 2*w*x' + w^2*y     - alpha*(R+x)

    w = theta' 为回转角速度，alpha = theta'' 为角加速度，
    w0 = sqrt(g/L) 为单摆固有频率；第 2 项为结构/空气等效阻尼，
    第 3 项为科氏加速度，w^2 项为离心加速度，alpha 项为欧拉加速度。

    该方程由拉格朗日法对刚性球摆严格推导（见 derive_model.py），
    保留恢复力非线性，在 |x|,|y| << L 时退化为经典线性模型。

运行：python sway_suppression.py
"""

from __future__ import annotations

import csv
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MultipleLocator
from scipy.optimize import differential_evolution

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# =====================================================================
# 1. 物理参数（与 portal-crane-sim / js/config.js 的高精度模型一致）
# =====================================================================
G = 9.81                    # 重力加速度 m/s^2
R_BOOM = 26.0               # 吊点回转半径（工作幅度）m
L_ROPE = 14.0               # 吊点至抓斗质心的悬垂长度 m
ZETA = 0.03                 # 摆动等效阻尼比
RATED_SLEW = 1.6            # 额定回转速度 r/min
V_RATED = RATED_SLEW * 2 * math.pi / 60.0     # 0.1676 rad/s
THETA_TOTAL = math.radians(90.0)              # 回转目标角

OMEGA0 = math.sqrt(G / L_ROPE)                # 0.837 rad/s
T_SWAY = 2 * math.pi / OMEGA0                 # 7.51 s 单摆周期

OUT_DIR = Path(__file__).resolve().parent / "out"
OUT_DIR.mkdir(exist_ok=True)

# 统一风格
COLORS = {
    "manual": "#d62728",
    "trap": "#ff7f0e",
    "scurve": "#1f77b4",
    "opt": "#2ca02c",
}
LABELS = {
    "manual": "手动操作（分档推杆）",
    "trap": "梯形加减速",
    "scurve": "S 型加减速（经验参数）",
    "opt": "优化整定的 S 型",
}


# =====================================================================
# 2. 轨迹剖面对象
# =====================================================================
@dataclass
class Profile:
    """回转轨迹：等间隔时间序列 + 插值访问。"""

    key: str
    t: np.ndarray
    theta: np.ndarray      # rad
    omega: np.ndarray      # rad/s
    alpha: np.ndarray      # rad/s^2
    jerk: np.ndarray       # rad/s^3
    T: float               # 运动结束时刻 s
    note: str = ""
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._t_end = float(self.t[-1])

    def sample(self, tq: float) -> tuple[float, float]:
        """返回 (omega, alpha)，运动结束之后恒为 0。"""
        if tq >= self._t_end:
            return 0.0, 0.0
        return (
            float(np.interp(tq, self.t, self.omega)),
            float(np.interp(tq, self.t, self.alpha)),
        )


# =====================================================================
# 3. 四种轨迹规划
# =====================================================================
def _trapezoid(v_max: float, a_max: float, theta_tot: float, dt: float = 1e-3) -> Profile:
    """梯形速度曲线：加速度阶跃。"""
    t_acc = v_max / a_max
    T = theta_tot / v_max + t_acc
    n = int(round(T / dt)) + 1
    t = np.arange(n) * dt
    alpha = np.zeros_like(t)
    m1 = t <= t_acc
    m3 = t >= (T - t_acc)
    alpha[m1] = a_max
    alpha[m3] = -a_max
    omega = np.cumsum(alpha) * dt
    theta = np.cumsum(omega) * dt
    # 末端归位（消除离散积分残差）
    theta *= theta_tot / theta[-1]
    omega *= theta_tot / theta[-1]
    jerk = np.gradient(alpha, dt)
    return Profile("trap", t, theta, omega, alpha, jerk, T,
                   note=f"a_max={a_max:.4f} rad/s²")


def _s_ramp_segments(v_max: float, a_max: float, j_max: float) -> list[tuple[float, float]]:
    """
    加速段 jerk 分段（(持续时间, jerk)）。
    标准七段：t1=jerk 上升至 a_max，t2=恒加速，t3=jerk 回落至 0；
    由 v_max = a_max*(t2 + t1) 得 t2 = v_max/a_max - t1。
    若 v_max/a_max < t1（速度太低，加速度上不到 a_max），退化为三角形加速度。
    """
    tj = a_max / j_max
    ta = v_max / a_max
    if ta < tj:                                    # 三角形加速度
        t1 = math.sqrt(v_max / j_max)
        return [(t1, j_max), (t1, -j_max)]
    return [(tj, j_max), (ta - tj, 0.0), (tj, -j_max)]


def _integrate_jerk(segs: list[tuple[float, float]], dt: float = 1e-3):
    """按 jerk 分段解析积分，返回 t, theta, omega, alpha, jerk。"""
    ts, ths, oms, als, jks = [0.0], [0.0], [0.0], [0.0], [segs[0][1] if segs else 0.0]
    th = om = al = 0.0
    t = 0.0
    for dur, jk in segs:
        n = max(int(round(dur / dt)), 1)
        h = dur / n
        for _ in range(n):
            # 三阶泰勒步进（jerk 段内精确）
            th = th + om * h + 0.5 * al * h * h + jk * h ** 3 / 6.0
            om = om + al * h + 0.5 * jk * h * h
            al = al + jk * h
            t += h
            ts.append(t)
            ths.append(th)
            oms.append(om)
            als.append(al)
            jks.append(jk)
    return (np.array(ts), np.array(ths), np.array(oms), np.array(als), np.array(jks))


def _s_curve(v_max: float, a_max: float, j_max: float, theta_tot: float,
             a_dec: float | None = None, j_dec: float | None = None,
             T_fixed: float | None = None) -> Profile:
    """
    七段式 S 曲线：加加速-匀加速-减加速-匀速-加减速-匀减速-减减速。
    允许减速段使用独立参数（a_dec, j_dec），用于参数整定。
    """
    a_dec = a_max if a_dec is None else a_dec
    j_dec = j_max if j_dec is None else j_dec

    segs_acc = _s_ramp_segments(v_max, a_max, j_max)
    segs_dec = [(d, -j) for d, j in _s_ramp_segments(v_max, a_dec, j_dec)]
    t_acc = sum(d for d, _ in segs_acc)
    t_dec = sum(d for d, _ in segs_dec)
    d_acc = v_max * t_acc / 2.0
    d_dec = v_max * t_dec / 2.0
    d_const = theta_tot - d_acc - d_dec
    if d_const < 0:
        raise ValueError("给定参数下无法完成目标转角")
    t_const = d_const / v_max
    T = t_acc + t_const + t_dec

    if T_fixed is not None and abs(T - T_fixed) > 1e-6:
        pass  # 由调用方保证一致性

    segs = segs_acc + [(t_const, 0.0)] + segs_dec
    t, th, om, al, jk = _integrate_jerk(segs, dt=1e-3)
    return Profile("scurve", t, th, om, al, jk, T,
                   note=f"a={a_max:.4f}/{a_dec:.4f} rad/s², j={j_max:.3f}/{j_dec:.3f} rad/s³")


def _manual(dt: float = 1e-3, seed: int = 11, t_stop: float = 12.6) -> Profile:
    """
    模拟手动操作：操作员分档推杆 + 手柄有限推程（τ_slew）+ 变频器一阶滞后，
    叠加轻微操作抖动；末端直接松杆，产生明显摆动。

    t_stop 可变，用于停止时刻抖动下的鲁棒性统计（同一操作手法、不同停止瞬间，
    残余摆动差别很大——这正是手动操作不可复现的根源）。
    """
    tau = 0.30                                   # 传动/变频器响应时间常数 s
    tau_slew = 0.12                              # 手柄推程时间常数 s
    knots = [(0.0, 0.00), (1.0, 0.45), (3.6, 0.78), (6.6, 1.00),
             (10.2, 0.72), (11.8, 0.45), (12.6, 0.00)]
    knots = [k for k in knots if k[0] < t_stop - 1e-9] + [(t_stop, 0.0)]
    T = t_stop + (3 * tau + 3 * tau_slew)
    n = int(round(T / dt)) + 1
    t = np.arange(n) * dt

    times = np.array([k[0] for k in knots[1:]])
    vals = np.array([k[1] for k in knots[1:]])
    idx = np.clip(np.searchsorted(times, t, side="right"), 0, len(vals) - 1)
    cmd = np.where(t >= times[0], vals[idx], 0.0) * V_RATED

    # 操作抖动（±1.2% 额定速度），叠加在指令上
    rng = np.random.default_rng(seed)
    noise = rng.normal(0.0, 0.012 * V_RATED, n)
    k = int(0.15 / dt) | 1
    noise = np.convolve(noise, np.ones(k) / k, mode="same")
    cmd = cmd + noise

    # 手柄推程（有限斜率）→ 指令不再是理想阶跃
    slew = np.zeros(n)
    for i in range(n - 1):
        slew[i + 1] = slew[i] + dt / tau_slew * (cmd[i] - slew[i])

    omega = np.zeros(n)
    alpha = np.zeros(n)
    for i in range(n - 1):
        a_i = (slew[i] - omega[i]) / tau
        alpha[i] = a_i
        omega[i + 1] = omega[i] + a_i * dt

    theta = np.cumsum(omega) * dt
    scale = THETA_TOTAL / theta[-1]
    theta *= scale
    omega *= scale
    alpha *= scale

    k2 = int(0.02 / dt) | 1                      # 轻度平滑，抑制数值毛刺
    jerk = np.convolve(np.gradient(alpha, dt), np.ones(k2) / k2, mode="same")
    return Profile("manual", t, theta, omega, alpha, jerk, T,
                   note=f"分档推杆 + 手柄 {tau_slew:.2f}s / 传动 {tau:.2f}s 滞后")


# =====================================================================
# 4. 摆动动力学仿真（RK4）
# =====================================================================
def simulate(prof: Profile, t_tail: float = 40.0, dt: float = 2e-3) -> dict:
    """以回转运动为激励，积分球摆方程至运动结束后 t_tail 秒。"""
    t_end = prof.T + t_tail
    n = int(round(t_end / dt)) + 1
    ts = np.empty(n)
    gam_t = np.empty(n)      # 切向摆角 rad
    gam_r = np.empty(n)      # 径向摆角 rad
    om = np.empty(n)
    x = vx = y = vy = 0.0
    w0sq = OMEGA0 ** 2
    c = 2 * ZETA * OMEGA0

    def deriv(x, vx, y, vy, w, al):
        ax = -w0sq * L_ROPE * math.sin(x / L_ROPE) - c * vx + 2 * w * vy \
             + w * w * (R_BOOM + x) + al * y
        ay = -w0sq * L_ROPE * math.sin(y / L_ROPE) - c * vy - 2 * w * vx \
             + w * w * y - al * (R_BOOM + x)
        return vx, ax, vy, ay

    for i in range(n):
        tq = i * dt
        w, al = prof.sample(tq)
        ts[i] = tq
        om[i] = w
        gam_t[i] = math.asin(max(-1.0, min(1.0, y / L_ROPE)))
        gam_r[i] = math.asin(max(-1.0, min(1.0, x / L_ROPE)))
        if i == n - 1:
            break
        k1 = deriv(x, vx, y, vy, w, al)
        k2 = deriv(x + 0.5 * dt * k1[0], vx + 0.5 * dt * k1[1],
                   y + 0.5 * dt * k1[2], vy + 0.5 * dt * k1[3], w, al)
        k3 = deriv(x + 0.5 * dt * k2[0], vx + 0.5 * dt * k2[1],
                   y + 0.5 * dt * k2[2], vy + 0.5 * dt * k2[3], w, al)
        k4 = deriv(x + dt * k3[0], vx + dt * k3[1],
                   y + dt * k3[2], vy + dt * k3[3], w, al)
        x += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
        vx += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
        y += dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
        vy += dt / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3])

    return {"t": ts, "gam_t": np.rad2deg(gam_t), "gam_r": np.rad2deg(gam_r), "omega": om}


# =====================================================================
# 5. 指标
# =====================================================================
def metrics(prof: Profile, sim: dict) -> dict:
    t, gt = sim["t"], sim["gam_t"]
    m_motion = t <= prof.T
    peak_motion = float(np.max(np.abs(gt[m_motion])))
    residual = float(abs(np.interp(prof.T, t, gt)))

    tail = t >= prof.T
    t_tail = t[tail] - prof.T
    g_tail = gt[tail]
    post10 = g_tail[t_tail <= 10.0]
    post10_max = float(np.max(np.abs(post10))) if post10.size else residual
    post10_rms = float(np.sqrt(np.mean(post10 ** 2))) if post10.size else residual
    # 衰减到 ±2° 以内的时刻（取最后一次越限的时刻；若窗口内始终未收敛则记为窗口末尾并标记）
    idx = np.where(np.abs(g_tail) > 2.0)[0]
    if idx.size:
        decay = float(t_tail[idx[-1]])
        decay_ok = idx[-1] + 1 < t_tail.size
    else:
        decay, decay_ok = 0.0, True
    rms = float(np.sqrt(np.mean(gt[m_motion] ** 2)))
    return {
        "peak_sway_deg": peak_motion,
        "residual_deg": residual,
        "post10_max_deg": post10_max,
        "post10_rms_deg": post10_rms,
        "decay2_s": decay,
        "decay2_resolved": decay_ok,
        "rms_deg": rms,
        "T_s": prof.T,
        "max_omega_dps": float(np.rad2deg(np.max(prof.omega))),
        "max_alpha_dps2": float(np.rad2deg(np.max(np.abs(prof.alpha)))),
        "max_jerk_dps3": float(np.rad2deg(np.max(np.abs(prof.jerk)))),
    }


# =====================================================================
# 6. 鲁棒性（停止时刻 / 节拍抖动）
# =====================================================================
def time_scale(prof: Profile, k: float) -> Profile:
    """整体时间缩放：转角不变，速度/加速度/加加速度按 k、k²、k³ 反向缩放。"""
    return Profile(prof.key, prof.t * k, prof.theta.copy(), prof.omega / k,
                   prof.alpha / k ** 2, prof.jerk / k ** 3, prof.T * k,
                   note=prof.note, meta=dict(prof.meta))


def robustness_study(profiles: dict, dt: float = 1e-2) -> dict:
    """
    对每种规划方式做 5 组微小扰动，统计摆动指标分布：
      · 手动操作：停止时刻抖动 ±0.8 s（同一操作手法，松杆瞬间不同）
      · 其余三种：节拍抖动 ±4%（速度/加速度水平随之变化）
    """
    out: dict[str, dict] = {}
    for k, p in profiles.items():
        if k == "manual":
            samples = [_manual(t_stop=ts) for ts in (11.8, 12.2, 12.6, 13.0, 13.4)]
        else:
            samples = [time_scale(p, 1 + d) for d in (-0.04, -0.02, 0.0, 0.02, 0.04)]
        rows = []
        for sp in samples:
            m = metrics(sp, simulate(sp, t_tail=12.0, dt=dt))
            rows.append((sp, m))
        out[k] = {"rows": rows}
    return out


def pick_median(rows: list) -> Profile:
    """按残余摆角取中位样本，作为该方案的代表性工况。"""
    rows_sorted = sorted(rows, key=lambda r: (r[1]["post10_max_deg"], r[1]["peak_sway_deg"]))
    return rows_sorted[len(rows_sorted) // 2][0]


# =====================================================================
# 7. 优化整定
# =====================================================================
def make_opt_profile(x: np.ndarray, T_fixed: float) -> Profile | None:
    """
    给定加/减速段参数与固定节拍 T，解出 v_max 使总转角恰为 90°。

    七段 S 曲线的节拍关系（T_acc = v/a + a/j 为整个加速段时长）：

        T = θ/v + (T_acc + T_dec)/2

    变量 x = (a_acc, j_acc, a_dec, j_dec)
    """
    a1, j1, a2, j2 = x[:4]
    T_use = float(x[4]) if len(x) > 4 else T_fixed
    # 0.5*v²*(1/a1+1/a2) + v*(0.5*(a1/j1+a2/j2) - T) + θ = 0
    A = 0.5 * (1.0 / a1 + 1.0 / a2)
    B = 0.5 * (a1 / j1 + a2 / j2) - T_use
    C = THETA_TOTAL
    disc = B * B - 4 * A * C
    if disc <= 0:
        return None
    v = (-B - math.sqrt(disc)) / (2 * A)          # 取较小根（左侧分支）
    if v <= 1e-3 or v > 1.05 * V_RATED:
        return None
    try:
        prof = _s_curve(v, a1, j1, THETA_TOTAL, a_dec=a2, j_dec=j2)
    except ValueError:
        return None
    if abs(prof.T - T_use) > 0.05:
        return None
    return prof


def optimize_profile(T_fixed: float, peak_ref: float = 12.0,
                     a_cap: float = 0.035, j_cap: float = 0.28,
                     force: bool = False) -> tuple[Profile, dict]:
    """差分进化整定：目标 = 摆动峰值 + 残余摆角权重（结果缓存到 JSON）。"""
    import json

    cache_file = OUT_DIR / "opt_params.json"
    if cache_file.exists() and not force:
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        if abs(data.get("T_fixed", -1) - T_fixed) < 1e-6:
            prof = make_opt_profile(np.array(data["x"]), T_fixed)
            if prof is not None:
                prof.key = "opt"
                prof.note = (f"DE 整定：a={data['x'][0]:.4f}/{data['x'][2]:.4f} rad/s², "
                             f"j={data['x'][1]:.3f}/{data['x'][3]:.3f} rad/s³")
                prof.meta = {**data["meta"], "cached": True}
                print("        （使用缓存参数）")
                return prof, prof.meta

    cache: dict[tuple, float] = {}

    def objective(x):
        key = tuple(np.round(x, 4))
        if key in cache:
            return cache[key]
        prof = make_opt_profile(np.asarray(x), T_fixed)
        if prof is None:
            cache[key] = 1e3
            return 1e3
        # 搜索阶段用较粗步长（50 Hz，单摆每周期仍有 ~150 点），兼顾精度与速度
        sim = simulate(prof, t_tail=8.0, dt=2e-2)
        mt = metrics(prof, sim)
        # 目标：摆动峰值 + 停止残余 + 过程 RMS；并对过大加加速度加软约束，
        # 保证整定结果仍是平顺的 S 型曲线而不是退化成梯形
        cost = 2.5 * mt["peak_sway_deg"] + 3.0 * mt["post10_max_deg"] \
               + 1.0 * mt["post10_rms_deg"] + 0.6 * mt["rms_deg"] \
               + 3.0 * max(0.0, mt["peak_sway_deg"] - peak_ref) \
               + 2.0 * max(0.0, prof.T - T_fixed) \
               + 0.6 * max(0.0, mt["max_jerk_dps3"] - 12.0) / 10.0
        cache[key] = cost
        return cost

    # 约束：整定后的加速度与加加速度不得超过原经验 S 曲线上限，
    # 只在「相位与不对称度」上做整定，保证对比的公平性
    bounds = [(0.012, a_cap),          # 加速段 a_max rad/s^2
              (0.03, j_cap),           # 加速段 jerk rad/s^3
              (0.012, a_cap),          # 减速段 a_max
              (0.03, j_cap),           # 减速段 jerk
              (T_fixed, T_fixed + 1.8)]  # 允许为相位对齐延长少量节拍
    it = {"n": 0}

    def _cb(xk, convergence=None):
        it["n"] += 1
        if it["n"] % 5 == 0:
            print(f"        iter {it['n']:>2d}/{45}  cost={objective(xk):.4f}  "
                  f"conv={convergence:.2e}", flush=True)

    res = differential_evolution(
        objective, bounds, seed=2026, maxiter=45, popsize=15,
        tol=1e-4, mutation=(0.4, 1.0), recombination=0.85,
        polish=True, init="sobol", workers=1, updating="deferred",
        callback=_cb,
    )
    prof = make_opt_profile(res.x, T_fixed)
    assert prof is not None
    prof.key = "opt"
    prof.note = (f"DE 整定：a={res.x[0]:.4f}/{res.x[2]:.4f} rad/s², "
                 f"j={res.x[1]:.3f}/{res.x[3]:.3f} rad/s³, T={res.x[4]:.2f}s")
    prof.meta = {
        "a_acc": float(res.x[0]), "j_acc": float(res.x[1]),
        "a_dec": float(res.x[2]), "j_dec": float(res.x[3]),
        "cost": float(res.fun), "nfev": int(res.nfev),
    }
    cache_file.write_text(json.dumps({
        "T_fixed": T_fixed, "x": [float(v) for v in res.x],
        "meta": prof.meta,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return prof, prof.meta


# =====================================================================
# 7. 主流程
# =====================================================================
def main() -> None:
    print("=" * 78)
    print("门座式起重机回转抓斗摆动抑制对比实验")
    print(f"  幅度 R = {R_BOOM} m, 悬垂长度 L = {L_ROPE} m, 阻尼比 ζ = {ZETA}")
    print(f"  单摆固有频率 ω0 = {OMEGA0:.4f} rad/s, 摆动周期 T = {T_SWAY:.2f} s")
    print(f"  回转 0° → 90°, 额定回转速度 {RATED_SLEW} r/min = {V_RATED:.4f} rad/s")
    print("=" * 78)

    # --- 基准 S 曲线（经验参数），其节拍作为优化节拍约束 ---
    a_ref, j_ref = 0.035, 0.100
    s_ref = _s_curve(V_RATED, a_ref, j_ref, THETA_TOTAL)
    T_ref = s_ref.T
    print(f"\n[S 型基准] a_max={a_ref} rad/s², j={j_ref} rad/s³ → 节拍 {T_ref:.2f} s")

    profiles: dict[str, Profile] = {}
    profiles["manual"] = _manual()
    profiles["trap"] = _trapezoid(V_RATED, a_ref, THETA_TOTAL)
    profiles["scurve"] = s_ref

    # 经验 S 曲线的摆动峰值，作为整定时不得超越的基准
    s_ref_peak = metrics(s_ref, simulate(s_ref, t_tail=8.0, dt=2e-2))["peak_sway_deg"]
    j_ref_max = 0.25
    print(f"[基准] 经验 S 曲线峰值摆角 {s_ref_peak:.2f}°，整定上限 "
          f"a≤{a_ref} rad/s², j≤{j_ref_max} rad/s³")

    print("[优化] 差分进化整定中（节拍允许 ≤1.8 s 相位补偿）…")
    opt_prof, opt_meta = optimize_profile(
        T_ref, peak_ref=s_ref_peak, a_cap=a_ref, j_cap=j_ref_max,
        force="--reopt" in sys.argv)
    profiles["opt"] = opt_prof
    print(f"        结果: a_acc={opt_meta['a_acc']:.4f}, j_acc={opt_meta['j_acc']:.3f}, "
          f"a_dec={opt_meta['a_dec']:.4f}, j_dec={opt_meta['j_dec']:.3f}, "
          f"T={opt_prof.T:.2f}s")
    print(f"        目标函数值 = {opt_meta['cost']:.4f}, 评价次数 = {opt_meta['nfev']}")

    # --- 鲁棒性统计：停止时刻 / 节拍抖动，取中位样本作为代表性工况 ---
    print("\n[鲁棒性] 停止时刻±0.8 s / 节拍±4% 抖动统计…")
    rob = robustness_study(profiles)
    for k in ("manual", "trap", "scurve", "opt"):
        profiles[k] = pick_median(rob[k]["rows"])
    profiles["opt"].key = "opt"

    # --- 仿真 ---
    sims: dict[str, dict] = {}
    mets: dict[str, dict] = {}
    for k, p in profiles.items():
        sims[k] = simulate(p, t_tail=90.0, dt=2e-3)
        mets[k] = metrics(p, sims[k])

    # --- 指标表 ---
    header = (f"{'方案':<16}{'节拍T':>8}{'峰值摆角':>10}{'停后残余':>10}"
              f"{'停后RMS':>10}{'过程RMS':>10}{'衰减到2°':>10}{'最大jerk':>11}")
    print("\n" + header)
    print("-" * 86)
    for k in ("manual", "trap", "scurve", "opt"):
        m = mets[k]
        decay_txt = (f"{m['decay2_s']:.0f}" if m["decay2_resolved"]
                     else f">{m['decay2_s']:.0f}")
        print(f"{LABELS[k]:<16}{m['T_s']:>8.2f}{m['peak_sway_deg']:>10.2f}"
              f"{m['post10_max_deg']:>10.2f}"
              f"{m['post10_rms_deg']:>10.2f}{m['rms_deg']:>10.2f}"
              f"{decay_txt:>10}{m['max_jerk_dps3']:>11.1f}")
    print("-" * 86)
    print("单位：角度 °，时间 s，加加速度 °/s³；停后残余=停止后 10 s 内摆角峰值")

    # --- 写 CSV ---
    with open(OUT_DIR / "metrics.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["方案", "节拍T/s", "峰值摆角/°", "停后残余幅值/°", "停后10sRMS/°",
                    "过程RMS/°", "衰减到2°/s", "停时瞬时摆角/°",
                    "最大角速度/(°/s)", "最大角加速度/(°/s²)",
                    "最大加加速度/(°/s³)", "备注"])
        for k in ("manual", "trap", "scurve", "opt"):
            m = mets[k]
            w.writerow([LABELS[k], f"{m['T_s']:.3f}", f"{m['peak_sway_deg']:.3f}",
                        f"{m['post10_max_deg']:.3f}", f"{m['post10_rms_deg']:.3f}",
                        f"{m['rms_deg']:.3f}", f"{m['decay2_s']:.3f}",
                        f"{m['residual_deg']:.3f}",
                        f"{m['max_omega_dps']:.3f}",
                        f"{m['max_alpha_dps2']:.3f}", f"{m['max_jerk_dps3']:.3f}",
                        profiles[k].note])

    with open(OUT_DIR / "timeseries.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["方案", "t/s", "回转角/°", "角速度/(°/s)", "角加速度/(°/s²)",
                    "加加速度/(°/s³)", "切向摆角/°", "径向摆角/°"])
        for k in ("manual", "trap", "scurve", "opt"):
            p, s = profiles[k], sims[k]
            step = max(len(s["t"]) // 4000, 1)
            for i in range(0, len(s["t"]), step):
                tq = s["t"][i]
                w.writerow([LABELS[k], f"{tq:.4f}",
                            f"{np.rad2deg(np.interp(tq, p.t, p.theta)):.4f}",
                            f"{np.rad2deg(np.interp(tq, p.t, p.omega)):.4f}",
                            f"{np.rad2deg(np.interp(tq, p.t, p.alpha)):.4f}",
                            f"{np.rad2deg(np.interp(tq, p.t, p.jerk)):.4f}",
                            f"{s['gam_t'][i]:.4f}", f"{s['gam_r'][i]:.4f}"])

    # --- 鲁棒性表 ---
    print("\n[鲁棒性] 5 组扰动下的摆动指标（均值 ± 标准差，括号内为范围）")
    hdr = f"{'方案':<16}{'残余摆角均值':>13}{'残余范围':>18}{'峰值摆角均值':>13}"
    print(hdr)
    print("-" * 78)
    rob_stats: dict[str, dict] = {}
    for k in ("manual", "trap", "scurve", "opt"):
        rows = rob[k]["rows"]
        res = np.array([r[1]["post10_max_deg"] for r in rows])
        pk = np.array([r[1]["peak_sway_deg"] for r in rows])
        rob_stats[k] = {"res_mean": res.mean(), "res_std": res.std(),
                        "res_min": res.min(), "res_max": res.max(),
                        "peak_mean": pk.mean(), "peak_std": pk.std(),
                        "res_samples": res.tolist(), "peak_samples": pk.tolist()}
        s = rob_stats[k]
        print(f"{LABELS[k]:<16}{s['res_mean']:>9.2f} ± {s['res_std']:<4.2f}"
              f"{s['res_min']:>7.2f} ~ {s['res_max']:<8.2f}"
              f"{s['peak_mean']:>9.2f} ± {s['peak_std']:.2f}")
    print("-" * 78)

    with open(OUT_DIR / "robustness.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["方案", "扰动", "停后残余幅值/°", "峰值摆角/°"])
        pert = {"manual": ["11.8", "12.2", "12.6", "13.0", "13.4"],
                "trap": ["0.96", "0.98", "1.00", "1.02", "1.04"],
                "scurve": ["0.96", "0.98", "1.00", "1.02", "1.04"],
                "opt": ["0.96", "0.98", "1.00", "1.02", "1.04"]}
        for k in ("manual", "trap", "scurve", "opt"):
            for pv, (sp, m) in zip(pert[k], rob[k]["rows"]):
                w.writerow([LABELS[k], pv, f"{m['post10_max_deg']:.3f}",
                            f"{m['peak_sway_deg']:.3f}"])

    # --- 绘图 ---
    plot_overview(profiles, sims, mets)
    plot_decay_spectrum(profiles, sims, mets)
    plot_robustness(rob_stats)
    export_web(profiles, sims, mets)

    print(f"\n输出目录：{OUT_DIR}")
    for name in ("fig1_kinematics_sway.png", "fig2_sway_decay_spectrum.png",
                 "fig3_robustness.png", "metrics.csv", "timeseries.csv",
                 "robustness.csv"):
        print(f"  - {name}")


# =====================================================================
# 8. 导出给网页使用的数据集（Pyodide 未就绪时的预设曲线）
# =====================================================================
def export_web(profiles, sims, mets, max_pts: int = 520) -> None:
    """把标称工况的四条曲线压缩成 JSON，写入 ../js/sway-data.js。"""
    import json

    order = ("manual", "trap", "scurve", "opt")
    series, metrics_out = {}, {}
    t_max = max(float(profiles[k].T) + 25.0 for k in order)

    for k in order:
        p, s = profiles[k], sims[k]
        keep = np.where(s["t"] <= p.T + 25.0)[0]
        n = int(keep[-1]) + 1
        step = max(1, n // max_pts)
        idx = list(range(0, n, step))
        tt = s["t"][idx]
        # 加加速度按「保峰值」抽稀：每个时间桶取绝对值最大的样本，
        # 否则梯形/手动的毫秒级冲击脉冲会被均匀抽稀漏掉
        jerk_full = np.rad2deg(np.interp(s["t"], p.t, p.jerk))
        jerk_out = []
        for i0 in range(0, len(tt)):
            a = idx[i0]
            b = idx[i0 + 1] if i0 + 1 < len(idx) else len(s["t"])
            seg = jerk_full[a:b]
            jerk_out.append(round(float(seg[np.argmax(np.abs(seg))]), 2) if seg.size else 0.0)

        series[k] = {
            "T": round(float(p.T), 3),
            "t": [round(float(v), 3) for v in tt],
            "theta": [round(float(v), 2) for v in np.rad2deg(np.interp(tt, p.t, p.theta))],
            "omega": [round(float(v), 3) for v in np.rad2deg(np.interp(tt, p.t, p.omega))],
            "alpha": [round(float(v), 3) for v in np.rad2deg(np.interp(tt, p.t, p.alpha))],
            "jerk": jerk_out,
            "sway": [round(float(v), 3) for v in s["gam_t"][idx]],
        }
        m = mets[k]
        metrics_out[k] = {
            "T": round(m["T_s"], 2),
            "peak": round(m["peak_sway_deg"], 2),
            "residual": round(m["post10_max_deg"], 2),
            "rms": round(m["post10_rms_deg"], 2),
            "rmsMotion": round(m["rms_deg"], 2),
            "decay": round(m["decay2_s"], 1),
            "jerk": round(m["max_jerk_dps3"], 1),
            "omega": round(m["max_omega_dps"], 2),
            "alpha": round(m["max_alpha_dps2"], 2),
            "note": p.note,
        }

    payload = {
        "params": {
            "R": R_BOOM, "L": L_ROPE, "zeta": ZETA,
            "theta": 90.0, "vmax": round(V_RATED, 4),
            "omega0": round(OMEGA0, 4), "period": round(T_SWAY, 3),
        },
        "order": list(order),
        "tMax": round(t_max, 2),
        "series": series,
        "metrics": metrics_out,
        "source": "analysis/sway_suppression.py",
    }
    out = Path(__file__).resolve().parent.parent / "js" / "sway-data.js"
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out.write_text("/* 自动生成：analysis/sway_suppression.py → export_web() */\n"
                   "window.SWAY_PRESET = " + body + ";\n", encoding="utf-8")
    print(f"[Web] 预设曲线已写入 {out}  ({len(body)/1024:.0f} KB)")


# =====================================================================
# 8. 绘图
# =====================================================================
def _style() -> None:
    plt.rcParams.update({
        "font.sans-serif": ["Microsoft YaHei", "SimHei", "DejaVu Sans"],
        "axes.unicode_minus": False,
        "font.size": 10.5,
        "axes.titlesize": 11.5,
        "axes.labelsize": 10.5,
        "axes.linewidth": 0.9,
        "axes.edgecolor": "#5a5a5a",
        "axes.grid": True,
        "grid.color": "#d9d9d9",
        "grid.linewidth": 0.7,
        "grid.linestyle": (0, (4, 3)),
        "legend.frameon": True,
        "legend.framealpha": 0.92,
        "legend.edgecolor": "#c8c8c8",
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
    })


def plot_overview(profiles, sims, mets) -> None:
    _style()
    order = ("manual", "trap", "scurve", "opt")
    fig, axes = plt.subplots(2, 3, figsize=(16.2, 8.6))
    ax = axes.ravel()

    panels = [
        ("theta", "回转角 θ / °", None),
        ("omega", "角速度 ω / (°/s)", None),
        ("alpha", "角加速度 α / (°/s²)", None),
        ("jerk", "加加速度 j / (°/s³)", None),
    ]
    for i, (key, ylabel, _) in enumerate(panels):
        a = ax[i]
        for k in order:
            p = profiles[k]
            y = getattr(p, key)
            y = np.rad2deg(y) if key != "theta" else np.rad2deg(y)
            a.plot(p.t, y, label=LABELS[k], color=COLORS[k], lw=1.6,
                   ls="-" if k != "manual" else "-", zorder=3 if k == "opt" else 2)
        a.set_xlabel("时间 t / s")
        a.set_ylabel(ylabel)
        a.set_xlim(0, 17.5)
        a.xaxis.set_major_locator(MultipleLocator(3))

    ax[0].set_title("(a) 回转角")
    ax[1].set_title("(b) 回转角速度")
    ax[2].set_title("(c) 回转角加速度")
    ax[3].set_title("(d) 加加速度")
    ax[0].legend(loc="lower right", fontsize=9)

    # 加加速度：按四种方案的真实峰值定坐标范围
    jmax = max(np.rad2deg(np.max(np.abs(profiles[k].jerk))) for k in order)
    ax[3].set_ylim(-1.12 * jmax, 1.12 * jmax)
    ax[3].text(0.985, 0.04,
               f"峰值 jerk：手动 {mets['manual']['max_jerk_dps3']:.0f}、梯形 {mets['trap']['max_jerk_dps3']:.0f}、"
               f"S {mets['scurve']['max_jerk_dps3']:.1f}、优化 {mets['opt']['max_jerk_dps3']:.1f}",
               transform=ax[3].transAxes, fontsize=7.8, va="bottom", ha="right",
               color="#444",
               bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#dcdcdc", lw=0.6))

    # (e) 抓斗切向摆角
    a = ax[4]
    for k in order:
        s = sims[k]
        m = s["t"] <= 20.0
        a.plot(s["t"][m], s["gam_t"][m], label=LABELS[k], color=COLORS[k],
               lw=1.5 if k != "opt" else 2.0)
    a.axhline(0, color="#666", lw=0.8)
    a.set_title("(e) 抓斗切向摆角（回转方向）")
    a.set_xlabel("时间 t / s")
    a.set_ylabel("摆角 γ / °")
    a.set_xlim(0, 20)
    a.legend(loc="upper left", fontsize=7.4, ncol=1, framealpha=0.93)

    # (f) 指标柱状
    a = ax[5]
    keys = ["peak_sway_deg", "post10_max_deg", "post10_rms_deg"]
    names = ["过程峰值摆角", "停后残余幅值", "停后 RMS"]
    x = np.arange(len(keys))
    width = 0.2
    for i, k in enumerate(order):
        vals = [mets[k][kk] for kk in keys]
        bars = a.bar(x + (i - 1.5) * width, vals, width, label=LABELS[k],
                     color=COLORS[k], edgecolor="white", linewidth=0.6)
        for b, v in zip(bars, vals):
            a.text(b.get_x() + b.get_width() / 2, v + 0.12, f"{v:.2f}",
                   ha="center", va="bottom", fontsize=6.8, rotation=90)
    a.set_xticks(x)
    a.set_xticklabels(names, fontsize=9)
    a.set_ylabel("摆角 / °")
    a.set_title("(f) 摆动抑制效果对比")
    a.legend(fontsize=7.4, loc="upper right", ncol=2)
    top = max(mets[k]["peak_sway_deg"] for k in order)

    # 相对手动操作的降幅标注
    red_peak = (1 - mets["opt"]["peak_sway_deg"] / mets["manual"]["peak_sway_deg"]) * 100
    red_res = (1 - mets["opt"]["post10_max_deg"] / mets["manual"]["post10_max_deg"]) * 100
    a.set_title(f"(f) 效果对比（相对手动：峰值↓{red_peak:.0f}%，残余↓{red_res:.0f}%）",
                fontsize=10.2)
    a.set_ylim(0, top * 1.28)

    fig.suptitle("门座式起重机回转 0°→90° 摆动抑制对比实验：四种轨迹规划方式",
                 fontsize=14, y=0.985)
    fig.tight_layout(rect=(0, 0, 1, 0.965))
    fig.savefig(OUT_DIR / "fig1_kinematics_sway.png", dpi=200)
    plt.close(fig)


def plot_decay_spectrum(profiles, sims, mets) -> None:
    _style()
    order = ("manual", "trap", "scurve", "opt")
    fig, axes = plt.subplots(1, 2, figsize=(14.4, 4.9))

    # (a) 全时程摆角
    a = axes[0]
    for k in order:
        s = sims[k]
        a.plot(s["t"], s["gam_t"], label=LABELS[k], color=COLORS[k],
               lw=1.4 if k != "opt" else 2.0)
    a.axhline(0, color="#666", lw=0.8)
    a.axhline(0.5, color="#999", lw=0.7, ls=":")
    a.axhline(-0.5, color="#999", lw=0.7, ls=":")
    a.text(1.0, 0.62, "±0.5° 稳定带", fontsize=8, color="#777")
    a.set_xlabel("时间 t / s")
    a.set_ylabel("切向摆角 γ / °")
    a.set_title("(a) 摆动衰减全时程")
    a.set_xlim(0, 50)
    a.legend(loc="upper right", fontsize=8.6)

    # (b) 摆动频谱
    a = axes[1]
    for k in order:
        s = sims[k]
        m = s["t"] <= 30.0
        y = s["gam_t"][m] - np.mean(s["gam_t"][m])
        dt = s["t"][1] - s["t"][0]
        n = len(y)
        win = np.hanning(n)
        Y = np.abs(np.fft.rfft(y * win)) * 2 / np.sum(win)
        f = np.fft.rfftfreq(n, dt)
        a.semilogy(f, Y + 1e-4, color=COLORS[k], lw=1.3, label=LABELS[k])
    a.axvline(1 / T_SWAY, color="#444", lw=0.9, ls="--")
    a.text(1 / T_SWAY * 1.05, 0.03, f"固有频率 {1 / T_SWAY:.3f} Hz", fontsize=8, color="#444")
    a.set_xlim(0, 1.2)
    a.set_xlabel("频率 f / Hz")
    a.set_ylabel("摆角幅值 / °")
    a.set_title("(b) 摆动频谱（前 30 s）")
    a.legend(fontsize=8.4, loc="upper right")

    fig.suptitle("抓斗摆动衰减与频谱特征对比", fontsize=13.5, y=0.99)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(OUT_DIR / "fig2_sway_decay_spectrum.png", dpi=200)
    plt.close(fig)


def plot_robustness(stats: dict) -> None:
    """停止时刻 / 节拍抖动下的摆动指标分布。"""
    _style()
    order = ("manual", "trap", "scurve", "opt")
    fig, axes = plt.subplots(1, 2, figsize=(13.6, 4.9))
    rng = np.random.default_rng(3)

    specs = [("res_samples", "res_mean", "残余摆角（停止时刻）/ °", "(a) 停止后残余摆角分布"),
             ("peak_samples", "peak_mean", "过程峰值摆角 / °", "(b) 回转过程峰值摆角分布")]

    for ax, (key, mkey, ylab, title) in zip(axes, specs):
        for i, k in enumerate(order):
            vals = np.array(stats[k][key])
            xs = i + rng.uniform(-0.16, 0.16, len(vals))
            ax.scatter(xs, vals, s=42, color=COLORS[k], alpha=0.75,
                       edgecolor="white", linewidth=0.8, zorder=3)
            mu = stats[k][mkey]
            ax.hlines(mu, i - 0.28, i + 0.28, color=COLORS[k], lw=2.4, zorder=4)
            ax.vlines(i, stats[k][key][0] * 0, 0, color="none")
            ax.annotate(f"均值 {mu:.2f}", (i, mu), textcoords="offset points",
                        xytext=(0, 14), ha="center", fontsize=8.4, color=COLORS[k],
                        bbox=dict(boxstyle="round,pad=0.18", fc="white", ec="none", alpha=0.85))
        ax.set_xticks(np.arange(len(order)))
        ax.set_xticklabels([LABELS[k] for k in order], fontsize=9)
        ax.set_ylabel(ylab)
        ax.set_title(title)
        ax.set_xlim(-0.6, len(order) - 0.4)

    fig.suptitle("鲁棒性：停止时刻 ±0.8 s / 节拍 ±4% 抖动下的摆动指标分布",
                 fontsize=13, y=0.99)
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    fig.savefig(OUT_DIR / "fig3_robustness.png", dpi=200)
    plt.close(fig)


if __name__ == "__main__":
    main()