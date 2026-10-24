import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { startApplication } from '../web/main.mjs';
const { JSDOM } = await import(process.env.DREAM_JSDOM ? pathToFileURL(process.env.DREAM_JSDOM) : 'jsdom');

// A page with fake timers and frames, a worker that records what it is sent,
// and, for a desktop run, the webview's `ipc`.
async function setup({ native = false, modules = [], fetch } = {}) {
  const dom = new JSDOM('<head></head><main></main>', { url: 'http://app.test/start?x=1#top' });
  const win = dom.window;
  const root = win.document.querySelector('main');
  const sent = [], ipc = [], frames = new Map(), intervals = new Map();
  let terminated = 0, next = 0, onHide;
  const worker = { postMessage: m => sent.push(m), terminate: () => terminated++ };
  const scope = { console, location: win.location, history: win.history, localStorage: win.localStorage,
    innerWidth: 800, innerHeight: 600, navigator: win.navigator, fetch,
    addEventListener: (name, handler) => { if (name === 'pagehide') onHide = handler; else win.addEventListener(name, handler); },
    removeEventListener: (name, handler) => win.removeEventListener(name, handler),
    requestAnimationFrame: fn => { frames.set(++next, fn); return next; },
    cancelAnimationFrame: id => frames.delete(id),
    setInterval: fn => { intervals.set(++next, fn); return next; },
    clearInterval: id => intervals.delete(id),
    ...(native ? { ipc: { postMessage: m => ipc.push(structuredClone(m)) } } : {}) };
  await startApplication(root, worker, scope, { modules });
  const events = () => sent.filter(m => m.type === 'event').map(m => m.event);
  return { dom, win, root, scope, sent, ipc, frames, intervals, events, terminated: () => terminated,
    hide: () => onHide(), message: data => worker.onmessage({ data }),
    flush: () => { const fs = [...frames.values()]; frames.clear(); fs.forEach(fn => fn(0)); },
    settle: () => new Promise(r => setTimeout(r, 0)) };
}
// Nodes as `std.graphics.describe` writes them.
const tree = text => ({ t: '#text', x: text });
const el = (tag, key, { attrs, children } = {}) => ({ t: tag, ...(key ? { k: key } : {}), ...(attrs ? { a: attrs } : {}),
  ...(children ? { c: children } : {}) });

test('the window title and a backend call reach the desktop host, and its reply the program', async () => {
  const app = await setup({ native: true });
  const open = { type: 'open', options: { title: 'Window title', width: 800, height: 600 } };
  app.message(open);
  assert.equal(app.root.ownerDocument.title, 'Window title');
  app.message({ type: 'request', id: 12, service: 'backend', args: { command: 'echo', payload: '9007199254740993' } });
  assert.deepEqual(app.ipc, [open, { type: 'invoke', reply: '12', command: 'echo', payload: '9007199254740993' }]);
  app.scope.__dreamReceive({ name: '12', key: '', payload: '{"ok":true,"value":9007199254740993}' });
  assert.deepEqual(app.events().at(-1), { type: 'reply', id: 12, payload: '{"ok":true,"value":9007199254740993}' });
  app.scope.__dreamReceive({ name: 'close', key: '', value: null });
  assert.deepEqual(app.events().at(-1), { type: 'close' });
});
test('in a tab, a backend call is answered backend_unavailable', async () => {
  const app = await setup();
  app.message({ type: 'request', id: 3, service: 'backend', args: { command: 'echo', payload: '1' } });
  await app.settle();
  assert.deepEqual(app.events().at(-1), { type: 'reply', id: 3, ok: false, error: 'backend_unavailable' });
});
test('storage keeps what is saved, and an unknown key is null', async () => {
  const app = await setup();
  app.message({ type: 'request', id: 0, service: 'storage.set', args: { key: 'k', value: '[1,2]' } });
  app.message({ type: 'request', id: 1, service: 'storage.get', args: { key: 'k' } });
  app.message({ type: 'request', id: 2, service: 'storage.get', args: { key: 'missing' } });
  await app.settle();
  assert.deepEqual(app.events(), [{ type: 'reply', id: 1, ok: true, value: '[1,2]' }, { type: 'reply', id: 2, ok: true, value: null }]);
});
test('fetch answers status, headers and body, and a failure is an error', async () => {
  let calls = 0;
  const app = await setup({ fetch: async (url, init) => {
    if (calls++) throw new Error('offline');
    return new Response(`${init.method} ${url}`, { status: 201, headers: { 'x-a': 'b' } });
  } });
  app.message({ type: 'request', id: 5, service: 'fetch', args: { url: '/api', method: 'POST', headers: {}, body: '{}' } });
  app.message({ type: 'request', id: 6, service: 'fetch', args: { url: '/api' } });
  await new Promise(r => setTimeout(r, 10));
  const [a, b] = app.events().sort((x, y) => x.id - y.id);
  assert.deepEqual([a.id, a.value.status, a.value.ok, a.value.body, a.value.headers['x-a']], [5, 201, true, 'POST /api', 'b']);
  assert.deepEqual(b, { type: 'reply', id: 6, ok: false, error: 'offline' });
});
test('subscriptions start once, fire, and stop when the program drops them', async () => {
  const app = await setup();
  app.message({ type: 'subscribe', subs: [{ id: 'every:100', kind: 'every', ms: 100 }, { id: 'resize', kind: 'resize' }] });
  assert.equal(app.intervals.size, 1);
  assert.deepEqual(app.events()[0], { type: 'sub', id: 'resize', value: { width: 800, height: 600 } });
  app.message({ type: 'subscribe', subs: [{ id: 'every:100', kind: 'every', ms: 100 }] });
  assert.equal(app.intervals.size, 1, 'kept, not restarted');
  [...app.intervals.values()][0]();
  assert.equal(app.events().at(-1).id, 'every:100');
  app.message({ type: 'subscribe', subs: [] });
  assert.equal(app.intervals.size, 0);
});
test('routing: the url subscription hears navigate and in-app links, not other origins', async () => {
  const app = await setup();
  app.message({ type: 'subscribe', subs: [{ id: 'url', kind: 'url' }] });
  assert.deepEqual(app.events()[0].value, { path: '/start', query: 'x=1', hash: 'top', href: 'http://app.test/start?x=1#top' });
  app.message({ type: 'request', id: 0, service: 'navigate', args: { url: '/items/7', replace: false } });
  assert.equal(app.events().at(-1).value.path, '/items/7');
  app.message({ type: 'render', patches: [el('div', '', { children: [el('a', 'in', { attrs: { href: '/about' } }), el('a', 'out', { attrs: { href: 'https://elsewhere.test/' } })] })] });
  app.flush();
  const [inner, outer] = app.root.querySelectorAll('a');
  inner.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(app.events().at(-1).value.path, '/about');
  const count = app.events().length;
  const click = new app.win.MouseEvent('click', { bubbles: true, cancelable: true });
  outer.addEventListener('click', e => e.preventDefault()); // jsdom cannot navigate away
  outer.dispatchEvent(click);
  assert.equal(app.events().length, count);
});
test('application JavaScript: functions Dream calls, ports it hears, elements by key', async () => {
  let dream;
  const app = await setup({ modules: [{ setup: d => {
    dream = d;
    d.handle('double', async ({ n }) => n * 2);
    d.handle('broken', () => { throw new Error('nope'); });
  } }] });
  app.message({ type: 'request', id: 1, service: 'js', args: { name: 'double', args: { n: 21 } } });
  app.message({ type: 'request', id: 2, service: 'js', args: { name: 'broken', args: null } });
  app.message({ type: 'request', id: 3, service: 'js', args: { name: 'missing', args: null } });
  await app.settle();
  assert.deepEqual(app.events().sort((x, y) => x.id - y.id).map(e => [e.id, e.ok, e.value ?? e.error]),
    [[1, true, 42], [2, false, 'nope'], [3, false, 'no JavaScript function is registered as missing']]);
  assert.equal(dream.send('ticks', 1), false, 'nobody listening');
  app.message({ type: 'subscribe', subs: [{ id: 'port:ticks', kind: 'port', name: 'ticks' }] });
  assert.equal(dream.send('ticks', { n: 1 }), true);
  assert.deepEqual(app.events().at(-1), { type: 'port', name: 'ticks', value: { n: 1 } });
  app.message({ type: 'render', patches: [el('div', 'box')] });
  app.flush();
  assert.equal(dream.element('box'), app.root.firstChild);
  assert.ok(app.sent.some(m => m.type === 'start'), 'started after setup');
});
test('a failing application script stops the page before the program starts', async () => {
  const app = await setup({ native: true, modules: [{ setup: () => { throw new Error('bad widget'); } }] });
  assert.match(app.root.querySelector('[role=alert]').textContent, /bad widget/);
  assert.ok(!app.sent.some(m => m.type === 'start'));
  assert.equal(app.ipc[0].type, 'failure');
});
test('the program stylesheet is one style element, replaced in place', async () => {
  const app = await setup();
  app.message({ type: 'styles', css: '.a { color: red; }' });
  app.message({ type: 'styles', css: '.a { color: blue; }' });
  const styles = app.root.ownerDocument.querySelectorAll('style');
  assert.equal(styles.length, 1);
  assert.equal(styles[0].textContent, '.a { color: blue; }');
});
test('focus and measure act on the element a key names', async () => {
  const app = await setup();
  app.message({ type: 'render', patches: [el('input', 'name')] });
  app.flush();
  app.message({ type: 'request', id: 0, service: 'focus', args: { key: 'name' } });
  await app.settle();
  assert.equal(app.root.ownerDocument.activeElement, app.root.querySelector('input'));
  app.message({ type: 'request', id: 9, service: 'focus', args: { key: 'nothing' } });
  await app.settle();
  assert.deepEqual(app.events().at(-1), { type: 'reply', id: 9, ok: false, error: 'no element has the key nothing' });
});
test('the window closes when the program finishes, with its status, not when its driver closes', async () => {
  const app = await setup({ native: true });
  app.message({ type: 'close' });
  assert.deepEqual(app.ipc, []);
  app.message({ type: 'finished', code: 3 });
  assert.deepEqual(app.ipc, [{ type: 'close', code: 3 }]);
});
test('completion keeps the final scheduled render visible, every patch applied in order', async () => {
  const app = await setup();
  app.message({ type: 'render', patches: [tree('first')] });
  app.message({ type: 'render', patches: [{ o: 0, t: '#text', x: 'second' }, { o: 0, t: '#text', x: 'final' }] });
  app.message({ type: 'finished', code: 0 });
  assert.equal(app.frames.size, 1);
  app.flush();
  assert.equal(app.root.textContent, 'final');
  assert.equal(app.terminated(), 1);
});
test('render failures stop the worker and notify the host exactly once', async () => {
  const app = await setup({ native: true });
  app.message({ type: 'render', patches: [{}] });
  app.flush();
  app.message({ type: 'failure', message: 'second error' });
  assert.match(app.root.querySelector('[role=alert]').textContent, /invalid node/);
  assert.equal(app.terminated(), 1);
  assert.equal(app.ipc.length, 1);
  assert.equal(app.ipc[0].type, 'failure');
});
test('page unload cancels pending renders and subscriptions', async () => {
  const app = await setup();
  app.message({ type: 'render', patches: [tree('pending')] });
  app.message({ type: 'subscribe', subs: [{ id: 'every:5', kind: 'every', ms: 5 }] });
  app.hide();
  assert.equal(app.frames.size, 0);
  assert.equal(app.intervals.size, 0);
  assert.equal(app.root.textContent, '');
  assert.equal(app.terminated(), 1);
});
