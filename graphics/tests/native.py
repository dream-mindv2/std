#!/usr/bin/env python3
"""Exercise the VM's real Linux webview under Xvfb."""
import argparse
import ctypes as C
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('vm', type=Path)
parser.add_argument('roundtrip', type=Path)
parser.add_argument('--lifecycle', type=Path)
parser.add_argument('--failure', type=Path)
args = parser.parse_args()
vm = str(args.vm.resolve())
env = dict(os.environ)
env.pop('DISPLAY', None)
env.pop('WAYLAND_DISPLAY', None)
probe = subprocess.run([vm, '--graphics', str(args.roundtrip.resolve())], env=env,
                       capture_output=True, text=True, timeout=15)
assert probe.returncode != 0 and 'graphics_unavailable' in probe.stderr, probe


def run_app(app):
    try:
        return subprocess.run([vm, '--graphics', str(app.resolve())], env=env,
                              capture_output=True, text=True, timeout=45)
    except subprocess.TimeoutExpired as error:
        raise AssertionError(f'graphics timed out; stdout={error.stdout!r}; stderr={error.stderr!r}') from error


def close_window(display_name, process):
    """Check the requested title/size, then send a real WM_DELETE_WINDOW."""
    x = C.CDLL('libX11.so.6')
    window_t = C.c_ulong
    x.XOpenDisplay.argtypes, x.XOpenDisplay.restype = [C.c_char_p], C.c_void_p
    x.XDefaultRootWindow.argtypes, x.XDefaultRootWindow.restype = [C.c_void_p], window_t
    x.XQueryTree.argtypes = [C.c_void_p, window_t, C.POINTER(window_t), C.POINTER(window_t), C.POINTER(C.POINTER(window_t)), C.POINTER(C.c_uint)]
    x.XFetchName.argtypes = [C.c_void_p, window_t, C.POINTER(C.c_void_p)]
    x.XFree.argtypes = [C.c_void_p]
    x.XGetGeometry.argtypes = [C.c_void_p, window_t, C.POINTER(window_t), C.POINTER(C.c_int), C.POINTER(C.c_int),
                              C.POINTER(C.c_uint), C.POINTER(C.c_uint), C.POINTER(C.c_uint), C.POINTER(C.c_uint)]
    x.XInternAtom.argtypes, x.XInternAtom.restype = [C.c_void_p, C.c_char_p, C.c_int], window_t
    x.XSendEvent.argtypes = [C.c_void_p, window_t, C.c_int, C.c_long, C.c_void_p]
    x.XFlush.argtypes = [C.c_void_p]
    x.XCloseDisplay.argtypes = [C.c_void_p]
    display = x.XOpenDisplay(display_name.encode())
    assert display, 'cannot connect to Xvfb'
    try:
        deadline = time.monotonic() + 30
        found = None
        while time.monotonic() < deadline and process.poll() is None:
            pending = [x.XDefaultRootWindow(display)]
            while pending:
                window = pending.pop()
                name = C.c_void_p()
                if x.XFetchName(display, window, C.byref(name)) and name.value:
                    title = C.string_at(name).decode(errors='replace')
                    x.XFree(name)
                    if title == 'Dream lifecycle test':
                        root, px, py = window_t(), C.c_int(), C.c_int()
                        w, h, border, depth = (C.c_uint() for _ in range(4))
                        x.XGetGeometry(display, window, C.byref(root), C.byref(px), C.byref(py),
                                       C.byref(w), C.byref(h), C.byref(border), C.byref(depth))
                        if (w.value, h.value) == (800, 500):
                            found = window
                            break
                root, parent, count = window_t(), window_t(), C.c_uint()
                children = C.POINTER(window_t)()
                if x.XQueryTree(display, window, C.byref(root), C.byref(parent), C.byref(children), C.byref(count)):
                    pending.extend(children[i] for i in range(count.value))
                    if children: x.XFree(children)
            if found is not None: break
            time.sleep(0.05)
        assert found is not None, 'requested window title and size never appeared'
        class Data(C.Union):
            _fields_ = [('b', C.c_char * 20), ('s', C.c_short * 10), ('l', C.c_long * 5)]
        class ClientMessage(C.Structure):
            _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int),
                        ('display', C.c_void_p), ('window', window_t), ('message_type', window_t),
                        ('format', C.c_int), ('data', Data)]
        class Event(C.Union):
            _fields_ = [('client', ClientMessage), ('padding', C.c_long * 24)]
        event = Event()
        event.client.type = 33  # ClientMessage
        event.client.display = display
        event.client.window = found
        event.client.message_type = x.XInternAtom(display, b'WM_PROTOCOLS', False)
        event.client.format = 32
        event.client.data.l[0] = x.XInternAtom(display, b'WM_DELETE_WINDOW', False)
        assert x.XSendEvent(display, found, False, 0, C.byref(event))
        x.XFlush(display)
    finally:
        x.XCloseDisplay(display)


read_fd, write_fd = os.pipe()
with tempfile.TemporaryDirectory(prefix='dream-graphics-display-') as tmp:
    with open(tmp + '/xvfb.log', 'w+') as log:
        display = subprocess.Popen(['Xvfb', '-displayfd', str(write_fd), '-screen', '0', '1024x768x24', '-nolisten', 'tcp'],
                                   pass_fds=(write_fd,), stdout=log, stderr=log)
        os.close(write_fd)
        try:
            ready, _, _ = select.select([read_fd], [], [], 10)
            assert ready, 'Xvfb did not start'
            number = os.read(read_fd, 64).decode().strip()
            assert number.isdigit(), 'Xvfb did not allocate a display'
            env.update(DISPLAY=':' + number, GDK_BACKEND='x11', LIBGL_ALWAYS_SOFTWARE='1')
            result = run_app(args.roundtrip)
            assert result.returncode == 0, result.stderr
            print('WebKitGTK: headless refusal and Wasm frontend/native Dream backend roundtrip passed')
            if args.failure:
                result = run_app(args.failure)
                assert result.returncode != 0 and 'intentional frontend failure' in result.stderr, result
                print('WebKitGTK: frontend failure stops the VM with an error')
            if args.lifecycle:
                with subprocess.Popen([vm, '--graphics', str(args.lifecycle.resolve())],
                                      env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as app:
                    try:
                        close_window(env['DISPLAY'], app)
                        _, stderr = app.communicate(timeout=10)
                        assert app.returncode == 0, stderr
                        assert 'graphics close cleanup' in stderr, stderr
                        print('WebKitGTK: window title/size and close cleanup through the Dream backend passed')
                    finally:
                        if app.poll() is None: app.kill()
                        app.wait(timeout=10)
        finally:
            os.close(read_fd)
            display.terminate()
            display.wait(timeout=10)
