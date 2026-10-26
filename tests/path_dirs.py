#!/usr/bin/env python3
"""Directory discovery in isolated environments, plus real temporary entries."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dream', default='build-dream/bin/dream')
parser.add_argument('--compiler', default='build/dreams.dream')
args = parser.parse_args()
vm = str(Path(args.dream).resolve())
compiler = str(Path(args.compiler).resolve())
stdlib = Path(__file__).resolve().parents[1]

DISCOVERY = '''
import std.path;
import std.console;
let show! : Option :string -> :unit;
let show! value = console.print! (match value { Option.none => "<none>", Option.some(p) => p });
let main! = {
    show! (path.home! ())
    show! (path.home_dir! ())
    show! (path.data_dir! ())
    show! (path.config_dir! ())
    show! (path.cache_dir! ())
    show! (path.state_dir! ())
    show! (path.runtime_dir! ())
    show! (path.temp_dir! ())
};
'''

TEMP = '''
import std.file;
import std.io;
import std.os;
import std.path;
import std.console;
import std.list;

let check! : :bool -> :unit;
let check! value = if not value { raise! [:test_failed, "temporary entry check failed"] };
let main! = {
    let dir = file.temp_dir! ();
    check! (file.is_dir! dir)
    check! (some (path.dirname dir) == path.temp_dir! ())
    let [name, handle] = io.temp_file! dir "open-";
    check! (io.is_open! handle)
    check! (io.size! handle == 0)
    check! (io.write! handle "hello" == 5)
    io.seek! handle 0
    check! (io.read! handle 5 == "hello")
    io.close! handle
    let child = file.temp_dir_in! dir "space é-";
    let closed = file.temp_file_in! child "closed-";
    let default_file = file.temp_file! ();
    check! (file.read! closed == some "")
    check! (file.read! default_file == some "")
    check! (some (path.dirname default_file) == path.temp_dir! ())
    if os.platform () != :windows {
        check! (io.mode! dir == 448)
        check! (io.mode! child == 448)
        check! (io.mode! name == 384)
        check! (io.mode! closed == 384)
    }
    let children = list.forced (map (fn _ -> spawn! $( file.temp_file_in! dir "parallel-" )) (list.range 0 64));
    let names = list.forced (map (fn process -> join! process) children);
    check! (len (list.unique names) == 64)
    check! (list.all file.is_file! names)
    check! (try! { io.temp_file! (path.join dir "missing") "x"; false } catch _ { true })
    check! (try! { io.temp_dir! name "x"; false } catch _ { true })
    check! (try! { io.temp_file! dir "../escape-"; false } catch _ { true })
    check! (try! { io.temp_dir! dir "nested/name-"; false } catch _ { true })
    check! (try! { io.temp_file! dir "back\\\\slash-"; false } catch _ { true })
    check! (try! { io.temp_dir! dir "drive:"; false } catch _ { true })
    let first_temp = path.temp_dir! ();
    strict! first_temp
    os.set_env! (if os.platform () == :windows { "TEMP" } else { "TMPDIR" }) dir
    check! (path.temp_dir! () == some dir)
    check! (first_temp != some dir)
    file.remove_all! default_file
    file.remove_all! dir
    check! (not (file.is_dir! dir))
    console.print! "temporary entries: ok"
};
'''

DREAM_DISCOVERY = '''
import std.path;
import std.console;
let show! : Option :string -> :unit;
let show! value = console.print! (match value { Option.none => "<none>", Option.some(p) => p });
let main! = {
    show! (path.dream_dir! ())
    show! (path.dream_data_dir! ())
    show! (path.program_data_dir! "my-tool")
};
'''

DREAM_DATA = r'''
import std.path;
import std.file;
import std.io;
import std.error;
import std.console;
import std.list;

let check! : :bool -> :unit;
let check! value = if not value { raise! "program data directory check failed" };
let rejected! : :string -> :bool;
let rejected! name = try! { path.program_data_dir! name; false }
    catch e { error.kind e == :bad_argument };
let required! : Option :string -> :string;
let required! value = Option.expect! "expected a data directory" value;

let main! = {
    let base = required! (path.dream_dir! ());
    let data = required! (path.dream_data_dir! ());
    let program = required! (path.program_data_dir! "my-tool");
    check! (not (io.exists! base))
    check! (not (io.exists! data))
    check! (not (io.exists! program))
    check! (file.ensure_dream_data_dir! () == some data)
    check! (file.is_dir! data)
    check! (not (io.exists! program))
    check! (file.ensure_program_data_dir! "my-tool" == some program)
    check! (file.is_dir! program)
    file.write! (path.join program "saved.txt") "persistent"
    check! (file.ensure_program_data_dir! "my-tool" == some program)
    check! (file.read! (path.join program "saved.txt") == some "persistent")
    let other = required! (file.ensure_program_data_dir! "another-tool");
    check! (other != program && file.is_dir! other)
    check! (file.read! (path.join other "saved.txt") == Option.none)
    let children = list.forced (map (fn _ -> spawn! $( required! (file.ensure_program_data_dir! "concurrent") )) (list.range 0 16));
    let paths = list.forced (map (fn process -> join! process) children);
    check! (len (list.unique paths) == 1)
    check! (file.is_dir! (list.head paths))
    check! (list.all rejected! ["", ".", "..", "../escape", "/absolute", "a/b", "a\\b", "C:x", "bad\0name", ".. ", "name."])
    file.write! (path.join data "occupied") "keep"
    check! (try! { file.ensure_program_data_dir! "occupied"; false } catch _ { true })
    check! (file.read! (path.join data "occupied") == some "keep")
    console.print! "program data directories: ok"
};
'''

DREAM_UNAVAILABLE = '''
import std.file;
import std.console;
let main! = {
    console.print! (file.ensure_dream_data_dir! () == Option.none)
    console.print! (file.ensure_program_data_dir! "my-tool" == Option.none)
};
'''

PROGRAM_DIRS = '''
import std.path;
import std.console;
let show! : Option :string -> :unit;
let show! value = console.print! (match value { Option.none => "<none>", Option.some(p) => p });
let main! = {
    show! (path.program_dir! "mind")
    show! (path.program_dir! "second-tool")
    show! (path.program_dir! "bare")
    show! (path.program_dir! "nested/tool")
    show! (path.program_dir! "directory")
    show! (path.program_dir! "local-only")
    show! (path.program_dir! "missing")
};
'''

keys = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
        'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
        'XDG_RUNTIME_DIR', 'TMPDIR', 'TEMP', 'TMP', 'MINDV2_PATH']
base_env = {k: v for k, v in os.environ.items() if k.upper() not in keys}
windows = sys.platform == 'win32'
macos = sys.platform == 'darwin'
home = 'C:/Users/test' if windows else '/home/test'
none = '<none>'
if windows:
    defaults = [home, home, home + '/AppData/Roaming', home + '/AppData/Roaming',
                home + '/AppData/Local', home + '/AppData/Local', none,
                home + '/AppData/Local/Temp']
elif macos:
    defaults = [home, home, home + '/Library/Application Support',
                home + '/Library/Application Support', home + '/Library/Caches',
                home + '/Library/Application Support', none, '/tmp']
else:
    defaults = [home, home, home + '/.local/share', home + '/.config',
                home + '/.cache', home + '/.local/state', none, '/tmp']

with tempfile.TemporaryDirectory() as scratch:
    scratch = Path(scratch)

    def compile_program(name, source):
        src = scratch / (name + '.dr')
        image = scratch / (name + '.dream')
        src.write_text(source)
        subprocess.run([vm, compiler, '-L', f'std={stdlib}', str(src), '-o', str(image)],
                       check=True, timeout=300)
        return str(image)

    discovery = compile_program('discovery', DISCOVERY)

    def check(label, env, expected):
        result = subprocess.run([vm, discovery], env=base_env | env, check=True,
                                capture_output=True, text=True, timeout=30)
        actual = result.stdout.splitlines()
        assert actual == expected, (label, expected, actual)

    check('defaults', {'HOME': home}, defaults)
    override = ('C:/' if windows else '/') + 'override/space é'
    overrides = {k: override for k in keys if k not in
                 ('HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'MINDV2_PATH')}
    expected = [home, home] + [override] * 6
    if windows:
        expected[6] = none
    elif macos:
        expected[2:6] = defaults[2:6]
    check('overrides', {'HOME': home} | overrides, expected)
    for invalid in ('', 'relative/path', '~/quoted'):
        check('invalid overrides', {'HOME': home} | {k: invalid for k in overrides}, defaults)
    missing = [none] * 8
    if not windows:
        missing[-1] = '/tmp'
    check('no home', {}, missing)
    check('empty home', {'HOME': ''}, missing)
    check('relative home', {'HOME': 'relative'}, missing)
    no_home_overrides = expected.copy()
    no_home_overrides[:2] = [none, none]
    if macos:
        no_home_overrides[2:6] = [none] * 4
    check('overrides without home', overrides, no_home_overrides)
    if windows:
        check('profile wins', {'USERPROFILE': home, 'HOME': 'C:/other'}, defaults)
        check('drive and path', {'HOMEDRIVE': 'C:', 'HOMEPATH': r'\Users\test'}, defaults)
        check('empty profile falls back', {'USERPROFILE': '', 'HOME': home}, defaults)
    temp = compile_program('temp', TEMP)
    temp_env = base_env | {k: str(scratch) for k in ('TMPDIR', 'TEMP', 'TMP')}
    if os.name == 'posix':
        old_umask = os.umask(0)
    try:
        subprocess.run([vm, temp], env=temp_env, check=True, timeout=60)
    finally:
        if os.name == 'posix':
            os.umask(old_umask)
    assert not any(p.name.startswith('dream-') for p in scratch.iterdir())

    dream_discovery = compile_program('dream-discovery', DREAM_DISCOVERY)

    def check_dream(label, env, expected_base, executable=vm):
        result = subprocess.run([executable, dream_discovery], env=base_env | env,
                                cwd=scratch, check=True, capture_output=True,
                                text=True, timeout=30)
        expected = ([none] * 3 if expected_base is None else
                    [expected_base, expected_base + '/data', expected_base + '/data/my-tool'])
        assert result.stdout.splitlines() == expected, (label, expected, result.stdout)

    check_dream('uninstalled home', {'HOME': home, 'MINDV2_PATH': ''}, home + '/.mindv2')
    check_dream('no installation or home', {'MINDV2_PATH': ''}, None)
    check_dream('empty installation override', {'HOME': home, 'MINDV2_PATH': ''}, home + '/.mindv2')
    installed = (scratch / 'installed tools é').as_posix()
    sep = ';' if windows else ':'
    check_dream('explicit installation', {'MINDV2_PATH': installed}, installed)
    check_dream('installation search list', {'MINDV2_PATH': sep + installed + sep + 'ignored'}, installed)
    check_dream('relative installation', {'MINDV2_PATH': 'local-install'}, scratch.as_posix() + '/local-install')
    check_dream('quoted home', {'HOME': home, 'MINDV2_PATH': '~/.mindv2'}, home + '/.mindv2')
    check_dream('quoted home without home', {'MINDV2_PATH': '~/.mindv2'}, None)
    packaged_vm = scratch / 'package/bin' / Path(vm).name
    packaged_vm.parent.mkdir(parents=True)
    shutil.copy2(vm, packaged_vm)
    # Windows resolves the VM and dependency DLLs beside the executable.
    for dll in Path(vm).parent.glob('*.dll'):
        shutil.copy2(dll, packaged_vm.parent / dll.name)
    packaged_base = scratch / 'package/lib/dream'
    packaged_base.mkdir(parents=True)
    check_dream('packaged installation precedes home', {'HOME': home},
                packaged_base.as_posix(), str(packaged_vm))
    check_dream('override precedes packaged installation', {'MINDV2_PATH': installed},
                installed, str(packaged_vm))
    unavailable = compile_program('dream-unavailable', DREAM_UNAVAILABLE)
    result = subprocess.run([vm, unavailable], env=base_env | {'MINDV2_PATH': ''}, check=True,
                            capture_output=True, text=True, timeout=30)
    assert result.stdout.splitlines() == ['true', 'true'], result.stdout
    dream_data = compile_program('dream-data', DREAM_DATA)
    subprocess.run([vm, dream_data], env=base_env | {'MINDV2_PATH': installed},
                   check=True, timeout=60)
    assert (Path(installed) / 'data/my-tool/saved.txt').read_text() == 'persistent'
    assert not (scratch / 'ignored').exists()
    # A named image launched exactly like `dream -x mind` uses this same base.
    (Path(installed) / 'mind.dream').write_bytes(Path(dream_discovery).read_bytes())
    result = subprocess.run([vm, '-x', 'mind'], env=base_env | {'MINDV2_PATH': installed},
                            check=True, capture_output=True, text=True, timeout=30)
    assert result.stdout.splitlines() == [installed, installed + '/data', installed + '/data/my-tool']
    program_dirs = compile_program('program-dirs', PROGRAM_DIRS)
    first = scratch / 'search-first'
    second = scratch / 'search-second'
    (first / 'nested').mkdir(parents=True)
    second.mkdir()
    for target in (first / 'mind.dream', second / 'second-tool.dream',
                   first / 'bare', first / 'nested/tool.dream',
                   second / 'directory.dream', scratch / 'local-only.dream'):
        target.write_bytes(Path(program_dirs).read_bytes())
    # A directory is not an image, even when its name is an earlier match.
    (first / 'directory').mkdir()
    program_env = base_env | {'MINDV2_PATH': str(first) + sep + str(second)}
    expected = [first.as_posix(), second.as_posix(), first.as_posix(),
                (first / 'nested').as_posix(), second.as_posix(), none, none]
    for command in ([vm, program_dirs], [vm, '-x', 'mind'], [vm, '-x', 'second-tool']):
        result = subprocess.run(command, env=program_env, cwd=scratch, check=True,
                                capture_output=True, text=True, timeout=30)
        assert result.stdout.splitlines() == expected, (command, expected, result.stdout)
    result = subprocess.run([vm, program_dirs], env=base_env | {'MINDV2_PATH': ''},
                            cwd=scratch, check=True, capture_output=True, text=True, timeout=30)
    assert result.stdout.splitlines() == [none] * 7, result.stdout

print('directory discovery: ok')
