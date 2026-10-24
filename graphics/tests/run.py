#!/usr/bin/env python3
"""Run the std.graphics suites against VM, compiler and browser runtime already built.

    run.py --vm VM --compiler dreams.dream --runtime build-browser
           [--browser] [--graphics-vm build-graphics/bin/dream]

Always: the Dream modules' tests, the page's JavaScript under jsdom, every
example built by build.py, and each frontend run on the Wasm VM under Node.
--browser adds the examples in headless Chromium; --graphics-vm the desktop
webview under Xvfb.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--vm', type=Path, required=True)
parser.add_argument('--compiler', type=Path, required=True)
parser.add_argument('--runtime', type=Path, required=True)
parser.add_argument('--browser', action='store_true', help='also run Chromium through Playwright')
parser.add_argument('--graphics-vm', type=Path, help='also run the desktop VM under Xvfb')
args = parser.parse_args()
here = Path(__file__).resolve().parent.parent
workspace = here.parents[2]
vm, compiler, runtime = (p.resolve() for p in (args.vm, args.compiler, args.runtime))

def run(*command, **kw):
    subprocess.run([str(p) for p in command], check=True, timeout=600, **kw)

with tempfile.TemporaryDirectory(prefix='dream-graphics-tests-') as temp:
    temp = Path(temp)
    units = temp / 'units.dream'
    run(vm, compiler, here / 'tests/all.dr', '--test', '-L', f'std={here.parent}', '-o', units)
    run(vm, units)
    for name in ('dom', 'main', 'worker'):
        run('node', here / f'tests/{name}.test.mjs')

    def build(name, frontend, *extra):
        app = temp / name
        run('python3', here / 'build.py', '--vm', vm, '--compiler', compiler, '--runtime', runtime,
            '--frontend', frontend, '--out', app, *extra)
        return app

    examples = here / 'examples'
    counter = build('counter', examples / 'counter/frontend.dr', '--backend', examples / 'counter/backend.dr')
    build('todo', examples / 'todo/frontend.dr', '--js', examples / 'todo/widgets.mjs', '--css', examples / 'todo/todo.css')
    build('sketch', examples / 'sketch/frontend.dr')
    build('budget', examples / 'budget/frontend.dr')
    # The browser VM's own bridge test belongs to the VM repository.
    vm_tests = workspace / 'dream/browser/test.mjs'
    if vm_tests.is_file():
        run('node', vm_tests, runtime / 'dream-browser.mjs', counter / 'assets/frontend.dream')
    if args.browser:
        run('node', here / 'tests/browser.mjs', temp)
    if args.graphics_vm:
        roundtrip = build('roundtrip', here / 'tests/roundtrip.dr', '--backend', here / 'tests/backend.dr')
        lifecycle = build('lifecycle', here / 'tests/lifecycle.dr', '--backend', here / 'tests/backend.dr')
        failure = build('failure', here / 'tests/failure.dr', '--backend', here / 'tests/backend.dr')
        run('python3', here / 'tests/native.py', args.graphics_vm.resolve(), roundtrip,
            '--lifecycle', lifecycle, '--failure', failure)
print('Graphics tests passed')
