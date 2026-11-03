"""Protocol regression tests. Loopback only; no browser or external service needed."""
import json
import threading
import time
import unittest

from crane_ws import BridgeServer, RPCError
from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.server = BridgeServer(port=0, page_url='http://127.0.0.1:8765/').start()
        self.url = f'ws://127.0.0.1:{self.server.port}'
        self.clients = []

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.server.stop()

    def client(self, token=None):
        client = connect(self.url, origin='http://127.0.0.1:8765', proxy=None, close_timeout=1)
        self.clients.append(client)
        client.send(json.dumps({'v':1, 'type':'hello', 'token': token or self.server.token}))
        return client

    def authenticate(self):
        client = self.client()
        self.assertEqual(json.loads(client.recv())['type'], 'welcome')
        client.send(json.dumps({'v':1, 'type':'ready', 'capabilities':{}}))
        self.assertTrue(self.server.ready.wait(2))
        return client

    def test_wrong_origin(self):
        with self.assertRaises(InvalidStatus):
            connect(self.url, origin='https://untrusted.invalid', proxy=None)

    def test_wrong_token(self):
        client = self.client('wrong-token')
        with self.assertRaises(ConnectionClosed): client.recv()
        self.assertFalse(self.server.ready.is_set())

    def test_single_browser(self):
        self.authenticate()
        second = self.client()
        with self.assertRaises(ConnectionClosed): second.recv()
        self.assertTrue(self.server.ready.is_set())

    def test_correlates_out_of_order_replies(self):
        client = self.authenticate()
        results = {}
        def call(name): results[name] = self.server.call(name)
        workers = [threading.Thread(target=call, args=(name,)) for name in ['status', 'ping']]
        for worker in workers: worker.start()
        requests = []
        while len(requests) < 2:
            msg = json.loads(client.recv())
            if msg['type'] == 'request': requests.append(msg)
        for msg in reversed(requests):
            client.send(json.dumps({'v':1, 'type':'response', 'id':msg['id'], 'result':msg['method']}))
        for worker in workers: worker.join(2)
        self.assertEqual(results, {'status':'status','ping':'ping'})

    def test_disconnect_fails_pending_and_no_replay(self):
        client = self.authenticate()
        errors = []
        def call():
            try: self.server.call('hoist', 20)
            except RPCError as exc: errors.append(exc.code)
        worker = threading.Thread(target=call)
        worker.start()
        while json.loads(client.recv())['type'] != 'request': pass
        client.close()
        worker.join(2)
        self.assertEqual(errors, ['DISCONNECTED'])
        self.assertFalse(self.server.ready.is_set())
        new = self.authenticate()
        with self.assertRaises(TimeoutError): new.recv(timeout=.2)

    def test_request_timeout_disconnects(self):
        self.authenticate()
        with self.assertRaises(RPCError) as caught:
            self.server.call('slew_rate', 10, timeout=.15)
        self.assertEqual(caught.exception.code, 'TIMEOUT')
        deadline = time.monotonic() + 2
        while self.server.ready.is_set() and time.monotonic() < deadline: time.sleep(.01)
        self.assertFalse(self.server.ready.is_set())


if __name__ == '__main__': unittest.main()
