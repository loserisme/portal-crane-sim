"""Local WebSocket bridge and synchronous Python SDK for the browser simulator.

Python hosts the loopback server; the static website connects as the simulation
endpoint. No Python code is accepted from the network. See docs/websocket.md.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import secrets
import sys
import threading
import time
from urllib.parse import urlencode, urlsplit, urlunsplit

deps = Path(__file__).with_name('.deps')
if deps.is_dir():
    sys.path.insert(0, str(deps))
try:
    from websockets.sync.server import serve
    from websockets.exceptions import ConnectionClosed
except ImportError as exc:
    raise SystemExit('请先执行：python -m pip install -r requirements.txt') from exc


class RPCError(RuntimeError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(f'{code}: {message}')


class BridgeServer:
    """One authenticated browser session, bounded requests, no command replay."""
    def __init__(self, port=8766, page_url='https://loserisme.github.io/portal-crane-sim/', log=None):
        self.port = port
        self.page_url = page_url
        self.token = secrets.token_urlsafe(32)
        self.log = log or (lambda message: None)
        self.ready = threading.Event()
        self.closed = threading.Event()
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.send_lock = threading.Lock()
        self.pending = {}
        self.connection = None
        self.server = None
        self.latest = None
        self.capabilities = None
        self.serial = 0

    def start(self):
        url = urlsplit(self.page_url)
        if url.scheme not in ('http', 'https') or not url.netloc or url.username or url.password:
            raise ValueError('页面地址必须是 http(s) URL')
        origin = f'{url.scheme}://{url.netloc}'
        self.server = serve(self._handle, '127.0.0.1', self.port,
                            origins=[origin], max_size=2**20, max_queue=16,
                            open_timeout=4, close_timeout=1, compression=None)
        self.port = self.server.socket.getsockname()[1]
        self.closed.clear()
        threading.Thread(target=self.server.serve_forever, daemon=True, name='ws-listener').start()
        threading.Thread(target=self._heartbeat, daemon=True, name='ws-heartbeat').start()
        self.log(f'服务已启动：ws://127.0.0.1:{self.port}')
        return self

    def pairing_url(self):
        url = urlsplit(self.page_url)
        fragment = urlencode({'ws': f'ws://127.0.0.1:{self.port}', 'token': self.token})
        return urlunsplit((url.scheme, url.netloc, url.path, url.query, fragment))

    def _send(self, connection, message):
        payload = json.dumps(message, ensure_ascii=False, allow_nan=False)
        with self.send_lock:
            connection.send(payload)

    def _handle(self, connection):
        owned = False
        try:
            hello = json.loads(connection.recv(timeout=4))
            if not isinstance(hello, dict) or hello.get('v') != 1 or hello.get('type') != 'hello' or not isinstance(hello.get('token'), str) or not secrets.compare_digest(hello['token'], self.token):
                connection.close(4001, 'authentication failed')
                return
            with self.lock:
                if self.connection is not None:
                    connection.close(4002, 'one simulation per server')
                    return
                self.connection = connection
                self.latest = None
                owned = True
            self._send(connection, {'v': 1, 'type': 'welcome'})
            # Authentication doesn't imply readiness: wait for the browser API manifest.
            reply = json.loads(connection.recv(timeout=4))
            if not isinstance(reply, dict) or reply.get('v') != 1 or reply.get('type') != 'ready':
                raise ValueError('invalid ready message')
            self.capabilities = reply.get('capabilities', {})
            self.ready.set()
            self.log('仿真页面已连接，等待接管')
            for raw in connection:
                msg = json.loads(raw)
                if not isinstance(msg, dict) or msg.get('v') != 1:
                    raise ValueError('invalid protocol')
                with self.condition:
                    if msg.get('type') == 'response':
                        pending = self.pending.get(msg.get('id'))
                        if pending:
                            pending['reply'] = msg
                            pending['event'].set()
                    elif msg.get('type') == 'event' and msg.get('event') == 'state':
                        self.latest = msg
                        self.condition.notify_all()
                    elif msg.get('type') == 'event' and msg.get('event') == 'released':
                        if self.latest:
                            self.latest = dict(self.latest, active=False)
                        self.condition.notify_all()
                        self.log('控制已停止：' + str(msg.get('reason', '')))
        except (ConnectionClosed, TimeoutError, ValueError, TypeError):
            pass
        finally:
            if owned:
                with self.condition:
                    if self.connection is connection:
                        self.ready.clear()
                        self.connection = None
                        self.latest = None
                        for pending in self.pending.values():
                            pending['reply'] = {'error': {'code': 'DISCONNECTED', 'message': '连接中断，指令不会自动重发'}}
                            pending['event'].set()
                        self.condition.notify_all()
                self.log('仿真页面已断开')

    def _heartbeat(self):
        while not self.closed.wait(1):
            with self.lock:
                connection = self.connection if self.ready.is_set() else None
            if connection:
                try:
                    self._send(connection, {'v': 1, 'type': 'ping'})
                except ConnectionClosed:
                    pass

    def call(self, method, *params, timeout=5):
        # Serialize before registering a request: reject NaN rather than poisoning simulation state.
        json.dumps(params, allow_nan=False)
        with self.lock:
            if not self.ready.is_set() or not self.connection:
                raise RPCError('DISCONNECTED', '请先连接仿真页面')
            if len(self.pending) >= 64:
                raise RPCError('BUSY', '未完成请求过多')
            self.serial += 1
            request_id = str(self.serial)
            connection = self.connection
            pending = {'event': threading.Event(), 'reply': None}
            self.pending[request_id] = pending
        try:
            self._send(connection, {'v': 1, 'type': 'request', 'id': request_id, 'method': method, 'params': list(params)})
            if not pending['event'].wait(timeout):
                # An uncertain command must not leave the machine under remote control.
                connection.close(4000, 'request timed out')
                raise RPCError('TIMEOUT', '请求超时，连接已关闭；不会重放指令')
            reply = pending['reply']
            if 'error' in reply:
                raise RPCError(reply['error']['code'], reply['error']['message'])
            return reply.get('result')
        finally:
            with self.lock:
                self.pending.pop(request_id, None)

    def wait_state(self, after=-1, timeout=5):
        deadline = time.monotonic() + timeout
        with self.condition:
            while True:
                if not self.ready.is_set():
                    raise RPCError('DISCONNECTED', '仿真页面未连接')
                if self.latest and self.latest['seq'] > after:
                    return self.latest.copy()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RPCError('TIMEOUT', '没有收到新状态，请保持网页可见')
                self.condition.wait(remaining)

    def stop(self):
        if self.closed.is_set():
            return
        self.closed.set()
        if self.connection:
            self.connection.close(1001, 'Python application closed')
        if self.server:
            self.server.shutdown()
            self.server = None
        self.ready.clear()


class Crane:
    """Matches the browser crane object. Angles slew/alpha in degrees; sway in radians."""
    def __init__(self, server, cancelled=None):
        self.server = server
        self.cancelled = cancelled

    def _call(self, method, *params):
        if self.cancelled and self.cancelled.is_set():
            raise RPCError('STOPPED', '算法已停止')
        return self.server.call(method, *params)

    def acquire(self): return self._call('acquire')
    def release(self): return self._call('release')
    def status(self): return self._call('status')
    def set(self, name, value): return self._call('set', name, float(value))
    def slew(self, deg): return self._call('slew', float(deg))
    def radius(self, m): return self._call('radius', float(m))
    def hoist(self, m): return self._call('hoist', float(m))
    def grab(self, v): return self._call('grab', float(v))
    def travel(self, m): return self._call('travel', float(m))
    def speed(self, x): return self._call('speed', float(x))
    def snap(self): return self._call('snap')
    def slew_rate(self, dps): return self._call('slew_rate', float(dps))
    def slew_free(self): return self._call('slew_free')
    def seg_name(self, name, i=None): return self._call('seg_name', str(name), i)
    def log(self, *a): return self._call('log', ' '.join(str(x) for x in a))
    def reset(self): return self._call('reset')
    def run_script(self, code): return self._call('run_script', str(code))
    def plot(self, keys=None): return self._call('plot', keys or ['hoist', 'load'])
    def mark(self, name=None): return self._call('mark', name)
    def reset_seg(self): return self._call('reset_seg')
    def plot_compare(self, keys=None): return self._call('plot_compare', keys or ['swayMag'])
    def clear_plot(self): return self._call('clear_plot')
    def records(self): return self._call('records')


class AlgorithmRunner:
    """Run local, user-authored setup/control code off the Tk event loop.

    Network state ticks drive dt (simulation seconds). Calls after Stop are rejected;
    arbitrary local Python is trusted code, not a security sandbox.
    """
    def __init__(self, server, log=print):
        self.server, self.log = server, log
        self.cancelled = threading.Event()
        self.thread = None
        self.error = None
        self.ticks = 0

    @property
    def running(self):
        return self.thread is not None and self.thread.is_alive()

    def start(self, code):
        if self.running:
            raise RuntimeError('上一段算法仍未退出，请等待或重启客户端')
        compiled = compile(code, '<local algorithm>', 'exec')
        self.cancelled.clear()
        self.error, self.ticks = None, 0

        def run():
            crane = Crane(self.server, self.cancelled)
            acquired = False
            try:
                crane.acquire()
                acquired = True
                crane.clear_plot()
                crane.reset_seg()
                def output(*args, **kwargs):
                    self.log(kwargs.get('sep', ' ').join(str(a) for a in args))
                env = {'crane': crane, 'print': output, '__name__': '__main__'}
                exec(compiled, env)
                control = env.get('control')
                if not callable(control):
                    raise ValueError('请定义 control(dt) 函数')
                if callable(env.get('setup')):
                    env['setup']()
                event = self.server.wait_state()
                while not self.cancelled.is_set():
                    next_event = self.server.wait_state(event['seq'])
                    if not next_event['active']:
                        raise RPCError('NOT_OWNER', '页面已停止远程控制')
                    dt = next_event['simTime'] - event['simTime']
                    event = next_event
                    if not math.isfinite(dt) or dt < 0:
                        raise RPCError('INVALID_STATE', '仿真时间不连续')
                    control(dt)
                    self.ticks += 1
            except Exception as exc:
                if not self.cancelled.is_set():
                    self.error = str(exc)
                    self.log('算法停止：' + self.error)
            finally:
                if acquired and self.server.ready.is_set():
                    try:
                        self.server.call('release')
                    except Exception:
                        pass

        self.thread = threading.Thread(target=run, daemon=True, name='local-algorithm')
        self.thread.start()

    def stop(self):
        self.cancelled.set()
        if self.server.ready.is_set():
            self.server.call('release')
