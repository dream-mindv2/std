#!/usr/bin/env python3
"""Run the std.graphics suites against VM, compiler and browser runtime already built.

    run.py --vm VM --compiler dreams.dream --mind build/mind --runtime build-browser
           [--browser] [--graphics-vm build-graphics/bin/dream]

Always: the Dream modules' tests, the page's JavaScript under jsdom, every
example built by `mind build` as its manifest says, and the counter's frontend
run on the Wasm VM under Node.
--browser adds the examples in headless Chromium; --graphics-vm the desktop
webview under Xvfb.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--vm', type=Path, required=True)
parser.add_argument('--compiler', type=Path, required=True)
parser.add_argument('--mind', type=Path, required=True, help='the mind image')
parser.add_argument('--runtime', type=Path, required=True)
parser.add_argument('--browser', action='store_true', help='also run Chromium through Playwright')
parser.add_argument('--graphics-vm', type=Path, help='also run the desktop VM under Xvfb')
args = parser.parse_args()
here = Path(__file__).resolve().parent.parent
workspace = here.parents[2]
vm, compiler, mind, runtime = (p.resolve() for p in (args.vm, args.compiler, args.mind, args.runtime))
# mind runs this compiler on this library, and nothing an installation has.
env = {**os.environ, 'DREAM': str(vm), 'DREAMS': str(compiler), 'MIND_STDLIB': str(here.parents[1])}

def run(*command, **kw):
    subprocess.run([str(p) for p in command], check=True, timeout=600, env=env, **kw)

with tempfile.TemporaryDirectory(prefix='dream-graphics-tests-') as temp:
    temp = Path(temp)
    units = temp / 'units.dream'
    run(vm, compiler, here / 'tests/all.dr', '--test', '-L', f'std={here.parent}', '-o', units)
    run(vm, units)
    for name in ('dom', 'main', 'worker'):
        run('node', here / f'tests/{name}.test.mjs')

    def build(name, project):
        app = temp / name
        run(vm, mind, '-C', project, 'build', '--runtime', runtime, '--output', app)
        return app

    # A test frontend with the test backend: a project of its own, written here.
    def test_app(name):
        project = temp / f'{name}-project'
        project.mkdir()
        (project / 'mind.toml').write_text(f'[package]\nname = "{name}"\nversion = "0.0.0"\n\n[graphics]\n'
                                           f'frontend = "{here / "tests" / name}.dr"\nbackend = "{here / "tests/backend.dr"}"\n')
        return build(name, project)

    examples = here / 'examples'
    counter = build('counter', examples / 'counter')
    for name in ('todo', 'sketch', 'budget'):
        build(name, examples / name)
    # The browser VM's own bridge test belongs to the VM repository.
    vm_tests = workspace / 'dream/browser/test.mjs'
    if vm_tests.is_file():
        run('node', vm_tests, runtime / 'dream-browser.mjs', counter / 'assets/frontend.dream')
    if args.browser:
        run('node', here / 'tests/browser.mjs', temp)
    if args.graphics_vm:
        roundtrip, lifecycle, failure = (test_app(name) for name in ('roundtrip', 'lifecycle', 'failure'))
        run('python3', here / 'tests/native.py', args.graphics_vm.resolve(), roundtrip,
            '--lifecycle', lifecycle, '--failure', failure)
print('Graphics tests passed')
