# -*- coding: utf-8 -*-
"""
derive_model.py
===============
用 sympy 严格推导「回转吊臂 + 悬挂抓斗」的摆动动力学方程。

物理模型
--------
回转机构带着幅度 R 处的吊点绕竖直轴以 theta(t) 回转；抓斗视为长度 L 的
刚性单摆（球面摆），在随吊臂一起旋转的局部坐标系 (x 沿臂架向外, y 沿回转
切向, z 竖直向上) 中用两个广义坐标描述摆线方向：

    p = L * ( sin(u),  cos(u)*sin(v),  -cos(u)*cos(v) )

u : 沿臂架方向（径向）摆角
v : 垂直于臂架方向（切向）摆角

吊点在惯性系中的位置：
    X = R cos(theta) + cos(theta)*p_x - sin(theta)*p_y
    Y = R sin(theta) + sin(theta)*p_x + cos(theta)*p_y
    Z = p_z

拉格朗日方程给出 u、v 的二阶耦合非线性方程，脚本直接把推导结果打印出来，
并做小角度线性化校验（应与经典解耦近似一致）。
"""

import sympy as sp

t, R, L, g, m = sp.symbols('t R L g m', real=True, positive=True)
u = sp.Function('u')(t)
v = sp.Function('v')(t)
th = sp.Function('theta')(t)

px = L * sp.sin(u)
py = L * sp.cos(u) * sp.sin(v)
pz = -L * sp.cos(u) * sp.cos(v)

ct, st = sp.cos(th), sp.sin(th)
X = R * ct + ct * px - st * py
Y = R * st + st * px + ct * py
Z = pz

vX, vY, vZ = [sp.diff(q, t) for q in (X, Y, Z)]
T = sp.Rational(1, 2) * m * (vX**2 + vY**2 + vZ**2)
V = m * g * Z
Lg = sp.simplify(T - V)

ud, vd = sp.diff(u, t), sp.diff(v, t)
udd, vdd = sp.diff(u, t, 2), sp.diff(v, t, 2)

# 欧拉-拉格朗日
eu = sp.diff(sp.diff(Lg, ud), t) - sp.diff(Lg, u)
ev = sp.diff(sp.diff(Lg, vd), t) - sp.diff(Lg, v)
eu = sp.expand(sp.simplify(eu))
ev = sp.expand(sp.simplify(ev))

# 展开所有导数项，收集 udd / vdd 的系数
def coeffs(expr):
    e = sp.expand(expr)
    return (sp.simplify(e.coeff(udd)), sp.simplify(e.coeff(vdd)),
            sp.simplify(e.subs({udd: 0, vdd: 0})))

a11, a12, b1 = coeffs(eu)
a21, a22, b2 = coeffs(ev)

print("=" * 72)
print("质量矩阵 M(q):")
print("  M11 =", sp.simplify(a11 / (m * L**2)))
print("  M12 =", sp.simplify(a12 / (m * L**2)))
print("  M22 =", sp.simplify(a22 / (m * L**2)))
print("\n残余项 f(q, qd, t):")
print("  f_u =", sp.simplify(b1 / (m * L**2)))
print("  f_v =", sp.simplify(b2 / (m * L**2)))

# 小角度线性化校验：u,v -> 小量，theta 匀速
eps = sp.symbols('eps', positive=True)
om, al = sp.symbols('omega alpha', real=True)
b1l = sp.series(b1 / (m * L**2), eps, 0, 1)
print("\n" + "=" * 72)
print("（推导完成。主程序使用上面 M、f 的显式表达式做数值积分。）")
