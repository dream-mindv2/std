import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { DomDriver, validateTree, paint } from '../web/dom.mjs';
const { JSDOM, VirtualConsole } = await import(process.env.DREAM_JSDOM ? pathToFileURL(process.env.DREAM_JSDOM) : 'jsdom');
// A node as `std.graphics.describe` writes one: only the fields it has, and
// an id -- the way to it, by key or position -- when it has events.
const node = (tag, key = '', { text: x = '', attrs = {}, props = {}, style = {}, events = [], draw = [],
  children = [], id } = {}) => {
  const n = { t: tag };
  if (key) n.k = key;
  if (x) n.x = x;
  if (Object.keys(attrs).length) n.a = attrs;
  if (Object.keys(props).length) n.p = props;
  if (Object.keys(style).length) n.s = style;
  if (events.length) { n.e = events; n.i = id ?? [key || 0]; }
  if (draw.length) n.d = draw;
  if (children.length) n.c = children;
  return n;
};
const text = value => node('#text', '', { text: value });
// What `std.graphics.diff` sends for one tree after another, written again
// here so a test can say "this, then that" and the page sees patches.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fieldsOf = ({ c, ...rest }) => rest;
function diffNode(o, n) {
  if (same(o, n)) return null;
  const olds = o.c ?? [], kids = diffChildren(olds, n.c ?? []);
  const kept = olds.length === (n.c ?? []).length && (!olds.length || same(kids, [[0, olds.length]]));
  const ownSame = same(fieldsOf(o), fieldsOf(n));
  if (ownSame && kept) return null;
  const entry = ownSame ? {} : fieldsOf(n);
  if (!kept) entry.c = kids;
  return entry;
}
function diffChildren(olds, news) {
  const out = [], keys = new Map(olds.map((o, j) => [o.k, j]).filter(([k]) => k));
  news.forEach((n, i) => {
    const j = n.k ? keys.get(n.k) : olds[i] && !olds[i].k ? i : undefined;
    if (j === undefined || olds[j].t !== n.t) { out.push(n); return; }
    const entry = diffNode(olds[j], n);
    if (entry) { out.push({ o: j, ...entry }); return; }
    const last = out.at(-1);
    if (Array.isArray(last) && last[0] + last[1] === j) last[1]++; else out.push([j, 1]);
  });
  return out;
}
const patchOf = (old, next) => !old || old.t !== next.t || old.k !== next.k ? next
  : (entry => entry && { o: 0, ...entry })(diffNode(old, next));
function setup() {
  // Quiet: jsdom has no canvas, and says so on every paint.
  const dom = new JSDOM('<main></main>', { virtualConsole: new VirtualConsole() });
  const root = dom.window.document.querySelector('main');
  const events = [];
  const driver = new DomDriver(root, e => events.push(e));
  let shown = null;
  const show = tree => {
    const patch = patchOf(shown, tree);
    if (patch) driver.render(patch);
    shown = tree;
  };
  return { dom, root, events, driver, show };
}
test('keyed input retains identity, focus, and selection when siblings move', () => {
  const { root, show, dom } = setup();
  const input = node('input', 'editor', { attrs: { value: 'hello' }, events: ['input'] });
  const label = node('label', 'label');
  show(node('div', 'root', { children: [input, label] }));
  const element = root.querySelector('input');
  element.focus();
  element.setSelectionRange(2, 3);
  show(node('div', 'root', { children: [label, input] }));
  assert.equal(root.querySelector('input'), element);
  assert.equal(dom.window.document.activeElement, element);
  assert.equal(element.selectionStart, 2);
  assert.equal(element.selectionEnd, 3);
});
test('events report the node id, the event and its value, without duplicate listeners', () => {
  const { root, show, events } = setup();
  show(node('button', 'b', { events: ['click'] }));
  show(node('button', 'b', { events: ['click'], text: '' }));
  root.querySelector('button').click();
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].type, events[0].id, events[0].event], ['dom', ['b'], 'click']);
  assert.equal(typeof events[0].value.x, 'number');
  show(node('button', 'b'));
  root.querySelector('button').click();
  assert.equal(events.length, 1);
});
test('an unkeyed control is an interactive control too', () => {
  const { root, show, events, dom } = setup();
  show(node('input', '', { events: ['input'] }));
  const input = root.querySelector('input');
  input.value = 'typed';
  input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  assert.deepEqual(events, [{ type: 'dom', id: [0], event: 'input', value: 'typed' }]);
});
test('a checkbox reports its state and a form its fields', () => {
  const { root, show, events, dom } = setup();
  show(node('form', 'f', { events: ['submit'], children: [
    node('input', 'done', { attrs: { type: 'checkbox', name: 'done' }, events: ['change'] }),
    node('input', 'title', { attrs: { name: 'title', value: 'milk' } })] }));
  const box = root.querySelector('[type=checkbox]');
  box.click();
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(events.map(e => e.value), [true, { done: 'on', title: 'milk' }]);
});
test('composition is not overwritten by a concurrent render', () => {
  const { root, show, dom, events } = setup();
  const view = value => node('input', 'editor', { attrs: { value }, events: ['input'] });
  show(view(''));
  const input = root.firstChild;
  input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'に';
  show(view('old backend value'));
  assert.equal(input.value, 'に');
  input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, isComposing: true }));
  assert.equal(events.length, 0);
  input.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
  input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  assert.equal(events[0].value, 'に');
});
test('typing faster than the program renders loses nothing, and a value the program chooses is written', () => {
  const { root, show, dom, events } = setup();
  const view = value => node('input', 'editor', { attrs: { value }, events: ['input'] });
  show(view(''));
  const input = root.firstChild;
  for (const typed of ['a', 'ab', 'abc']) {
    input.value = typed;
    input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  }
  show(view('a'));
  assert.equal(input.value, 'abc');
  show(view('abc'));
  assert.equal(input.value, 'abc');
  show(view(''));
  assert.equal(input.value, '');
  assert.equal(events.length, 3);
});
test('a control that asks for the focus is given it as it appears, and only then', () => {
  const { root, show, dom } = setup();
  show(node('div', 'page', { children: [node('input', 'a')] }));
  root.querySelector('input').focus();
  show(node('div', 'page', { children: [node('input', 'a'), node('input', 'b', { attrs: { autofocus: true } })] }));
  const [a, b] = root.querySelectorAll('input');
  assert.equal(dom.window.document.activeElement, b);
  a.focus();
  show(node('div', 'page', { children: [node('input', 'a', { attrs: { value: 'x' } }), node('input', 'b', { attrs: { autofocus: true } })] }));
  assert.equal(dom.window.document.activeElement, a);
});
test('invalid trees are rejected before existing DOM changes', () => {
  const { root, show, driver } = setup();
  show(node('p', 'keep', { children: [text('safe')] }));
  const element = root.firstChild;
  assert.throws(() => driver.render(node('div', 'bad', { children: [node('script')] })));
  assert.throws(() => driver.render({ o: 0, c: [[0, 1], { o: 0, t: '#text', x: 'again' }] }));
  assert.throws(() => driver.render({ o: 0, c: [[0, 2]] }));
  assert.throws(() => driver.render({ o: 0, t: 'div', k: 'keep' }));
  assert.equal(root.firstChild, element);
  assert.equal(root.textContent, 'safe');
});
test('data never becomes code', () => {
  const bad = [
    node('img', 'x', { attrs: { onerror: 'alert(1)' } }),
    node('a', 'x', { attrs: { href: 'javascript:alert(1)' } }),
    node('a', 'x', { attrs: { href: ' java\tscript:alert(1)' } }),
    node('a', 'x', { attrs: { href: 'data:text/html,<script>' } }),
    node('div', 'x', { props: { innerHTML: '<img src=x onerror=alert(1)>' } }),
    node('div', 'x', { props: { onclick: 'alert(1)' } }),
    node('div', '', { style: { background: 'url(https://evil)' } }),
    node('iframe', 'x'), node('object', 'x'), node('style', 'x'),
    node('div', '', { events: ['beforeunload'] }),
    node('div', '', { children: [node('p', 'same'), node('p', 'same')] }),
    node('a', 'x', { attrs: { HREF: 'javascript:alert(1)' } }),
    node('div', 'x', { attrs: { STYLE: 'background: url(https://evil)' } }),
    node('a', 'x', { props: { href: 'javascript:alert(1)' } }),
    node('button', 'x', { props: { formAction: 'javascript:alert(1)' } }),
    node('div', 'x', { props: { style: 'background: url(https://evil)' } }),
    node('div', 'x', { props: { cssText: 'color: red' } }),
  ];
  for (const tree of bad) assert.throws(() => validateTree(tree), JSON.stringify(tree));
  validateTree(node('a', 'ok', { attrs: { href: '/about', 'data-id': '7', 'aria-label': 'About' } }));
  validateTree(node('img', 'ok', { attrs: { src: 'data:image/png;base64,AAAA', alt: '' } }));
});
test('a custom element is rendered by name and fed through properties', () => {
  const { root, show, driver } = setup();
  show(node('my-chart', 'chart', { props: { points: [1, 2, 3] }, attrs: { label: 'Sales' } }));
  const el = root.querySelector('my-chart');
  assert.deepEqual(el.points, [1, 2, 3]);
  assert.equal(el.getAttribute('label'), 'Sales');
  assert.equal(driver.element('chart'), el);
  show(node('my-chart', 'chart', { props: {} }));
  assert.equal(el.points, undefined);
});
test('text is literal and SVG uses its namespace', () => {
  const { root, show, driver } = setup();
  show(node('div', '', { children: [text('<img src=x onerror=alert(1)>'),
    node('svg', 'shape', { children: [node('circle', 'circle', { attrs: { r: 5 } })] })] }));
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('circle').namespaceURI, 'http://www.w3.org/2000/svg');
});
test('dispose removes event listeners and owned DOM', () => {
  const { root, show, events, driver } = setup();
  show(node('button', 'b', { events: ['click'] }));
  const button = root.firstChild;
  driver.dispose();
  button.click();
  assert.equal(root.childNodes.length, 0);
  assert.equal(events.length, 0);
});
test('moving the focused input itself preserves its selection', () => {
  const { root, show, dom } = setup();
  const input = node('input', 'editor', { attrs: { value: 'hello' } });
  const sibling = node('span', 'sibling');
  show(node('div', 'root', { children: [sibling, input] }));
  const element = root.querySelector('input');
  element.focus();
  element.setSelectionRange(1, 4, 'backward');
  show(node('div', 'root', { children: [input, sibling] }));
  assert.equal(dom.window.document.activeElement, element);
  assert.deepEqual([element.selectionStart, element.selectionEnd, element.selectionDirection], [1, 4, 'backward']);
});
test('select values apply after options are created and replaced', () => {
  const { root, show, driver } = setup();
  const view = (value, values) => node('select', 's', { attrs: { value }, children: values.map(v =>
    node('option', v, { attrs: { value: v }, children: [text(v)] })) });
  show(view('b', ['a', 'b']));
  assert.equal(root.firstChild.value, 'b');
  show(view('c', ['b', 'c']));
  assert.equal(root.firstChild.value, 'c');
});
test('removed or replaced controls cannot emit stale events', () => {
  const { root, show, events } = setup();
  show(node('button', 'b', { events: ['click'] }));
  const removed = root.firstChild;
  show(node('button', 'other'));
  removed.click();
  show(node('button', 'b', { events: ['click'] }));
  const replaced = root.firstChild;
  show(node('div', 'b'));
  replaced.click();
  assert.deepEqual(events, []);
});
test('a canvas is sized in CSS pixels and keeps its drawing off other elements', () => {
  const { root, show, driver } = setup();
  show(node('canvas', 'c', { attrs: { width: 120, height: 80 }, draw: [{ op: 'clear', color: 'black' }] }));
  const canvas = root.querySelector('canvas');
  assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [120, 80, '120px', '80px']);
  assert.throws(() => validateTree(node('div', 'x', { draw: [{ op: 'clear', color: 'red' }] })));
});
test('a drawing replays as canvas calls, groups restoring what they changed', () => {
  const calls = [];
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get: (t, k) => k in t ? t[k] : (...args) => calls.push([k, ...args]),
    set: (t, k, v) => { t[k] = v; calls.push([`=${String(k)}`, v]); return true; },
  });
  paint(ctx, [
    { op: 'clear', color: '#000' },
    { op: 'fill', color: 'red', shape: { kind: 'rect', x: 1, y: 2, w: 3, h: 4 } },
    { op: 'group', settings: { translate: [10, 20], alpha: 0.5 }, drawing: [
      { op: 'stroke', color: 'blue', width: 2, shape: { kind: 'polygon', points: [[0, 0], [5, 0], [5, 5]] } }] },
    { op: 'text', font: '12px serif', color: 'white', align: 'center', x: 5, y: 6, text: 'hi' },
  ], { width: 100, height: 50 });
  const names = calls.map(c => c[0]);
  assert.deepEqual(calls.find(c => c[0] === 'fillRect'), ['fillRect', 0, 0, 100, 50]);
  assert.deepEqual(calls.find(c => c[0] === 'rect'), ['rect', 1, 2, 3, 4]);
  assert.ok(names.indexOf('save') < names.indexOf('translate') && names.indexOf('closePath') < names.indexOf('restore'));
  assert.deepEqual(calls.find(c => c[0] === 'fillText'), ['fillText', 'hi', 5, 6]);
  assert.throws(() => paint(ctx, [{ op: 'explode' }], { width: 1, height: 1 }));
});
test('a patch keeps what it does not name, element for element', () => {
  const { root, driver } = setup();
  const li = (k, extra) => node('li', k, { children: [text(k)], ...extra });
  driver.render(node('ul', '', { children: [li('a'), li('b'), li('c')] }));
  const [a, b, c] = root.querySelectorAll('li');
  driver.render({ o: 0, c: [[2, 1], { o: 1, t: 'li', k: 'b', a: { class: 'on' } }, [0, 1], li('d')] });
  const now = [...root.querySelectorAll('li')];
  assert.deepEqual(now.slice(0, 3), [c, b, a]);
  assert.deepEqual([b.className, b.textContent, now[3].textContent], ['on', 'b', 'd']);
  driver.render({ o: 0, c: [[1, 1]] });
  assert.deepEqual([...root.querySelectorAll('li')], [b]);
  assert.equal(driver.element('a'), null);
  assert.equal(driver.element('b'), b);
});
test('a key is the page\'s once: brought in twice, or while still shown, is refused', () => {
  const { root, driver } = setup();
  driver.render(node('div', '', { children: [node('p', 'x'), node('p', 'y')] }));
  const before = root.innerHTML;
  assert.throws(() => driver.render({ o: 0, c: [[0, 2], node('p', 'x')] }), /duplicate key x/);
  assert.throws(() => driver.render({ o: 0, c: [[0, 2], node('p', 'z'), node('p', 'z')] }), /duplicate key z/);
  assert.equal(root.innerHTML, before);
  // Going in the same patch, it may come back somewhere else, as a new element.
  driver.render({ o: 0, c: [[1, 1], node('section', '', { children: [node('p', 'x')] })] });
  assert.equal(driver.element('x').parentNode.tagName, 'SECTION');
});
test('an element that takes over keys keeps them, less the chords it passes and bare modifiers', () => {
  const { root, show, dom, events } = setup();
  show(node('div', 'term', { attrs: { tabindex: 0, 'data-dream-prevent': 'keydown', 'data-dream-pass': 'ctrl+c' },
    events: ['keydown'] }));
  const el = root.firstChild;
  const press = (key, more = {}) => {
    const e = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  };
  assert.deepEqual([press('a'), press('Tab'), press('c', { ctrlKey: true }), press('Shift', { shiftKey: true })],
    [true, true, false, false]);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(e => e.value.key), ['a', 'Tab', 'c', 'Shift']);
});
test('the chords a control keeps are kept though nothing listens for keys there', () => {
  const { root, show, dom, events } = setup();
  show(node('textarea', 'sql', { attrs: { 'data-dream-keys': 'ctrl+enter meta+enter' }, events: ['input'] }));
  const el = root.firstChild;
  const press = (key, more = {}) => {
    const e = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  };
  assert.deepEqual([press('Enter', { ctrlKey: true }), press('Enter', { metaKey: true }), press('Enter'), press('x')],
    [true, true, false, false]);
  assert.equal(events.length, 0);
});
test('a paste reports its text, and taking it over keeps the browser from inserting it', () => {
  const { root, show, dom, events } = setup();
  show(node('textarea', 'in', { attrs: { 'data-dream-prevent': 'paste' }, events: ['paste'] }));
  const el = root.firstChild;
  const e = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { getData: type => type === 'text/plain' ? 'ls -la\n' : '' } });
  el.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(events.map(x => [x.event, x.value]), [['paste', 'ls -la\n']]);
});
