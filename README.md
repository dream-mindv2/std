# std

**The standard library for [Dream](https://github.com/dream-mindv2/dreams)**, a
lazily evaluated functional language. Every Dream program can import it, and
[`mind`](https://github.com/dream-mindv2/mind) puts it on the search path by
itself (`$MIND_STDLIB`, or the installation's copy). Calling the compiler
directly, pass `-L` with the directory that holds this one, or `-L std=PATH`
naming it. It has two layers:

**Its documentation is at [dream-mindv2.github.io/std](https://dream-mindv2.github.io/std/)**, rebuilt on
every push.

- **Native modules**, written in C++ in the [VM](https://github.com/dream-mindv2/dream/blob/main/README.md#native-modules):
  `std.io`, `std.os`, `std.net`, `std.tls`, `std.ffi`, `std.math`,
  `std.crypto`, `std.tensor`, `std.vm`. These are the edges of the machine:
  handles and bytes, processes, sockets, C.
- **Dream modules**, here, written on top of them and compiled like any
  other package.

[dream/docs/builtins.md](https://github.com/dream-mindv2/dream/blob/main/docs/builtins.md) is the reference for both,
and every module documents itself: `mind docs` in this directory builds the
reference as a site, every example in it run.

## Documents

| | |
|---|---|
| [docs/build.md](docs/build.md) | build scripts and `std.build`: plans, steps, caching, goals, checks, and C/C++ with any compiler |
| [docs/console.md](docs/console.md) | `std.console`: output, prompts, formatting, colour and logging |
| [docs/binary.md](docs/binary.md) | `std.binary`: custom binary layouts, integers, floats, bit fields, bounds, and IO |
| [docs/widgets.md](docs/widgets.md) | `std.graphics.widgets`: interfaces of screens, cards, buttons, fields, tabs, tables and dialogs, finished as written -- no HTML, CSS or JavaScript |
| [docs/graphics.md](docs/graphics.md) | `std.graphics`: user interfaces in Dream -- HTML, CSS and canvas as values, run in a browser or a desktop window, with JavaScript and CSS of an application's own beside them |
| [docs/notes/ml.md](docs/notes/ml.md) | the design behind `std.ml`: autodiff, layers, losses, optimizers, datasets |
| [src/sql/pg/README.md](src/sql/pg/README.md) | the PostgreSQL client |

## Use std, and do not repeat it

The language's primitives are builtins spelled with a leading underscore --
`_list_cons`, `_str_slice`, `_data_at` -- and they are this library's to call.
Everything else calls the function here that wraps each one (`list.cons`,
`str.slice`, `payload.at`), which compiles to the same opcode; naming a
primitive outside `std` is a warning. The same goes for shapes: a result is
`Result.ok v` or `Result.error why` with `std.result` to handle it, a long-lived
process is a `std.server`, an option parser is `std.cli`. A program that
grows its own version of one of these is a program the next reader has to
learn.

## The modules

**Data**

| | |
|---|---|
| `list` | lists, lazy in head and tail; the combinators deforestation fuses into loops |
| `array` | flat sequences with constant-time indexing, `#[a, b, c]` |
| `map` | hash tries: `%{ k => v }` and the operations they make cheap |
| `str` | UTF-8 strings, character by character |
| `char`, `atom`, `num` | characters and code points, atoms by name, numbers to and from text |
| `seq` | the generic half: everything a container gets once it can `fold` |
| `dynamic` | the sequence operations, choosing list, array or string at run time |
| `result` | `Result.ok value` and `Result.error reason`, and what to do with them |
| `error` | an error's kind and payload, and errors of your own |
| `types` | optional type descriptions as values: `accepts`, `check`, `enforce` |

**Formats**

| | |
|---|---|
| `codec` | the generic half: everything a format gets once it can spell a value |
| `json` | JSON, parsed and rendered |
| `wire` | every Dream value, exactly, as bytes |
| `binary`, `binary.word`, `binary.io` | checked binary layouts, fixed-width word operations and transport adapters ([guide](docs/binary.md)) |
| `record` | records on a wire: a declared value's named form, and the way back |
| `toml` | the TOML `mind.toml` uses |
| `version` | versions, and which versions a requirement accepts (`^1.2`, `>=0.3, <0.5`) |

**Processes**

| | |
|---|---|
| `proc` | the shapes `spawn!`, `send!`, `recv!` and `join!` leave to the caller |
| `progress` | a progress bar on the terminal, and nothing anywhere else; `join_all!` over processes |
| `server` | a process that holds state and answers questions -- a `gen_server` |
| `agent` | a server whose whole job is to hold one value |
| `supervisor` | children started together and restarted when they die |
| `registry` | a name that means whichever process answers to it now |
| `remote` | the same server, over a socket |

**The outside world**

| | |
|---|---|
| `console` | printing, prompts, formatting, colour and logging, over `std.io` |
| `graphics`, `.widgets`, `.html`, `.css`, `.canvas`, `.browser`, `.backend` | user interfaces: a model, typed messages and a view; a widget kit with its own design ([widgets](docs/widgets.md)); elements, stylesheets and drawing as values; the page's effects; a native backend's commands ([guide](docs/graphics.md)) |
| `path` | paths as text, POSIX's and Windows' rules both: drives, shares, `dirname`, extensions, `normalize`, `relative` ([below](#paths)) |
| `file` | whole files, and the directories they go in |
| `streams` | writing all of a string through a writer that may take less |
| `cli` | command lines: one description of an option, read, checked and printed as usage |
| `foreign` | wrapping a C library on `std.ffi`; what the `foreign` declaration builds on ([dream/docs/ffi.md](https://github.com/dream-mindv2/dream/blob/main/docs/ffi.md)) |
| `payload` | the files an image carries (`[payload]` in `mind.toml`, `dreams --payload`), by index or by name |
| `sql` | SQL for any database: fragments, query builders, dialects, a pool, and SQLite |
| `sql.pg` | a PostgreSQL client in pure Dream ([README](src/sql/pg/README.md)) |

**Machine learning** ([docs/notes/ml.md](docs/notes/ml.md))

| | |
|---|---|
| `ml` | `fit!`, `predict`, `classify`, `evaluate`, `save!` and `load!`: the training loop, on the GPU when it pays |
| `ml.ad` | reverse-mode autodiff of any function of tensors and numbers |
| `ml.nn` | layers and models: dense, conv2d and pooling, attention and transformer blocks, RNN/GRU/LSTM, embeddings, norms, dropout |
| `ml.loss`, `ml.metrics` | what training minimizes, and what is reported |
| `ml.optim` | SGD, Adam, AdamW, RMSProp, Adagrad, clipping, learning-rate schedules |
| `ml.data` | datasets: batches, shuffles, splits and folds, scalers, CSV, synthetic sets |
| `ml.init`, `ml.tree`, `ml.ops` | initial weights, parameter trees, and the tensor compositions the rest share |

**Writing programs**

| | |
|---|---|
| `test` | the test framework: each case in its own process |
| `macros` | syntax conveniences called with `expand macros.name ...` |
| `debug` | where the time goes and where the memory goes, in a running program |
| `build` | what a package's `build.dr` is written in; `build.cc` builds C and C++ with GCC, Clang, MSVC or CMake ([docs/build.md](docs/build.md)) |
| `all` | every module, so that `--test` collects every module's tests |

## Options: a record with a default for every field

A function with more than a couple of settings takes them as one `mapping`
whose fields all have defaults, named after what it configures --
`ml.Fit`, `optim.Adam`, `nn.Dense`, `sql.Transaction`, `sqlite.Options`,
`http.server.Options`, `property.Options` -- beside a short form that uses
the defaults (`fit!`/`adam`/`dense`, `serve!`, `check`). The caller says only
what changes, as a chain of the setters the declaration generates:

```dream
ml.fit! model ds (ml.Fit.new () |> ml.Fit.set_epochs 50 |> ml.Fit.set_metrics [:accuracy])
sql.transaction_with! db (sql.Transaction.new () |> sql.Transaction.set_isolation :serializable) work
```

or as a map of just those keys, `%{ :epochs => 50 }`, which is the same
value: reading a field a `mapping` has not got answers its default. Both are
checked where they are written -- `ml.Fit.set_epochs "ten"`,
`%{ :epochs => "ten" }` and the misspelled `%{ :epoch => 50 }` are compile
errors -- and a default costs nothing where it is not used, since an
accessor is the one `c.[k else d]` opcode.

A default is an expression like any other, and may name what the file
around the record can: `optimizer : optim.Optimizer = optim.adam 0.001`. It
is computed once, when first read. What stays `()` is a setting that is
genuinely absent -- no validation set, no patience -- or one whose default
depends on another field, as `nn.Dense`'s weight initializer depends on the
activation; the field's comment says what `()` stands for, and the function
resolves it with a `match`.

Two rules keep these predictable:

- **`X.new ()` writes every default in.** So a map merged over defaults of
  your own (`map.merge mine opts`) is undone by a caller who built `opts`
  with `new`. A function that has defaults of its own takes a *configure
  function* instead, `X -> X`, and hands it those defaults: a setter is
  already one (`model.train! nights (ml.Fit.set_epochs 30)`), and
  `fn o -> o |> .. |> ..` chains several. `sleep/src/model.dr`'s `train!` is
  the example.
- **A setting that may be left unsaid is `()`, not `false`.** In
  `sql.Transaction`, `read_only = ()` says nothing and lets the database
  decide; `false` says `READ WRITE`.

Older modules still take a bare `%{:atom => :any}` here and there; turning
one into a `mapping` changes nothing for a caller that passes a map, and gives
every caller the checks.

## Paths

`std.path` is the one place a path is taken apart or put together. It
follows the systems' own definitions rather than its own -- POSIX's
`dirname` and `basename` (trailing slashes are not a name), `splitext`'s
extensions (`.bashrc` has none, `a.tar.gz` has `gz`), `normpath`'s folding --
and splits every path into drive, root and rest first, which is where
Windows differs: `C:/x`, drive-relative `C:x`, rooted `/x`, UNC shares and
`//?/` device paths. `path.posix` and `path.windows` answer for one family
whatever the system; `path.join` and the rest answer for the running one.
`dreams/tests/paths.py` holds the module to Python's `posixpath`, `ntpath`
and `pathlib` and to glibc's libgen over thousands of generated paths.

The directory helpers read the running process's environment each time and
return an absolute path with `/` separators, or `()` when unavailable:

| Function | Unix | macOS | Windows |
|---|---|---|---|
| `home_dir! ()` (also `home! ()`) | `$HOME` | `$HOME` | `$USERPROFILE`, then `$HOMEDRIVE` + `$HOMEPATH`, then `$HOME` |
| `data_dir! ()` | `$XDG_DATA_HOME` or `~/.local/share` | `~/Library/Application Support` | `$APPDATA` or `~/AppData/Roaming` |
| `config_dir! ()` | `$XDG_CONFIG_HOME` or `~/.config` | Same as data | Same as data |
| `cache_dir! ()` | `$XDG_CACHE_HOME` or `~/.cache` | `~/Library/Caches` | `$LOCALAPPDATA` or `~/AppData/Local` |
| `state_dir! ()` | `$XDG_STATE_HOME` or `~/.local/state` | Same as data | Same as cache |
| `runtime_dir! ()` | `$XDG_RUNTIME_DIR` or `()` | `$XDG_RUNTIME_DIR` or `()` | `()` |
| `temp_dir! ()` | `$TMPDIR` or `/tmp` | `$TMPDIR` or `/tmp` | `$TEMP`, then `$TMP`, then `Temp` below cache |

Empty and relative environment values are ignored, including literal `~`
overrides: [XDG requires absolute paths](https://specifications.freedesktop.org/basedir/0.8/).
macOS uses [Apple's Library folders](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/MacOSXDirectories/MacOSXDirectories.html),
and Windows uses [the user's AppData folders](https://learn.microsoft.com/en-us/windows/deployment/usmt/usmt-recognized-environment-variables).
The config and state mappings on macOS, and the state and cache mappings on
Windows, share a base deliberately; add your application's subdirectory with
`path.join`. These functions neither create directories nor check their
existence or permissions. A runtime directory has no temporary-directory
fallback. `expand_home!` and `from_env!` remain available for paths that accept
a quoted tilde.

Dream-specific data follows the same installation lookup as the installed
tools: the first directory from `std.install.dirs! ()` (`MINDV2_PATH`, the
VM's packaged installation, or `~/.mindv2`). With no existing installation,
the base is `~/.mindv2` even before it exists. An empty installation list
and no home directory return `()`.

| Path only | Create parents and return the same path | Location |
|---|---|---|
| `path.dream_dir! ()` | — | Installation base |
| `path.dream_data_dir! ()` | `file.ensure_dream_data_dir! ()` | `<base>/data` |
| `path.program_data_dir! "my-tool"` | `file.ensure_program_data_dir! "my-tool"` | `<base>/data/my-tool` |

`path.program_dir! "mind"` returns the absolute parent directory of the
installed image that `dream -x mind` would run, or `()` if no image is found.
It searches all installation directories, including `.dream` suffixes, and
ignores working-directory images. For a name such as `tools/my-tool`, it
returns the directory containing that image (`<installation>/tools`).

The program name must be one nonempty component, without `/`, `\`, `:`,
NUL, or a trailing dot or space. Invalid names raise `:bad_argument`.
Ensuring a directory is safe to repeat and preserves its contents. Missing
bases return `()`; filesystem errors, including an installation that cannot
be written, propagate. No other directory is silently substituted.

`path.temp_dir! ()` locates the temporary directory. `file.temp_file! ()`
and `file.temp_dir! ()` create fresh entries there and return their paths.
`file.temp_file_in! dir prefix` and `file.temp_dir_in! dir prefix` choose a
parent and name prefix. Creation is exclusive with random names, so existing
entries are never reused. Unix permissions are at most 0600 for files and
0700 for directories; Windows inherits the parent's ACL. Call
`file.remove_all!` when finished. For an open read-write file, use
`io.temp_file! dir prefix`, which returns `[path, handle]`; close the handle
before removing the file.

A local variable named like a module hides it: `let f path = path.join ..`
reads a member of the string. The compiler warns about that now, but the
cure is a different name for the local (`dir`, `file_name`, `dest`).

## Tests

A module's tests live in it, in a `when test` block that compiles only under
`--test`:

```dream
when test {
    import std.test;

    let tests = [
        test.case "ok"    $( test.true! (is_ok (ok 1)) ),
        test.case "error" $( test.true! (is_error (error :e)) ),
    ];
}
```

With a VM and a compiler installed, this repository tests itself:

```sh
dream -x dreams src/all.dr --test -L std=. -o std-tests.dream && dream std-tests.dream
```

In the [Dream workspace](https://github.com/Custards1/dream), where it is checked out at
`mind/std` beside the VM and the compiler it is built with:

```
just test-std         # every module's, through all.dr
just test-build       # std.build.cc against GCC, Clang and CMake, and the runner
just test-pg          # the PostgreSQL client
mind test std         # all of it at once
```

A change here is a change to what the compiler is built from: run
`just reseed` in the workspace before committing one.

A new module goes in `all.dr` too, or its tests are never run.
