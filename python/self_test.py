"""Destructive-to-simulation acceptance tests (no external data writes)."""
import math
import time
from crane_ws import Crane, AlgorithmRunner, RPCError


def run_tests(server, log=print, cancelled=None):
    crane = Crane(server, cancelled)
    results = []
    runner = None

    def check(name, condition):
        if cancelled and cancelled.is_set():
            raise RPCError('STOPPED', '自检已停止')
        if not condition:
            raise AssertionError(name)
        results.append(name)
        log('PASS · ' + name)

    def expect_error(method, args, code):
        try:
            server.call(method, *args)
        except RPCError as exc:
            check(method + ' rejects ' + code, exc.code == code)
        else:
            raise AssertionError(method + ' unexpectedly accepted')

    def advance(seconds):
        event = server.wait_state()
        target = event['simTime'] + seconds
        deadline = time.monotonic() + 20
        while event['simTime'] < target:
            if cancelled and cancelled.is_set():
                raise RPCError('STOPPED', '自检已停止')
            if time.monotonic() > deadline:
                raise TimeoutError('仿真没有继续推进')
            event = server.wait_state(event['seq'])
        return event['state']

    def near(value, target, tolerance=.08):
        return abs(value - target) < tolerance

    try:
        manifest = server.call('capabilities')
        required = {'status', 'set', 'slew', 'radius', 'hoist', 'grab', 'travel', 'speed', 'snap', 'slew_rate', 'slew_free', 'seg_name', 'log', 'reset', 'run_script', 'plot', 'mark', 'reset_seg', 'plot_compare', 'clear_plot'}
        check('Python API coverage', required.issubset(manifest['methods']))
        crane.release()
        expect_error('slew', [10], 'NOT_OWNER')
        crane.acquire()
        crane.reset()
        crane.speed(1)
        check('heartbeat RPC', server.call('ping')['active'])
        state = crane.status()
        expected = {'slew', 'alpha', 'radius', 'hoist', 'grab', 'load', 'holdLevel', 'holdRemain', 'swayX', 'swayZ', 'swayVX', 'swayVZ', 'swayMag', 'travel', 'truckLoad', 'grabPos'}
        check('complete state and units', set(state) == expected and manifest['units']['swayX'] == 'rad')
        check('finite state', all(math.isfinite(v) for k, v in state.items() if k != 'grabPos'))
        crane.slew(12)
        crane.radius(27)
        crane.hoist(15)
        crane.grab(.8)
        crane.travel(2)
        crane.snap()
        state = crane.status()
        check('all five axes + snap', all(near(state[k], v) for k, v in {'slew': 12, 'radius': 27, 'hoist': 15, 'grab': .8, 'travel': 2}.items()))
        for name, value in [('slew', -10), ('radius', 28), ('hoist', 16), ('grab', .2), ('travel', -2), ('alpha', 45)]:
            crane.set(name, value)
            crane.snap()
            check('generic set ' + name, near(crane.status()[name], value))
        crane.grab(2)
        crane.travel(100)
        crane.hoist(100)
        crane.snap()
        state = crane.status()
        check('physical clamps', state['grab'] == 1 and state['travel'] <= 26 and state['hoist'] <= 26.1)
        expect_error('set', ['invalid', 1], 'INVALID_PARAMS')
        expect_error('set', ['hoist', 'bad'], 'INVALID_PARAMS')
        expect_error('plot', [['missing_field']], 'INVALID_PARAMS')
        expect_error('seg_name', ['invalid', 4], 'INVALID_PARAMS')
        expect_error('snap', [1], 'INVALID_PARAMS')
        expect_error('__proto__', [], 'METHOD_NOT_FOUND')
        expect_error('run_script', ['invalid command'], 'SCRIPT_ERROR')
        try:
            crane.hoist(float('nan'))
            raise AssertionError('NaN accepted')
        except ValueError:
            check('NaN rejected in SDK', True)
        crane.reset()
        crane.hoist(15)
        crane.radius(27)
        crane.snap()
        crane.slew_rate(5)
        before = crane.status()['slew']
        after = advance(2)['slew']
        check('slew velocity moves simulation', after > before + 1)
        crane.slew_free()
        before = crane.status()['slew']
        check('slew_free holds angle', near(advance(.5)['slew'], before, .15))
        crane.speed(2)
        crane.clear_plot()
        crane.reset_seg()
        crane.seg_name('基线', 0)
        advance(.5)
        check('mark returns segment', crane.mark('算法') == 1)
        crane.seg_name('反馈算法')
        advance(.5)
        records = crane.records()
        check('recording and named segments', len(records['samples']) > 2 and {r['seg'] for r in records['samples']} == {0, 1} and records['names'][1] == '反馈算法')
        check('plot', 'chart' in crane.plot(['hoist', 'load']))
        check('plot_compare', 'compare' in crane.plot_compare(['swayX', 'swayZ']))
        crane.log('WebSocket', '自检', 1)
        check('log', True)
        crane.run_script('速度 2\n回转 15\n起升 14\n等待 0.1')
        advance(8)
        check('script engine', near(crane.status()['slew'], 15, 1.1))
        crane.release()
        runner = AlgorithmRunner(server, log)
        runner.start('''
elapsed = 0
def setup():
    crane.speed(1)
    crane.slew(0)
    crane.hoist(14)
    crane.snap()
def control(dt):
    global elapsed
    elapsed += dt
    crane.slew(min(20, elapsed * 8))
    crane.status()
''')
        deadline = time.monotonic() + 10
        while runner.ticks < 6 and not runner.error and time.monotonic() < deadline and not (cancelled and cancelled.is_set()):
            time.sleep(.05)
        runner.stop()
        runner.thread.join(6)
        check('local setup/control(dt) algorithm', runner.ticks >= 6 and not runner.error and not runner.running)
        expect_error('hoist', [15], 'NOT_OWNER')
        crane.acquire()
        crane.slew_rate(12)
        advance(.4)
        crane.release()
        before = crane.status()
        after = advance(.5)
        check('release stops all remote motion', near(before['slew'], after['slew'], .02))
        crane.acquire()
        crane.speed(1)
        crane.reset()
        crane.snap()
        check('reset cargo and sway', crane.status()['load'] == 0 and crane.status()['holdRemain'] == 1 and crane.status()['swayMag'] < .001)
        crane.clear_plot()
        check('clear_plot', len(crane.records()['samples']) < 5)
        crane.release()
        return results
    finally:
        if runner and runner.running:
            runner.stop()
        if server.ready.is_set():
            try:
                server.call('release')
            except Exception:
                pass
