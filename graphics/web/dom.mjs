// The DOM half of std.graphics: renders the trees a Dream program sends, and
// reports what the person does to them.
//
// A tree is data -- `{t: tag, k: key, i: id, x: text, a: attrs, p: props,
// s: style, e: events, d: drawing, c: children}`, each field there only when
// it is not empty, made by `std.graphics.describe` -- and after the first
// render the program sends only what changed (`std.graphics.diff`): a node's
// children as runs of old children kept, `[from, count]`, old children
// patched, `{o: position, ..}`, and new nodes. Nothing in either is ever
// evaluated: text is a text node, an attribute is set with setAttribute, a
// handler is only an event *name*. What makes that safe is checked before any
// node is touched, for the whole patch at once: no `on*` attribute or property,
// no `javascript:` URL, no markup-bearing property (`innerHTML`, `srcdoc`), no
// `url()` or `@import` in an inline style, no `<script>`/`<iframe>`/`<object>`.
// Within that a program may use any element -- a custom element (a name with a
// hyphen) included, which the application's own JavaScript defines -- and any
// attribute. This is about data a program renders becoming code; the
// program's own code is its own (main.mjs, "breaking out").
//
// Identity is the program's: a patch says which old element each child is.
// A keyed node keeps its element while it moves among its siblings; one
// without a key is known by its position. Focus, selection and an IME
// composition survive a move (`moveBefore` where the webview has it, and
// restored after where it does not), and a control's value is never written
// over while someone is composing in it.
const forbidden = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base',
  'meta', 'link', 'style', 'template', 'noscript', 'foreignObject', 'animate', 'set', 'animateMotion',
  'animateTransform', 'html', 'head', 'body']);
const svgTags = new Set(('svg g path rect circle ellipse line polyline polygon text tspan title desc defs ' +
  'linearGradient radialGradient stop clipPath mask pattern use symbol marker image').split(' '));
const htmlTags = new Set(('div span main section article header footer nav aside search h1 h2 h3 h4 h5 h6 p ' +
  'a abbr b i u s q em strong small mark sub sup kbd samp var cite code pre blockquote time data br hr wbr ' +
  'button input label textarea select option optgroup datalist form fieldset legend output progress meter ' +
  'ul ol li dl dt dd menu table thead tbody tfoot tr th td caption colgroup col details summary dialog ' +
  'figure figcaption picture source img video audio track canvas address ins del').split(' '));
const voids = new Set('input br hr wbr img source track col'.split(' '));
const urlAttributes = new Set('href src action formaction poster cite background xlink:href ping'.split(' '));
const markupProps = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML', 'setHTMLUnsafe']);
// Properties that are an attribute's URL by another name, lower-cased.
const urlProps = new Set([...urlAttributes, 'formaction', 'xlinkhref', 'data', 'codebase']);
// The inline style whole, which would skip the checks on each declaration.
const styleProps = new Set(['style', 'cssText', 'attributeStyleMap']);
export const domEvents = new Set(('click dblclick contextmenu input change submit reset keydown keyup focus blur ' +
  'focusin focusout pointerdown pointermove pointerup pointerenter pointerleave pointercancel mouseenter ' +
  'mouseleave wheel scroll dragstart dragend dragover dragleave drop toggle close').split(' '));
const booleans = new Set('checked disabled readonly required multiple selected open hidden autofocus inert'.split(' '));
const controls = new Set(['input', 'textarea', 'select']);
const MAX_NODES = 100000, MAX_DEPTH = 128;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (x, key) => Object.hasOwn(x, key);
const string = x => typeof x === 'string';
const scalar = x => string(x) || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x));
const custom = tag => /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/.test(tag);
function fail(message) { throw new TypeError(`Dream graphics: ${message}`); }
/// What a URL would run as, with the control characters and whitespace a
/// browser ignores in a scheme taken out first.
function dangerousUrl(value) {
  return /^(javascript|vbscript|data:(?!image\/(png|gif|jpe?g|webp|avif);))/i
    .test(String(value).replace(/[\u0000- \u007f]+/g, ''));
}

/// A node of a patch as the program means it, with the fields it left out
/// (because they were empty) put back.
export function nodeOf(entry) {
  if (!object(entry) || !string(entry.t)) fail('invalid node');
  return { tag: entry.t, key: entry.k ?? '', id: entry.i ?? null, text: entry.x ?? '', attrs: entry.a ?? {},
    props: entry.p ?? {}, style: entry.s ?? {}, events: entry.e ?? [], draw: entry.d ?? [] };
}

/// One node's own fields, as `svg` or HTML, and with children or not.
function checkNode(node, svg, children) {
  if (!string(node.key) || !string(node.text) || !(node.id === null || Array.isArray(node.id)) ||
      !object(node.attrs) || !object(node.style) || !object(node.props) ||
      !Array.isArray(node.events) || !Array.isArray(node.draw))
    fail('invalid node');
  if (node.tag === '#text') {
    if (children || Object.keys(node.attrs).length || node.events.length ||
        Object.keys(node.style).length || Object.keys(node.props).length) fail('text nodes cannot have attributes or children');
    return;
  }
  if (forbidden.has(node.tag)) fail(`element ${node.tag} is not allowed`);
  if (svg ? !svgTags.has(node.tag) : !(htmlTags.has(node.tag) || custom(node.tag)))
    fail(svg ? `invalid SVG element ${node.tag}` : `unsupported element ${node.tag}`);
  if (!svg && svgTags.has(node.tag) && !htmlTags.has(node.tag)) fail('SVG elements need an svg parent');
  if (voids.has(node.tag) && children) fail(`${node.tag} cannot have children`);
  if (node.draw.length && node.tag !== 'canvas') fail('only a canvas has a drawing');
  for (const [name, value] of Object.entries(node.attrs)) {
    // An HTML attribute's name is any case (`HREF` is `href`), so every test
    // is of the name as the element will have it.
    const lower = name.toLowerCase();
    if (!/^[a-zA-Z][a-zA-Z0-9_:.-]*$/.test(name) || /^on/.test(lower) || lower === 'style' || lower === 'srcdoc' ||
        lower === 'is' || !scalar(value)) fail(`invalid attribute ${name}`);
    if (booleans.has(lower) && typeof value !== 'boolean') fail(`boolean required for ${name}`);
    if (urlAttributes.has(lower) && dangerousUrl(value)) fail(`unsafe URL in ${name}`);
  }
  for (const [name, value] of Object.entries(node.props)) {
    if (!/^[a-zA-Z_$][\w$]*$/.test(name) || /^on/i.test(name) || markupProps.has(name) ||
        name === '__proto__' || name === 'constructor' || styleProps.has(name)) fail(`invalid property ${name}`);
    // A property can say what an attribute says (`el.href = ..`), and is held
    // to the same: no URL that runs.
    if (urlProps.has(name.toLowerCase()) && dangerousUrl(value)) fail(`unsafe URL in ${name}`);
  }
  for (const [name, value] of Object.entries(node.style)) {
    if (!/^(--[a-zA-Z0-9_-]+|-?[a-z]+(-[a-z]+)*)$/.test(name) || !string(value) ||
        /url\s*\(|@import|expression\s*\(|[\\\u0000-\u001f]/i.test(value)) fail(`invalid style ${name}`);
  }
  for (const name of node.events) if (!domEvents.has(name)) fail(`invalid event ${name}`);
}

/// A whole tree, as the first render sends it: every node checked, and no
/// key twice.
export function validateTree(entry) {
  let count = 0;
  const keys = new Set();
  const walk = (entry, depth, svg) => {
    if (++count > MAX_NODES || depth > MAX_DEPTH) fail('tree limit exceeded');
    const node = nodeOf(entry);
    if (entry.c !== undefined && !Array.isArray(entry.c)) fail('invalid node');
    svg = svg || node.tag === 'svg';
    checkNode(node, svg, !!entry.c?.length);
    if (node.key) {
      if (keys.has(node.key)) fail(`duplicate key ${node.key}`);
      keys.add(node.key);
    }
    for (const child of entry.c ?? []) walk(child, depth + 1, svg);
  };
  walk(entry, 0, false);
  return entry;
}

/// What a DOM event is worth to the program, as JSON.
export function eventValue(name, event, el) {
  switch (name) {
    case 'input': case 'change':
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
      if (el.tagName === 'SELECT' && el.multiple) return [...el.selectedOptions].map(o => o.value);
      return 'value' in el ? el.value : null;
    case 'keydown': case 'keyup': {
      // Whether the key went to something that takes text, so a page-wide
      // shortcut can stay out of the way of typing.
      const t = event.target;
      const in_field = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? '') || !!t.isContentEditable);
      return { key: event.key, code: event.code, alt: event.altKey, ctrl: event.ctrlKey,
        shift: event.shiftKey, meta: event.metaKey, repeat: event.repeat, in_field };
    }
    case 'submit': {
      const fields = {};
      for (const [k, v] of new (el.ownerDocument.defaultView.FormData)(el)) if (typeof v === 'string') fields[k] = v;
      return fields;
    }
    case 'wheel':
      return { dx: event.deltaX, dy: event.deltaY, x: event.offsetX ?? 0, y: event.offsetY ?? 0 };
    case 'scroll':
      return { top: el.scrollTop, left: el.scrollLeft };
    case 'toggle':
      return !!el.open;
    case 'focus': case 'blur': case 'focusin': case 'focusout': case 'close':
      return null;
    default:
      // `self`: the event landed on the element, not on something inside it --
      // a modal's backdrop, rather than its contents.
      if ('button' in event || 'clientX' in event) return {
        x: event.offsetX ?? 0, y: event.offsetY ?? 0, button: event.button ?? 0, buttons: event.buttons ?? 0,
        alt: !!event.altKey, ctrl: !!event.ctrlKey, shift: !!event.shiftKey, meta: !!event.metaKey,
        pointer: event.pointerType ?? 'mouse', self: event.target === el
      };
      return null;
  }
}

// --- canvas -----------------------------------------------------------------

function shape(ctx, s) {
  ctx.beginPath();
  switch (s?.kind) {
    case 'rect': ctx.rect(s.x, s.y, s.w, s.h); break;
    case 'rounded':
      if (ctx.roundRect) ctx.roundRect(s.x, s.y, s.w, s.h, s.r); else ctx.rect(s.x, s.y, s.w, s.h);
      break;
    case 'ellipse': ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2); break;
    case 'arc': ctx.arc(s.x, s.y, s.r, s.from, s.to); break;
    case 'polyline': case 'polygon':
      (s.points ?? []).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      if (s.kind === 'polygon') ctx.closePath();
      break;
    case 'path': return new (ctx.canvas.ownerDocument?.defaultView?.Path2D ?? globalThis.Path2D)(String(s.d));
    default: throw new TypeError('Dream graphics: unknown canvas shape');
  }
  return null;
}

/// Replay a drawing onto a 2D context already scaled to CSS pixels.
export function paint(ctx, ops, { width, height, image = () => null, color = c => c }) {
  const run = list => {
    for (const op of list) {
      switch (op.op) {
        case 'clear':
          ctx.fillStyle = color(op.color);
          ctx.fillRect(0, 0, width, height);
          break;
        case 'fill': case 'stroke': case 'paint': {
          const path = shape(ctx, op.shape);
          if (op.op !== 'stroke') { ctx.fillStyle = color(op.op === 'paint' ? op.fill : op.color); path ? ctx.fill(path) : ctx.fill(); }
          if (op.op !== 'fill') {
            ctx.strokeStyle = color(op.color); ctx.lineWidth = op.width ?? 1;
            path ? ctx.stroke(path) : ctx.stroke();
          }
          break;
        }
        case 'text':
          ctx.font = op.font; ctx.fillStyle = color(op.color); ctx.textAlign = op.align ?? 'left';
          ctx.fillText(String(op.text), op.x, op.y);
          break;
        case 'image': {
          const img = image(op.src);
          if (img) ctx.drawImage(img, op.x, op.y, op.w, op.h);
          break;
        }
        case 'group': {
          const s = op.settings ?? {};
          ctx.save();
          if (s.translate) ctx.translate(s.translate[0], s.translate[1]);
          if (typeof s.rotate === 'number') ctx.rotate(s.rotate);
          if (s.scale) ctx.scale(s.scale[0], s.scale[1]);
          if (typeof s.alpha === 'number') ctx.globalAlpha *= s.alpha;
          run(op.drawing ?? []);
          ctx.restore();
          break;
        }
        default: throw new TypeError(`Dream graphics: unknown canvas operation ${op.op}`);
      }
    }
  };
  run(ops);
}

export class DomDriver {
  constructor(root, send, { afterRender = () => {} } = {}) {
    this.root = root;
    this.send = send;
    this.afterRender = afterRender;
    this.records = new WeakMap(); // element -> what it shows
    this.byKey = new Map();
    this.canvases = new Set();
    this.images = new Map();
    this.composing = new WeakSet();
    this.onCompositionStart = e => this.composing.add(e.target);
    this.onCompositionEnd = e => { this.composing.delete(e.target); };
    root.addEventListener('compositionstart', this.onCompositionStart);
    root.addEventListener('compositionend', this.onCompositionEnd);
  }
  /// The element a key names, for the program's own JavaScript and for
  /// effects such as `focus!`.
  element(key) { return this.byKey.get(key)?.el ?? null; }
  image(src) {
    let entry = this.images.get(src);
    if (!entry) {
      const img = new (this.root.ownerDocument.defaultView.Image)();
      entry = { img, ready: false };
      img.onload = () => { entry.ready = true; this.repaintAll(); };
      img.src = src;
      this.images.set(src, entry);
    }
    return entry.ready ? entry.img : null;
  }
  repaintAll() { for (const record of this.canvases) if (record.node.draw.length) this.paint(record, true); }
  paint(record, force = false) {
    const { el, node } = record;
    const width = Number(node.attrs.width ?? 300), height = Number(node.attrs.height ?? 150);
    const ratio = this.root.ownerDocument.defaultView.devicePixelRatio || 1;
    const text = JSON.stringify(node.draw ?? []);
    if (!force && record.drawn === text && record.size === `${width}x${height}x${ratio}`) return;
    record.drawn = text;
    record.size = `${width}x${height}x${ratio}`;
    // The backing store is the screen's pixels; the element stays the size the
    // program asked for, so the drawing is in CSS pixels and sharp.
    el.width = Math.round(width * ratio);
    el.height = Math.round(height * ratio);
    if (!own(node.style, 'width')) el.style.width = `${width}px`;
    if (!own(node.style, 'height')) el.style.height = `${height}px`;
    let ctx = null;
    try { ctx = el.getContext('2d'); } catch { ctx = null; }
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const current = this.root.ownerDocument.defaultView.getComputedStyle?.(el).color ?? '#000';
    paint(ctx, node.draw ?? [], { width, height, image: src => this.image(src),
      color: c => c === 'currentColor' ? current : c });
  }
  /// Apply what the program changed (`std.graphics.diff`): the first
  /// render's tree, or a patch of the one shown. The whole patch is checked
  /// against the page before any of it is applied, so a bad one changes
  /// nothing.
  render(patch) {
    const doc = this.root.ownerDocument;
    const shown = this.root.firstChild;
    const keep = 'o' in Object(patch);
    if (keep && !(shown && this.records.get(shown))) fail('a patch with nothing shown to patch');
    this.check(patch, keep ? shown : null, false);
    const focused = this.root.contains(doc.activeElement) ? doc.activeElement : null;
    const selection = focused && typeof focused.selectionStart === 'number'
      ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
    const done = { canvases: [], modals: [] };
    if (keep) this.update(shown, patch, done);
    else {
      const el = this.create(patch, false, done);
      if (shown) this.forget(shown);
      this.root.replaceChildren(el);
    }
    for (const record of done.canvases) this.paint(record);
    // A modal dialog is shown as one -- in the top layer, the rest of the page
    // inert, Escape closing it -- which only its method can ask for.
    for (const el of done.modals) if (!el.open && el.isConnected) el.showModal?.();
    // Older webviews lack moveBefore; give focus back after a necessary move.
    if (focused && this.root.contains(focused) && doc.activeElement !== focused) {
      focused.focus({ preventScroll: true });
      if (selection) focused.setSelectionRange(...selection);
    }
    this.afterRender();
  }
  /// The patch, walked beside the elements it changes: every node it brings
  /// is valid where it goes, every old child it names exists and is named
  /// once, and a key it brings is not one the page goes on showing elsewhere.
  check(patch, shown, svg) {
    let count = 0;
    const created = new Set(), dropped = new Set();
    const fresh = (entry, depth, svg) => {
      if (++count > MAX_NODES || depth > MAX_DEPTH) fail('tree limit exceeded');
      const node = nodeOf(entry);
      if (entry.c !== undefined && !Array.isArray(entry.c)) fail('invalid node');
      svg = svg || node.tag === 'svg';
      checkNode(node, svg, !!entry.c?.length);
      if (node.key) {
        if (created.has(node.key)) fail(`duplicate key ${node.key}`);
        created.add(node.key);
      }
      for (const child of entry.c ?? []) fresh(child, depth + 1, svg);
    };
    const kept = (entry, el, depth) => {
      if (++count > MAX_NODES || depth > MAX_DEPTH) fail('tree limit exceeded');
      const record = this.records.get(el);
      if (!record) fail('a patch names nothing shown');
      if ('t' in entry) {
        const node = nodeOf(entry);
        if (node.tag !== record.node.tag || node.key !== record.node.key) fail('a patch changes what a node is');
        checkNode(node, record.svg, entry.c !== undefined ? entry.c.length > 0 : el.childNodes.length > 0);
      }
      if (entry.c === undefined) return;
      if (!Array.isArray(entry.c)) fail('invalid node');
      if (record.node.tag === '#text' && entry.c.length) fail('text nodes cannot have attributes or children');
      const olds = el.childNodes, used = new Set();
      const use = j => {
        if (!Number.isInteger(j) || j < 0 || j >= olds.length || used.has(j)) fail('a patch names an old child twice or not at all');
        used.add(j);
      };
      for (const child of entry.c) {
        if (Array.isArray(child)) {
          const [from, n] = child;
          if (!Number.isInteger(n) || n < 1 || n > MAX_NODES) fail('invalid run');
          for (let j = from; j < from + n; j++) use(j);
        } else if (object(child) && 'o' in child) { use(child.o); kept(child, olds[child.o], depth + 1); }
        else fresh(child, depth + 1, record.svg || record.node.tag === 'svg');
      }
      for (let j = 0; j < olds.length; j++) if (!used.has(j)) dropped.add(olds[j]);
    };
    if (shown) kept(patch, shown, 0);
    else { fresh(patch, 0, svg); if (this.root.firstChild) dropped.add(this.root.firstChild); }
    // A key brought in is a duplicate unless what shows it now is going.
    for (const key of created) {
      let el = this.byKey.get(key)?.el;
      while (el && el !== this.root && !dropped.has(el)) el = el.parentNode;
      if (el === this.root) fail(`duplicate key ${key}`);
    }
  }
  create(entry, svg, done) {
    const doc = this.root.ownerDocument;
    const node = nodeOf(entry);
    svg = svg || node.tag === 'svg';
    const el = node.tag === '#text' ? doc.createTextNode('') : svg
      ? doc.createElementNS('http://www.w3.org/2000/svg', node.tag) : doc.createElement(node.tag);
    const record = { el, node: { tag: node.tag, key: '', attrs: {}, props: {}, style: {}, events: [], draw: [] },
      svg, handlers: new Map() };
    this.records.set(el, record);
    this.fields(record, node);
    for (const child of entry.c ?? []) el.appendChild(this.create(child, svg, done));
    this.settle(record, done);
    return el;
  }
  update(el, entry, done) {
    const record = this.records.get(el);
    if ('t' in entry) this.fields(record, nodeOf(entry));
    if (entry.c !== undefined) this.children(el, entry.c, record.svg || record.node.tag === 'svg', done);
    this.settle(record, done);
  }
  children(el, entries, svg, done) {
    const olds = [...el.childNodes], next = [];
    for (const entry of entries) {
      if (Array.isArray(entry)) for (let j = entry[0]; j < entry[0] + entry[1]; j++) next.push(olds[j]);
      else if ('o' in entry) { this.update(olds[entry.o], entry, done); next.push(olds[entry.o]); }
      else next.push(this.create(entry, svg, done));
    }
    const staying = new Set(next);
    for (const old of olds) if (!staying.has(old)) { this.forget(old); old.remove(); }
    next.forEach((child, i) => {
      if (el.childNodes[i] !== child) {
        const before = el.childNodes[i] ?? null;
        // Moving a connected node atomically keeps its focus and IME state.
        if (el.moveBefore && el.isConnected && child.isConnected) el.moveBefore(child, before);
        else el.insertBefore(child, before);
      }
    });
  }
  /// What must follow a node's children: a control's value (its options must
  /// exist first), a canvas's drawing, a modal's showing.
  settle(record, done) {
    const { el, node } = record;
    if (node.tag === '#text') return;
    if (own(node.attrs, 'value') && controls.has(node.tag) &&
        !this.composing.has(el) && el.value !== String(node.attrs.value)) el.value = String(node.attrs.value);
    if (node.tag === 'canvas') { this.canvases.add(record); done.canvases.push(record); }
    if (node.tag === 'dialog' && node.attrs['data-modal'] === 'true') done.modals.push(el);
  }
  /// An element going: its key, its canvas and its listeners with it, so
  /// nothing still holding it (the application's own script) can make it
  /// report an event.
  forget(el) {
    const record = this.records.get(el);
    if (record) {
      if (record.node.key && this.byKey.get(record.node.key) === record) this.byKey.delete(record.node.key);
      this.canvases.delete(record);
      for (const [name, handler] of record.handlers) el.removeEventListener(name, handler);
      record.handlers.clear();
      this.records.delete(el);
    }
    for (const child of el.childNodes) this.forget(child);
  }
  /// A node's own fields onto its element, from what it had.
  fields(record, node) {
    const { el, node: old } = record;
    if (old.key !== node.key) {
      if (old.key && this.byKey.get(old.key) === record) this.byKey.delete(old.key);
      if (node.key) this.byKey.set(node.key, record);
    }
    if (node.tag === '#text') {
      if (el.data !== node.text) el.data = node.text;
      record.node = node;
      return;
    }
    const canvas = node.tag === 'canvas';
    for (const name of Object.keys(old.attrs)) if (!own(node.attrs, name)) {
      el.removeAttribute(name);
      if (name === 'value' && controls.has(node.tag) && !this.composing.has(el)) el.value = '';
      if (name === 'checked' || name === 'selected') el[name] = false;
    }
    for (const [name, value] of Object.entries(node.attrs)) {
      // A control's value is set after its options exist (`settle`); a
      // canvas's size is its backing store's business (`paint`).
      if (name === 'value' && controls.has(node.tag)) continue;
      if (canvas && (name === 'width' || name === 'height')) continue;
      if (name === 'checked' || name === 'selected') el[name] = value;
      else if (booleans.has(name)) el.toggleAttribute(name, value);
      else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value));
    }
    for (const name of Object.keys(old.props)) if (!own(node.props, name)) el[name] = undefined;
    for (const [name, value] of Object.entries(node.props))
      if (JSON.stringify(old.props[name]) !== JSON.stringify(value) || el[name] !== value) el[name] = value;
    for (const name of Object.keys(old.style)) if (!own(node.style, name)) el.style.removeProperty(name);
    for (const [name, value] of Object.entries(node.style)) if (old.style[name] !== value)
      el.style.setProperty(name, value);
    for (const [name, handler] of record.handlers) if (!node.events.includes(name)) {
      el.removeEventListener(name, handler);
      record.handlers.delete(name);
    }
    for (const name of node.events) if (!record.handlers.has(name)) {
      const handler = event => {
        // A form is the program's: submitting it never navigates, and a
        // menu or a link the program handles does not also do its default.
        if (name === 'submit' || name === 'contextmenu' || (name === 'click' && el.tagName === 'A') ||
            name === 'dragover' || name === 'drop') event.preventDefault();
        if (name === 'input' && (event.isComposing || this.composing.has(el))) return;
        this.send({ type: 'dom', id: record.node.id, event: name, value: eventValue(name, event, el) });
      };
      el.addEventListener(name, handler, name === 'wheel' || name === 'scroll' ? { passive: true } : undefined);
      record.handlers.set(name, handler);
    }
    record.node = node;
  }
  dispose() {
    this.root.removeEventListener('compositionstart', this.onCompositionStart);
    this.root.removeEventListener('compositionend', this.onCompositionEnd);
    if (this.root.firstChild) this.forget(this.root.firstChild);
    this.byKey.clear();
    this.root.replaceChildren();
  }
}
