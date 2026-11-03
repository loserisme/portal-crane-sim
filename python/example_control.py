"""可直接粘贴到 GUI 或网页 Python 面板的双向摆角反馈示例。"""
import math
t = 0.0

def setup():
    crane.speed(1)
    crane.slew(0)
    crane.radius(27)
    crane.hoist(15)
    crane.grab(0)
    crane.snap()
    crane.seg_name('本地反馈控制', 0)

def control(dt):
    global t
    t += dt
    state = crane.status()
    correction = max(-3, min(3, -1.8 * state['swayZ'] - .55 * state['swayVZ']))
    crane.slew(20 * math.sin(t / 5) + correction)
