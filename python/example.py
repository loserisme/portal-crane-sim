"""Headless use of the same SDK. python example.py then open the printed URL."""
from crane_ws import BridgeServer, Crane, AlgorithmRunner

with open(__file__.replace('example.py', 'example_control.py'), encoding='utf-8') as handle:
    code = handle.read()
server = BridgeServer(log=print).start()
try:
    print('在浏览器打开以下配对地址（包含临时口令，请勿分享）：\n' + server.pairing_url())
    if not server.ready.wait(120):
        raise TimeoutError('等待网页连接超时')
    runner = AlgorithmRunner(server)
    runner.start(code)
    input('按回车停止算法并断开连接。\n')
    runner.stop()
finally:
    server.stop()
