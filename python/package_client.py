"""Rebuild the downloadable source client without dependencies, keys, or test output."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
destination = root / 'downloads' / 'crane-python-client.zip'
destination.parent.mkdir(exist_ok=True)
files = ['crane_ws.py', 'gui.py', 'self_test.py', 'test_transport.py', 'example.py',
         'example_control.py', 'requirements.txt', 'run_gui.cmd']
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / 'python' / name, 'crane-python-client/' + name)
    archive.write(root / 'docs' / 'websocket.md', 'crane-python-client/README.md')
print(destination.name)
