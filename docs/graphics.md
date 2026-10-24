# std.graphics

`std.graphics` is user interfaces written in Dream. A program is a model, the
messages that change it, and a view of it; the view is HTML, CSS and canvas
drawing made of Dream values, and it runs in a browser tab, or in a desktop
window with a native Dream backend behind it. Nothing about the frontend has
to be written in anything but Dream, and when the page has something Dream
does not, the application ships JavaScript and CSS of its own beside it.

```dream no-run
import std.graphics as ui;
import std.graphics.browser;
import std.graphics.html;

union Msg { add, rename(text : :string) }

mapping Model {
    count : :integer = 0
    name : :string = "world"
}

let update! : Msg -> Model -> Model;
let update! msg model = match msg {
    Msg.add => Model.set_count (Model.count model + 1) model,
    Msg.rename(t) => Model.set_name t model,
};

let view : Model -> ui.Node;
let view model = html.main [] [
    html.h1 [] [html.text ("Hello, " + Model.name model)],
    html.input [html.value (Model.name model), html.on_input Msg.rename, html.aria "label" "Name"],
    html.button [html.on_click Msg.add] [html.text (to_string (Model.count model))],
];

let main! = browser.run! (ui.App.new () |> ui.title "Hello" |> ui.App.set_init (Model.new ())
    |> ui.App.set_update update! |> ui.App.set_view view);
```

**Most programs want [widgets](widgets.md)** (`std.graphics.widgets`): a
screen of cards, buttons, fields, switches, tabs, tables and dialogs that look
finished as written, with no HTML or CSS in sight. This guide is the layer
underneath -- the program, its effects, elements and stylesheets as values,
the browser VM and the desktop host -- which widgets are made of and which a
program reaches for when it wants exactly its own markup.

The examples in `mind/std/graphics/examples/` are each a whole program:
`counter` (a backend call), `todo` (forms, a keyed list, routing, storage,
focus, a stylesheet in Dream, a custom element and a JavaScript function),
`sketch` (canvas, pointer strokes, an animation, keys) and `budget` (widgets
alone).

## Building and running

An application is a package whose manifest has a `[graphics]` section; its
program is the frontend.

```toml
[package]
name = "hello"
version = "0.1.0"
entry = "hello.dr"

[graphics]
```

```sh
mind run              # build it, and serve it at http://127.0.0.1:8000/
mind run --desktop    # or open it in a window, backend and all
mind build            # target/debug/hello/: the application, to put anywhere
```

`mind build` compiles the frontend for any VM and puts it in `assets/` with the
browser VM and the page that runs it: a static site, which any host serves if
it answers `.mjs` as JavaScript, `.wasm` as WebAssembly and an extensionless
path with `index.html` (as `mind run` and `mind serve --fallback index.html`
do). Building one needs the browser VM, from `just graphics-browser` in the
Dream repository; `mind` finds it in the installation, in a checkout's
`build-browser/`, or where `--runtime DIR`, `[graphics] runtime` or
`$DREAM_BROWSER` says. The section's keys, each optional, paths relative to the
manifest:

| Key | |
|---|---|
| `frontend = "app.dr"` | the program, when it is not the package's entry |
| `backend = "backend.dr"` | a native backend (below) |
| `js = ["widgets.mjs"]` | ES modules of the application's own, imported before the program starts |
| `css = ["theme.css"]` | stylesheets of its own, linked before the program's |
| `assets = ["img"]` | files and directories to ship: images, fonts, data |
| `connect = ["https://api.example.com"]` | origins the page may fetch from |
| `base = "/"` | where the page finds its files; `./` (the default) works from any directory, `/` lets a deep route be reloaded |

Dependencies, profiles and `when` flags are the package's, as for any build.

On the desktop the same directory is an application:

```sh
nix-shell mind/std/graphics/shell.nix --run 'just graphics-vm'
build-graphics/bin/dream --graphics /tmp/hello
```

`graphics-vm` builds the VM with `DREAM_ENABLE_GRAPHICS=ON` (GTK 3 and
WebKitGTK 4.1, Linux only for now). An ordinary VM answers `--graphics` with
`graphics_unavailable`, as a graphics VM does without a display, and importing
`std.graphics` never opens a window.

## The program

An `App` is a mapping whose every field has a default:

| Field | |
|---|---|
| `window` | a `Window`: `title` (default `Dream`), `width` and `height` in logical pixels, 1 to 16384 |
| `init` | the first model |
| `start` | `model -> model`, run once the page is open: where a program asks for what it starts with |
| `update` | `msg -> model -> model`, may be impure and ask for effects |
| `view` | `model -> Node`, pure |
| `subscriptions` | `model -> [Sub]`, pure |
| `styles` | the program's stylesheet: `std.graphics.css` rules, or text |
| `closing` | `model -> model`, run when the window closes: the moment to save |

`browser.run! app` runs it until the window closes and answers
`Result.ok last_model`; `ui.quit! ()` from `update!` ends it the same way. The
view is rendered after each message, but only once the mailbox is empty, so a
burst of input (a key held down, a pointer moving) is one render.

**Messages are any Dream value**, usually a union's constructors, so the
checker sees what `update!` must handle and a `match` on one must handle every
variant. A handler is a message or a function of the event's value
(`html.on_input Msg.rename` sends `Msg.rename text`); a function that answers
`()` sends nothing. Handlers never leave Dream: the loop keeps the tree it last
rendered, and the page reports only which node (by its way from the root, a key
or a position at each step), which event and the value.

**A render sends what changed.** The loop compares each view with the last and
sends the page a patch: the nodes that changed, and runs of the ones kept. An
unchanged subtree costs one comparison by the VM, so typing into a field above
a 2,000-row table sends the field.

**The loop is a process reading its mailbox.** Page events arrive there, effect
answers arrive there, and so does anything any process sends it -- which is a
message for `update!` like any other. A ticker is `spawn!` and `proc.sleep!`, a
background computation sends its answer when it is done, and `browser.after!
ms msg` is the two together. Effects are asked for from `update!` or `start!`,
the loop's own process.

## Views

`std.graphics.html` has a function for each element, taking its attributes and
then its children (`input`, `img`, `textarea` take only attributes; `br` and
`hr` nothing), and a function for each attribute and event worth a name:

```dream no-run
html.form [html.class "search", html.on_submit Msg.search] [
    html.label [html.label_for "q"] [html.text "Search"],
    html.input [html.id "q", html.value query, html.on_input Msg.query, html.placeholder "Anything"],
    html.button [html.input_type "submit", html.disabled (query == "")] [html.text "Go"],
]
```

Anything else is `ui.element "tag" [..] [..]`, `html.attr "name" value`,
`html.data "id" "7"` (`data-id`), `html.aria "label" ".."` and `html.prop
"name" value` (a JavaScript property). `ui.only condition attr` is an
attribute only when the condition holds, `html.classes [["done", finished]]`
the classes whose conditions do, and `ui.nothing` a child that is not there --
it takes no position, so its siblings keep their identity.

**Keys.** A node is known across renders by its `html.key`, or by its position
if it has none. Give every item of a list that can reorder a key: the page then
moves the element itself, keeping its focus, selection and any IME composition.
A control's value is never written over while someone is composing in it. A
key is matched among siblings; a keyed node moved to another parent is a new
element there. Keys are unique on the page, since `focus!` and
`dream.element` name a node by one.

**Long lists.** `ui.lazy f value` is the node `f value`, which a render does
not make, compare or send while `f` and `value` are the ones it had the render
before (`ui.lazy2 f a b` for two values):

```dream no-run
let row : Item -> ui.Node;
let row item = html.tr [] [html.td [] [html.text (Item.name item)], ..];

html.tbody [] (list.map (fn item -> ui.lazy row item |> ui.keyed (Item.id item)) items)
```

`f` should be a named function: a lambda, or a partial application like `row
model`, is a new function every render and never equal to the last. Give the
lazy node the key, since the one `f` would give is not read without making the
node. On the browser VM, a 2,000-row table (14,000 nodes) takes a keystroke
elsewhere on the page to the screen in about 80 ms with lazy rows, and in about
130 ms without.

**Event values:**

| Event | Value |
|---|---|
| `on_input`, `on_change` | the control's value; `on_check` a checkbox's state |
| `on_submit_with` | the form's fields by name (`on_submit` sends a message); a form never navigates |
| `on_key_down`, `on_key_up` | `%{"key", "code", "alt", "ctrl", "shift", "meta", "repeat", "in_field"}`; `on_enter msg` for Enter alone |
| `on_click_at`, `on_pointer_down/move/up` | `%{"x", "y"}` on the element, `"button"`, `"buttons"`, the modifiers, `"pointer"` |
| `on_wheel` | `%{"dx", "dy", "x", "y"}` |
| `on_scroll` | `%{"top", "left"}` |
| `on_click`, `on_focus`, `on_blur`, `on_mouse_enter` .. | the message as given |

A link to a path of the application's own (`html.a [html.href "/about"]`) is a
route: the page follows it without loading, and `ui.on_url` hears it.

## Styles

`std.graphics.css` writes CSS as Dream values; a rule is its text, so a
stylesheet is a list of strings and a theme is a function:

```dream no-run
let styles = [
    css.vars %{ "--accent" => "#5b5bd6" },
    css.rule ".card" %{ "padding" => css.rem 1, "border-radius" => css.px 8 },
    css.rule ".card:hover" %{ "outline" => "2px solid var(--accent)" },
    css.media "(max-width: 600px)" [css.rule ".card" %{ "padding" => css.rem 0.5 }],
    css.keyframes "pulse" [["from", %{ "opacity" => "1" }], ["to", %{ "opacity" => "0.4" }]],
];
```

Declarations in a map are written in key order; `css.rule_in_order` takes
pairs where order matters. `App.styles` is installed once, as a `<style>` of
its own. Inline styles (`html.style "color" c`) are for what a view computes
from data, and the page refuses `url()` and `@import` in one; a stylesheet is
the program's own code and may use anything CSS has. A hand-written file is
`[graphics] css`, linked first, so the program's rules win a tie.

## Canvas

```dream no-run
import std.graphics.canvas as cv;

cv.view [html.key "board", html.on_pointer_down Msg.press] 400 300 [
    cv.clear "#101820",
    cv.fill "tomato" (cv.circle x y 12),
    cv.stroke "white" 2 (cv.line 0 150 400 150),
    cv.translate 200 150 [cv.rotate angle [cv.fill "gold" (cv.rect (-20) (-20) 40 40)]],
    cv.text_with "bold 16px system-ui" "white" "left" 10 24 "Score",
    cv.image "sprites/ship.png" 10 10 32 32,
]
```

A drawing is a list of operations made by `view` like the rest of the tree,
and the page replays it when it changes, so an animation is a `ui.on_frame`
subscription moving the model. Shapes: `rect`, `rounded`, `circle`, `ellipse`,
`arc`, `line`, `polyline`, `polygon` and `path` (SVG path data). Operations:
`clear`, `fill`, `stroke`, `paint` (both), `text`, `text_with`, `image`, and
`group` -- or `translate`, `rotate`, `scale`, `alpha` -- around a list. The
canvas is sized in CSS pixels and drawn at the screen's density, and a pointer
event's `x` and `y` are in the drawing's pixels.

## Subscriptions

`subscriptions model` is asked after every update, and the page starts what
is new and stops what has gone; each is known by what it watches, so one asked
for again keeps running rather than restarting.

| | Sends |
|---|---|
| `ui.every ms f` | the time, ms since the epoch, every `ms` |
| `ui.on_frame f` | the time of each animation frame, on the page's clock |
| `ui.on_key_down f`, `ui.on_key_up f` | a key pressed anywhere on the page |
| `ui.on_resize f` | `%{"width", "height"}`, at once and on each change |
| `ui.on_url f` | `%{"path", "query", "hash", "href"}`, at once and on each navigation |
| `ui.on_visible f` | whether the page is showing |
| `ui.on_port name f` | what the application's JavaScript sends under `name` |

## Effects

Each takes the function that makes its answer a message, returns at once, and
the answer arrives later like any other message. All are in
`std.graphics.browser`:

| Effect | Answer |
|---|---|
| `get! url f` | `Result :string :string`: the body of a 2xx, or `"HTTP 404"` |
| `get_json! url f`, `post_json! url value f` | `Result json.Value :string` |
| `fetch! request f` | `Result Response :string`, any status; `Request` has `url`, `method`, `headers`, `body` |
| `save! key value`, `forget! key` | none: local storage, as JSON |
| `load! key f` | `Option json.Value` |
| `navigate! url`, `replace_url! url`, `back! ()` | none; `ui.on_url` hears it |
| `focus! key`, `blur! key`, `scroll_to! key` | none; run after the render the update makes, so a field that update creates can be focused |
| `measure! key f` | `Result %{"x", "y", "width", "height"} :string` |
| `set_title! t`, `copy! text` | none (the clipboard only while handling a click or a key) |
| `after! ms msg` | `msg`, after `ms` |
| `invoke! command value f` | the backend's `Result json.Value :string` |
| `js! name args f`, `js_do! name args` | the application's JavaScript's answer |

`fetch!` goes where the page's policy allows: its own origin, and each
`--connect`. Integers from the backend are exact past 2^53, because its answers
cross as JSON text that JavaScript never parses.

## The backend

```dream no-run
import std.graphics.backend;

let save! notes = { file.write! "notes.json" (json.encode notes); true };
// with `import std.file;` and `import std.json;`
let main! = backend.serve! %{
    "save" => backend.command! :any :bool save!,
};
```

On the desktop, `dream --graphics APP` runs `APP/backend.dream` as a native
Dream process with ordinary access to the machine, and its command table is the
whole of what the frontend may ask of it: an unregistered command is
`permission_denied`, input its type refuses `invalid_arguments`, an answer its
type refuses `invalid_result`, and a handler that raises `command_failed`.
Requests and answers are bounded to 1 MiB. The backend's standard output is the
protocol; log with `console.error!`. In a tab, or with no backend, every
command answers `backend_unavailable`.

Closing the window sends the frontend `close`: `closing!` runs, what it asked
of the backend is delivered, and the backend sees its input end and has two
seconds to finish. A program that fails, a backend that fails or sends an
invalid frame, or a full request queue stops the application with a nonzero
status. `DREAM_GRAPHICS_TRACE=1` prints the host's requests, navigation and
messages; it can show application data. What the frontend prints reaches the
terminal on the desktop and the console in a tab.

## Breaking out

The page is not a sandbox to escape but one to extend. An application's own
module (`[graphics] js = ["widgets.mjs"]`) is imported before the program starts; its
`setup(dream)` is given:

| | |
|---|---|
| `dream.handle(name, fn)` | `fn(args)` answers `browser.js! name args`; it may be async, and what it throws is the error |
| `dream.send(name, value)` | a message for `ui.on_port name`; answers whether anything was listening |
| `dream.element(key)` | the element a node with that key rendered to |
| `dream.afterRender(fn)` | called after every render, for a widget that needs the DOM it lives in |
| `dream.root` | the element the program renders into |

It may also define custom elements, which a program renders by name and feeds
through properties:

```js
// widgets.mjs
class Sparkline extends HTMLElement {
  set points(values) { /* draw them */ }
}
export function setup(dream) {
  customElements.define('spark-line', Sparkline);
  dream.handle('confirm', ({ text }) => window.confirm(text));
  window.addEventListener('online', () => dream.send('online', true));
}
```

```dream no-run
ui.element "spark-line" [html.prop "points" (Model.history model)] []
browser.js! "confirm" %{ "text" => "Delete it?" } Msg.confirmed
ui.on_port "online" (fn b -> Msg.online)
```

A script that fails in `setup` stops the application before the program
starts, with its error. `css` and `assets` ship the rest.

## Dream in the browser

The frontend runs on the browser VM: the C++ VM compiled to WebAssembly, in a
Web Worker, so a long update never blocks the page. Its scheduler is the
native one, pumped a slice at a time from the worker's event loop: processes,
messages, timers, `try!`, monitors and kills work as they do on the command
line. Every example in `examples/` that does not open a socket prints exactly
what the native VM prints there (`just test-browser-compat`), and std's own
tests pass but for files, sockets and two timing races.

| | In the browser |
|---|---|
| `std.console`, `std.log` | standard output and error, to the console (or the desktop's terminal) |
| `std.time`, `std.random`, `std.crypto` | the clock, `crypto.getRandomValues`, every hash and signature |
| `std.json`, `std.regex`, `std.parse`, `std.trunk`, `std.tensor`, `std.ml`, .. | all of it |
| `std.os` | `args!` is empty, `env!` finds nothing, `platform` is `:browser` and `arch` `:wasm32` |
| `std.file`, `std.io` files, `os.exec!` | `:unsupported`, raised when called -- so a module that *could* open a file imports and runs, and shares code with the backend |
| `std.net`, `std.tls`, `std.ffi` | "not provided by this runtime", when called; `browser.fetch!` is the network |

Its memory grows as needed, up to 2 GiB. One thing is not as it is natively: a
process forcing something endless inside a single native walk (`len` of an
infinite list) cannot be timed out or killed, because one thread runs every
process and it does not give the thread back until the walk returns. On the
command line another worker can.

## What the page refuses

Trees are data, and nothing in one is evaluated. The page checks the whole
patch before touching the DOM: an `on*` attribute or property, a `javascript:`
URL, `innerHTML`/`srcdoc`, `url()` or `@import` in an inline style, and
`<script>`, `<iframe>`, `<object>`, `<style>` and their like are refused, as
are duplicate keys, trees deeper than 128, patches of more than 100,000 nodes,
an old child named twice or not there, and events outside the known set. Text is always text. Within that, any element --
custom ones included -- and any attribute is allowed. The page's content
security policy allows scripts, styles, fonts and media from the application
alone, and fetches from its own origin and its `--connect` origins; the desktop
host serves only the files in `APP/assets`, opens a link to the web in the
person's browser, and refuses every other navigation.

## Tests

```sh
npm ci --prefix mind/std/graphics
just test-graphics            # Dream units, jsdom, the examples on the browser VM
just test-graphics-browser    # and in headless Chromium (Playwright's, or $DREAM_CHROME)
nix-shell mind/std/graphics/shell.nix --run 'just graphics-vm && just test-graphics-native'
just test-browser-compat      # every example on the browser VM, byte for byte
```

The Chromium suite drives the four examples as a person would: typing,
submitting, ticking, renaming in place, following routes, reloading to find the
list kept, answering a confirm dialog, drawing strokes and reading the canvas's
pixels back. The desktop suite runs the real webview under Xvfb: no display is
an error, a Wasm frontend reaches its native backend with an integer past
2^53, a failing frontend fails the application, the window has the title and
size asked for, and a window-manager close runs `closing!` through to the
backend. `DREAM_JSDOM` and `DREAM_PLAYWRIGHT` can name module entry files from
an existing installation of either.

## Not yet

- Desktop hosts for macOS and Windows: the protocol is the host's whole
  interface (`dream/src/graphics.cpp` is under 500 lines), so each is a webview and a
  pipe.
- A filesystem in the browser: `std.file` could be backed by the origin's
  private file system, rather than answer `:unsupported`.
- A keyed node keeping its element when it moves to another parent (a card
  dragged between columns): it is made anew there, focus and all.
