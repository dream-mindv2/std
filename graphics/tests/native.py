#!/usr/bin/env python3
"""Exercise a real Linux webview under Xvfb with the roundtrip.dr frontend."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

host, vm, app = map(lambda p: str(Path(p).resolve()), sys.argv[1:])
env = dict(os.environ)
env.pop('DISPLAY', None)
env.pop('WAYLAND_DISPLAY', None)
probe = subprocess.run([host, app + '/assets', vm, app + '/backend.dream'], env=env,
                       capture_output=True, text=True, timeout=15)
assert probe.returncode != 0 and 'graphics_unavailable' in probe.stderr, probe
read_fd, write_fd = os.pipe()
with tempfile.TemporaryDirectory(prefix='dream-graphics-display-') as tmp:
    with open(tmp + '/xvfb.log', 'w+') as log:
        display = subprocess.Popen(['Xvfb', '-displayfd', str(write_fd), '-screen', '0', '1024x768x24', '-nolisten', 'tcp'],
                                   pass_fds=(write_fd,), stdout=log, stderr=log)
        os.close(write_fd)
        try:
            import select
            ready, _, _ = select.select([read_fd], [], [], 10)
            assert ready, 'Xvfb did not start'
            number = os.read(read_fd, 64).decode().strip()
            assert number.isdigit(), 'Xvfb did not allocate a display'
            env.update(DISPLAY=':' + number, GDK_BACKEND='x11', LIBGL_ALWAYS_SOFTWARE='1')
            result = subprocess.run([host, app + '/assets', vm, app + '/backend.dream'],
                                    env=env, capture_output=True, text=True, timeout=45)
            assert result.returncode == 0, result.stderr
            print('WebKitGTK: headless refusal and full Wasm frontend/native Dream backend roundtrip passed')
        finally:
            os.close(read_fd)
            display.terminate()
            display.wait(timeout=10)
