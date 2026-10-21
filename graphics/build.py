#!/usr/bin/env python3
"""Build Dream frontend/backend bytecode and assemble explicit web assets.

The native host and browser VM are separate build products. This command does
not download tools or modify the compiler installation.
"""
import argparse
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--vm', type=Path, required=True)
parser.add_argument('--compiler', type=Path, required=True)
parser.add_argument('--runtime', type=Path, required=True, help='browser VM build directory')
parser.add_argument('--frontend', type=Path, required=True)
parser.add_argument('--backend', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True, help='new application directory')
args = parser.parse_args()
here = Path(__file__).resolve().parent
if args.out.exists():
    parser.error('output already exists; choose a new directory to avoid overwriting a running image')
for file in [args.vm, args.compiler, args.frontend, args.backend,
             args.runtime / 'dream-browser.mjs', args.runtime / 'dream-browser.wasm']:
    if not file.is_file():
        parser.error(f'file does not exist: {file}')
args.out.mkdir(parents=True)
assets = args.out / 'assets'
assets.mkdir()
base = [str(args.vm.resolve()), str(args.compiler.resolve()), '-L', f'std={here.parent}']
subprocess.run(base + ['--host-module', 'dream.graphics.bridge', '--target', 'any', '-o',
                      str(assets / 'frontend.dream'), str(args.frontend.resolve())], check=True, timeout=300)
subprocess.run(base + ['-o', str(args.out / 'backend.dream'), str(args.backend.resolve())], check=True, timeout=300)
for name in ['index.html', 'main.mjs', 'dom.mjs', 'worker.mjs']:
    shutil.copyfile(here / 'web' / name, assets / name)
for name in ['dream-browser.mjs', 'dream-browser.wasm']:
    shutil.copyfile(args.runtime / name, assets / name)
print(f'Built {args.out}; launch with dream-graphics-host {assets} {args.vm} {args.out / "backend.dream"}')
