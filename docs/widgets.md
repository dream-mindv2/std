# std.graphics.widgets

Interfaces made of things a person sees and uses -- screens, cards, buttons,
fields, switches, tabs, tables, dialogs -- written in Dream and finished as
written. Spacing, type, colour, focus rings, hover states, dark mode, narrow
screens and accessibility come from the kit, so a program says what is on the
screen and nothing about HTML, CSS or JavaScript.

```dream no-run
import std.graphics as ui;
import std.graphics.widgets as w;

mapping Model {
    name : :string = ""
    updates : :bool = true
    volume : :any = 40
}

union Msg { name(text : :string), updates(on : :bool), volume(level : :any), save }

let update! : Msg -> Model -> Model;
let update! msg model = match msg {
    Msg.name(t) => Model.set_name t model,
    Msg.updates(b) => Model.set_updates b model,
    Msg.volume(v) => Model.set_volume v model,
    Msg.save => model,
};

let view : Model -> ui.Node;
let view model = w.screen [
    w.title "Settings",
    w.card [
        w.text_field "Name" (Model.name model) Msg.name |> w.placeholder "Ada Lovelace",
        w.switch "Email me updates" (Model.updates model) Msg.updates,
        w.slider "Volume" 0 100 1 (Model.volume model) Msg.volume,
        w.row [w.spacer, w.button "Save" Msg.save |> w.primary],
    ],
];

let main! = w.run! (ui.App.new () |> ui.title "Settings" |> ui.App.set_init (Model.new ())
    |> ui.App.set_update update! |> ui.App.set_view view);
```

```sh
mind run      # with `[graphics]` in mind.toml, as graphics.md shows
```

`examples/budget` in `mind/std/graphics` is a whole application in widgets
alone: tabs, stat cards, a searchable table, a form that checks itself, a
dialog before anything is deleted, toasts that go away by themselves, a budget
on a slider, dark mode as a setting, everything kept in the browser.

Everything else about a program -- `App`, messages, `start!`, subscriptions,
effects such as `browser.get_json!` and `browser.save!`, the native backend --
is std.graphics's, in [graphics.md](graphics.md). `w.run!` is `browser.run!`
with the kit's design installed.

## The widgets

**Layout**

| | |
|---|---|
| `w.page [..]` | the whole window, in the theme's background; where `w.mode` goes |
| `w.screen [..]` | the page's content: centred, as wide as the theme allows |
| `w.column [..]`, `w.row [..]` | one above another; side by side, centred on a line, wrapping |
| `w.grid n [..]` | `n` equal columns, one on a narrow screen |
| `w.card [..]`, `w.section heading [..]` | a raised panel; a titled part of a screen |
| `w.stack [..]`, `w.center [..]`, `w.scroll [..]` | on top of one another; centred both ways; scrolling past `w.height` |
| `w.spacer`, `w.divider` | the rest of a row (pushes what follows to the end); a rule |

**Text**: `w.title`, `w.heading`, `w.text`, `w.caption`, `w.strong`,
`w.code`, `w.badge`, and `w.link caption "/route"` -- a route, which
`ui.on_url` hears.

**Actions**: `w.button caption msg`, `w.button_with "plus" caption msg` (an
icon first), `w.icon_button "trash" "Remove" msg` (the label is what a screen
reader says, and the tooltip).

**Fields**, each its label around its control, so the words name it and
clicking them focuses it:

| | `f` gets |
|---|---|
| `w.text_field`, `w.password_field`, `w.email_field`, `w.search_field`, `w.text_area` `label value f` | the text as it is typed |
| `w.number_field label value f` | an integer, a float, or `()` while it is empty |
| `w.slider label low high step value f` | the number; the value is shown beside the label |
| `w.select label options selected f`, `w.select_of label [[value, caption]] selected f` | the option chosen |
| `w.radio_group label options selected f` | the option chosen |
| `w.checkbox label checked f`, `w.switch label on f` | the new state; a switch is a switch to a screen reader |
| `w.tabs [[value, caption]] selected f` | the tab chosen |

**Feedback**: `w.progress fraction`, `w.spinner`, `w.notice tone text`
(`:info`, `:success`, `:warning`, `:danger`; a danger notice is an alert),
`w.toasts [w.toast tone text dismiss_msg]` (bottom right, announced as they
come), `w.empty heading hint`, and `w.dialog open heading body actions
close_msg` -- modal while `open`: the rest of the page cannot be used, focus
stays inside, Escape or a click outside sends `close_msg`.

**Data**: `w.table columns rows` (each row a list of widgets),
`w.list_of [..]` (a keyed item keeps its row when the list reorders; for a
long one, make each item `ui.lazy item_view item |> w.key id`, and an
unchanged item is not made again -- graphics.md, "Long lists"),
`w.image src alt`, `w.icon name`.

**Icons**: `plus minus x check trash edit search chevron-down chevron-right
chevron-left menu info warning alert star heart settings sun moon user home
inbox refresh download upload copy external calendar clock lock` -- line
icons in the colour of the text around them.

## Modifiers

A widget is adjusted in a pipeline, `Node -> Node`:

| | |
|---|---|
| `w.primary`, `w.danger`, `w.ghost` | a button's emphasis; plain is the default |
| `w.small`, `w.large`, `w.full` | its size; as wide as what holds it |
| `w.tone t` | colours a badge, a notice, a toast or a progress bar |
| `w.gap n`, `w.padding n` | space between children, and inside, on the scale 0 to 8 (0, ¼, ½, ¾, 1, 1½, 2, 3, 4 rem) |
| `w.grow` | take the room a row or column has left |
| `w.align a`, `w.justify a` | `:start`, `:center`, `:end`, `:stretch`; `:between`, `:around` |
| `w.width s`, `w.max_width s`, `w.height s` | any CSS length, `"16rem"` |
| `w.hidden b` | gone while `b` holds |
| `w.key k` | identity, for an item of a list that can reorder |
| `w.on_tap msg`, `w.tooltip s` | for anything |
| `w.placeholder s`, `w.disabled b`, `w.autofocus`, `w.on_enter msg` | a field's control, however it is wrapped |
| `w.hint s`, `w.error s` | help, or what is wrong, under a field; an error marks it invalid, and `""` is none |
| `w.quiet_label` | a field's label kept for screen readers but not shown |
| `w.mode :dark` / `:light` | this node and what is in it, whatever the theme says |

## Themes

`Theme` is the whole design in a handful of choices, with defaults:

```dream no-run
let theme = w.Theme.new () |> w.Theme.set_accent "#0a7d5a" |> w.Theme.set_radius "6px"
    |> w.Theme.set_mode :light |> w.Theme.set_width "56rem";
let main! = browser.run! (w.themed theme app);
```

`accent`, `danger`, `success`, `warning` are CSS colours; `radius` is how round
corners are; `font` a font stack; `width` how wide a screen grows; `mode` is
`:auto` (the person's system setting), `:light` or `:dark`. To let the person
choose while the program runs, keep it in the model and put `w.mode` on the
`w.page`, as `examples/budget` does.

## Underneath

Every widget is an ordinary `std.graphics` `Node`. A widget and
`std.graphics.html` mix in one tree; `html.class`, `html.attr` and
`html.style` still apply to a widget; and the kit's classes (`.dw-card`,
`.dw-button`, ..) and custom properties (`--dw-accent`, `--dw-space-4`, ..)
are there for a program's own stylesheet. When the kit has no widget for
something, that is the way down -- and the application's own JavaScript, a
custom element, is the way out (graphics.md, "Breaking out").
