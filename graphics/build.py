#!/usr/bin/env python3
"""Build a std.graphics application: a Dream frontend, optionally a Dream
backend, and whatever JavaScript, CSS and files the application ships.

    build.py --vm VM --compiler dreams.dream --runtime build-browser \\
             --frontend app.dr [--backend backend.dr] \\
             [--js widget.mjs ..] [--css theme.css ..] [--asset img/ ..] \\
             [--connect https://api.example.com ..] --out DIR

DIR/assets is a static site: serve it and open index.html, or run the whole
application, backend included, with `dream --graphics DIR`. The frontend is
compiled for any VM (it is bytecode), so DIR runs wherever a browser does.

The page's content security policy allows scripts, styles, images, fonts and
media from the application itself, and fetches from its own origin and each
--connect origin -- nothing else. It is written once, into index.html and
csp.txt (which the desktop host also sends as a header), so the two never
disagree. This never downloads tools or modifies the compiler installation.
"""
import argparse
import html
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--vm', type=Path, required=True)
parser.add_argument('--compiler', type=Path, required=True)
parser.add_argument('--runtime', type=Path, required=True, help='browser VM build directory')
parser.add_argument('--frontend', type=Path, required=True)
parser.add_argument('--backend', type=Path, help='a native Dream backend (std.graphics.backend)')
parser.add_argument('--js', type=Path, action='append', default=[], help='an ES module the page imports first')
parser.add_argument('--css', type=Path, action='append', default=[], help='a stylesheet the page links')
parser.add_argument('--asset', type=Path, action='append', default=[], help='a file or directory to ship')
parser.add_argument('--connect', action='append', default=[], help='an origin the page may fetch from')
parser.add_argument('--base', default='./', help="where index.html finds its files: ./ (any directory), or the "
                    "path the application is served at, such as /, so a deep route can be reloaded")
parser.add_argument('-L', dest='libs', action='append', default=[], help='a package directory for the compiler')
parser.add_argument('--out', type=Path, required=True, help='new application directory')
args = parser.parse_args()
here = Path(__file__).resolve().parent
if args.out.exists() or args.out.is_symlink():
    parser.error('output already exists; choose a new directory to avoid overwriting a running image')
inputs = [args.vm, args.compiler, args.frontend, args.runtime / 'dream-browser.mjs',
          args.runtime / 'dream-browser.wasm', *args.js, *args.css]
if args.backend:
    inputs.append(args.backend)
for file in inputs:
    if not file.is_file():
        parser.error(f'file does not exist: {file}')
for asset in args.asset:
    if not asset.exists():
        parser.error(f'asset does not exist: {asset}')
if not re.fullmatch(r'\./|/([A-Za-z0-9._~-]+/)*', args.base):
    parser.error('--base is ./ or an absolute path ending in /, such as /app/')
for origin in args.connect:
    if not re.fullmatch(r'(https?|wss?)://[A-Za-z0-9.-]+(:\d+)?', origin):
        parser.error(f'--connect wants an origin such as https://api.example.com, not {origin!r}')

# The runtime's own files, and the application's, share one directory; an
# application file may not take a runtime file's name.
reserved = {'index.html', 'main.mjs', 'dom.mjs', 'worker.mjs', 'dream-browser.mjs', 'dream-browser.wasm',
            'frontend.dream', 'app.json', 'csp.txt'}
def shipped_name(path):
    if path.name in reserved:
        parser.error(f'{path} would replace the runtime file {path.name}; rename it')
    return path.name

csp = '; '.join([
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "connect-src " + ' '.join(["'self'", *args.connect]),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
])

args.out.parent.mkdir(parents=True, exist_ok=True)
# Publish only a complete application. A failed compile leaves no directory
# that the next build mistakes for an application already in use.
with tempfile.TemporaryDirectory(prefix=f'.{args.out.name}-', dir=args.out.parent) as staging:
    staging = Path(staging)
    assets = staging / 'assets'
    assets.mkdir()
    libs = []
    for lib in [f'std={here.parent}', *args.libs]:
        libs += ['-L', lib]
    base = [str(args.vm.resolve()), str(args.compiler.resolve()), *libs]
    subprocess.run(base + ['--target', 'any', '-o', str(assets / 'frontend.dream'), str(args.frontend.resolve())],
                   check=True, timeout=600)
    if args.backend:
        subprocess.run(base + ['-o', str(staging / 'backend.dream'), str(args.backend.resolve())], check=True, timeout=600)
    for name in ['main.mjs', 'dom.mjs', 'worker.mjs']:
        shutil.copyfile(here / 'web' / name, assets / name)
    for name in ['dream-browser.mjs', 'dream-browser.wasm']:
        shutil.copyfile(args.runtime / name, assets / name)
    scripts = [shipped_name(js) for js in args.js]
    styles = [shipped_name(css) for css in args.css]
    for path in [*args.js, *args.css]:
        shutil.copyfile(path, assets / path.name)
    for asset in args.asset:
        target = assets / shipped_name(asset)
        if asset.is_dir():
            shutil.copytree(asset, target, symlinks=False)
        else:
            shutil.copyfile(asset, target)
    page = (here / 'web' / 'index.html').read_text()
    links = ''.join(f'<link rel="stylesheet" href="{args.base}{html.escape(name)}">' for name in styles)
    page = page.replace('{{csp}}', html.escape(csp)).replace('{{styles}}', links).replace('{{base}}', args.base)
    (assets / 'index.html').write_text(page)
    (assets / 'app.json').write_text(json.dumps({'js': scripts, 'css': styles}, indent=2) + '\n')
    # The desktop host sends the same policy as a header.
    (assets / 'csp.txt').write_text(csp + '\n')
    if args.out.exists() or args.out.is_symlink():
        parser.error('output appeared during the build; choose a new directory')
    staging.rename(args.out)
print(f'Built {args.out}.')
print(f'  in a browser: serve {shlex.quote(str(args.out / "assets"))} and open index.html')
if args.backend:
    print(f'  on the desktop, with its backend: dream --graphics {shlex.quote(str(args.out))}')
else:
    print(f'  on the desktop: dream --graphics {shlex.quote(str(args.out))}')
