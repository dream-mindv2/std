#!/usr/bin/env python3
"""Serve a built std.graphics application to a browser, for development.

    serve.py APP_DIR [--port 8000]

APP_DIR is what build.py made; its assets/ is served at the root, with the
types a browser insists on (`.mjs` as JavaScript, `.wasm` as WebAssembly), and
any path without an extension answered with index.html, so an application's
routes can be reloaded. Nothing outside assets/ is served, and only on this
machine unless --host says otherwise. A real deployment is any static host
configured the same way.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import posixpath

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('app', type=Path)
parser.add_argument('--port', type=int, default=8000)
parser.add_argument('--host', default='127.0.0.1')
args = parser.parse_args()
assets = (args.app / 'assets').resolve()
if not (assets / 'index.html').is_file():
    parser.error(f'{args.app} is not an application build.py made (no assets/index.html)')


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.js': 'text/javascript',
                      '.wasm': 'application/wasm', '.json': 'application/json', '.dream': 'application/octet-stream'}

    def send_head(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if not posixpath.splitext(path)[1]:
            self.path = '/index.html'
        return super().send_head()

    def end_headers(self):
        # A rebuild is seen on the next reload.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(assets)))
print(f'Serving {assets} at http://{args.host}:{server.server_address[1]}/  (Ctrl-C stops)', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
