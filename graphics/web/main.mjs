// The page's half of std.graphics: the worker running the program on one
// side, the DOM and the browser's services on the other, and between them the
// protocol `std.graphics.browser` speaks.
//
// From the program: `open`, `render` (patches, applied a frame at a time),
// `subscribe` (the whole set, diffed here), `styles`, `request` (a service,
// answered with a `reply` unless its id is 0) and `close`. To it: `dom`,
// `sub`, `port`, `reply` and `close` events. Every message is JSON.
//
// **Breaking out.** An application may ship JavaScript of its own (`[graphics]
// js` in its manifest), listed in `app.json`. Each module is imported before
// the program starts, and its `setup(dream)`, if it has one, is given:
//
//   dream.handle(name, fn)   fn(args) answers `browser.js! name args`; it may be
//                            async, and what it throws is the error
//   dream.send(name, value)  a message for `ui.on_port name`
//   dream.element(key)       the element a Dream node with that key rendered to
//   dream.afterRender(fn)    called after every render, for a widget that
//                            needs to see the DOM it lives in
//   dream.root               the element the program renders into
//
// and may define custom elements, which a program renders by name and feeds
// through properties (`html.prop`). Its own CSS (`[graphics] css`) is linked
// by `index.html`.
//
// **The desktop host.** Under `dream --graphics` the page has `ipc`, the
// webview's channel to the VM: a backend request goes there as an `invoke`
// whose reply name is the request id, and the window's close arrives as an
// event named `close`. In a tab there is no `ipc`, and a backend request is
// answered `backend_unavailable`.
import { DomDriver, eventValue } from './dom.mjs';

const location = scope => {
  const l = scope.location ?? { pathname: '/', search: '', hash: '', href: '' };
  return { path: l.pathname, query: l.search.replace(/^\?/, ''), hash: l.hash.replace(/^#/, ''), href: l.href };
};

export async function startApplication(root, worker, scope = globalThis, { modules = [] } = {}) {
  let pending = [], frame, failed = false, finished = false;
  const toProgram = event => { if (!failed && !finished) worker.postMessage({ type: 'event', event }); };
  const handlers = new Map(), afterRender = [], ports = new Set(), subs = new Map();
  const driver = new DomDriver(root, toProgram, { afterRender: () => afterRender.forEach(fn => fn()) });
  // Structured, not text: the desktop host reads it as the value WebKit hands
  // it, and runs no JavaScript of its own to parse one.
  const host = message => scope.ipc?.postMessage(message);
  const doc = root.ownerDocument;
  let stylesheet = null;

  function failure(message) {
    if (failed) return;
    failed = true;
    scope.cancelAnimationFrame(frame);
    for (const sub of subs.values()) sub.stop();
    worker.terminate();
    driver.dispose();
    const text = doc.createElement('p');
    text.setAttribute('role', 'alert');
    text.textContent = `The application stopped: ${message}`;
    root.append(text);
    host({ type: 'failure', message: String(message) });
  }
  const reply = (id, ok, value) => {
    if (id) toProgram(ok ? { type: 'reply', id, ok: true, value } : { type: 'reply', id, ok: false, error: String(value) });
  };

  // --- services: what `request` can ask for ---------------------------------
  const storage = () => { try { return scope.localStorage ?? null; } catch { return null; } };
  const element = key => {
    const el = driver.element(String(key));
    if (!el) throw new Error(`no element has the key ${key}`);
    return el;
  };
  const services = {
    async fetch({ url, method = 'GET', headers = {}, body = '' }) {
      const response = await scope.fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
      return { status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers), body: await response.text() };
    },
    'storage.get': ({ key }) => storage()?.getItem(String(key)) ?? null,
    'storage.set': ({ key, value }) => { storage()?.setItem(String(key), String(value)); return null; },
    'storage.remove': ({ key }) => { storage()?.removeItem(String(key)); return null; },
    navigate({ url, replace }) {
      scope.history?.[replace ? 'replaceState' : 'pushState'](null, '', String(url));
      announceUrl();
      return null;
    },
    back: () => { scope.history?.back(); return null; },
    title: ({ title }) => { doc.title = String(title); return null; },
    focus: ({ key }) => { element(key).focus(); return null; },
    blur: ({ key }) => { element(key).blur(); return null; },
    scroll: ({ key }) => { element(key).scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); return null; },
    measure: ({ key }) => {
      const r = element(key).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    clipboard: async ({ text }) => { await scope.navigator?.clipboard?.writeText(String(text)); return null; },
    async js({ name, args }) {
      const fn = handlers.get(name);
      if (!fn) throw new Error(`no JavaScript function is registered as ${name}`);
      const value = await fn(args);
      return value === undefined ? null : value;
    },
  };
  // A service that acts on an element sees the tree the program last sent,
  // even when the frame that would have drawn it has not come yet.
  const onElements = new Set(['focus', 'blur', 'scroll', 'measure']);
  function flush() {
    if (!frame) return;
    scope.cancelAnimationFrame(frame);
    frame = null;
    draw();
  }
  // Patches wait for the next frame, and are applied in order: each is of the
  // page the one before it made.
  function draw() {
    const patches = pending;
    pending = [];
    for (const patch of patches) driver.render(patch);
  }
  async function request({ id, service, args }) {
    if (service === 'backend') {
      if (scope.ipc?.postMessage) host({ type: 'invoke', reply: String(id), command: args.command, payload: args.payload });
      else reply(id, false, 'backend_unavailable');
      return;
    }
    const run = services[service];
    if (!run) { reply(id, false, `unknown service ${service}`); return; }
    try {
      if (onElements.has(service)) flush();
      reply(id, true, await run(args ?? {}));
    }
    catch (e) { reply(id, false, e?.message ?? e); }
  }

  // --- subscriptions --------------------------------------------------------
  const fire = (id, value) => toProgram({ type: 'sub', id, value });
  function announceUrl() { if (subs.has('url')) fire('url', location(scope)); }
  const listen = (target, name, fn) => { target?.addEventListener(name, fn); return () => target?.removeEventListener(name, fn); };
  const starters = {
    every: ({ id, ms }) => { const t = scope.setInterval(() => fire(id, Date.now()), Math.max(1, ms)); return () => scope.clearInterval(t); },
    frame: ({ id }) => {
      let f;
      const tick = time => { fire(id, time); f = scope.requestAnimationFrame(tick); };
      f = scope.requestAnimationFrame(tick);
      return () => scope.cancelAnimationFrame(f);
    },
    keydown: ({ id }) => listen(scope, 'keydown', e => fire(id, eventValue('keydown', e))),
    keyup: ({ id }) => listen(scope, 'keyup', e => fire(id, eventValue('keyup', e))),
    resize: ({ id }) => {
      const size = () => fire(id, { width: scope.innerWidth ?? 0, height: scope.innerHeight ?? 0 });
      size();
      return listen(scope, 'resize', size);
    },
    url: ({ id }) => {
      fire(id, location(scope));
      const a = listen(scope, 'popstate', () => fire(id, location(scope)));
      const b = listen(scope, 'hashchange', () => fire(id, location(scope)));
      return () => { a(); b(); };
    },
    visible: ({ id }) => {
      const now = () => fire(id, doc.visibilityState !== 'hidden');
      now();
      return listen(doc, 'visibilitychange', now);
    },
    port: ({ name }) => { ports.add(name); return () => ports.delete(name); },
  };
  function subscribe(list) {
    const wanted = new Map(list.map(s => [s.id, s]));
    for (const [id, sub] of subs) if (!wanted.has(id)) { sub.stop(); subs.delete(id); }
    for (const [id, s] of wanted) if (!subs.has(id)) {
      const start = starters[s.kind];
      if (!start) throw new Error(`unknown subscription ${s.kind}`);
      // Registered before it starts, so one that fires at once (`url`, `resize`) is heard.
      const entry = { stop: () => {} };
      subs.set(id, entry);
      entry.stop = start(s);
    }
  }

  // A link within the application is the program's to follow: it becomes a
  // `url` event, as `navigate!` does, rather than a page load.
  const onClick = event => {
    const a = event.target?.closest?.('a[href]');
    if (!a || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey ||
        event.altKey || a.target || a.hasAttribute('download') || !subs.has('url')) return;
    const url = new URL(a.getAttribute('href'), scope.location?.href ?? 'http://localhost/');
    if (scope.location && url.origin !== scope.location.origin) return;
    event.preventDefault();
    services.navigate({ url: url.pathname + url.search + url.hash, replace: false });
  };
  root.addEventListener('click', onClick);

  worker.onerror = event => {
    event.preventDefault?.();
    failure(event.message ?? `the program's worker could not start${event.filename ? ` (${event.filename})` : ''}`);
  };
  worker.onmessage = ({ data }) => {
    if (failed) return;
    try {
      switch (data.type) {
        case 'render':
          pending.push(...data.patches);
          if (!frame) frame = scope.requestAnimationFrame(() => {
            frame = null;
            try { draw(); } catch (e) { failure(e.message); }
          });
          break;
        case 'open':
          doc.title = String(data.options.title);
          host(data);
          break;
        case 'subscribe': subscribe(data.subs); break;
        case 'styles':
          stylesheet ??= doc.head?.appendChild(doc.createElement('style')) ?? null;
          if (stylesheet) stylesheet.textContent = String(data.css);
          break;
        case 'request': request(data); break;
        case 'invoke': // the protocol before requests: a backend call by reply name
          if (scope.ipc?.postMessage) host(data);
          break;
        // The driver closing is not the program ending: a loop that failed
        // closes its driver on the way out, and the failure comes after.
        // `finished` is the end, and closes the window with the run's status.
        case 'close': break;
        case 'failure': failure(data.message); break;
        case 'log':
          // What the program prints. On the desktop it is the terminal's, as
          // the backend's is; in a tab it is the console's.
          if (scope.ipc?.postMessage) host({ type: 'log', stream: data.stream, message: String(data.message) });
          else if (data.stream === 'stderr') scope.console.error(data.message);
          else scope.console.info(data.message);
          break;
        case 'finished':
          finished = true;
          for (const sub of subs.values()) sub.stop();
          worker.terminate();
          host({ type: 'close', code: data.code ?? 0 });
          break;
        default: throw new Error(`unknown graphics message ${data.type}`);
      }
    } catch (e) { failure(e.message); }
  };
  // The desktop host's messages: a backend's reply, named by request id, or
  // the window closing. Data, delivered as one JSON argument.
  Object.defineProperty(scope, '__dreamReceive', { value: message => {
    if (message?.name === 'close') toProgram({ type: 'close' });
    else if (message && /^\d+$/.test(String(message.name))) toProgram({ type: 'reply', id: Number(message.name), payload: message.payload });
  }, writable: false, configurable: true });
  scope.addEventListener('pagehide', () => {
    finished = true;
    scope.cancelAnimationFrame(frame);
    for (const sub of subs.values()) sub.stop();
    worker.terminate();
    driver.dispose();
  });

  const dream = Object.freeze({
    root,
    handle(name, fn) {
      if (typeof name !== 'string' || typeof fn !== 'function') throw new TypeError('dream.handle(name, fn)');
      handlers.set(name, fn);
    },
    send(name, value) {
      if (!ports.has(name)) return false;
      toProgram({ type: 'port', name, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });
      return true;
    },
    element: key => driver.element(String(key)),
    afterRender(fn) { if (typeof fn === 'function') afterRender.push(fn); },
  });
  for (const module of modules) {
    try { await module.setup?.(dream); }
    catch (e) { failure(`application script failed: ${e?.message ?? e}`); return; }
  }
  worker.postMessage({ type: 'start' });
}

/// The application's own scripts, as `mind build` listed them. An application
/// without any has no `app.json`; one whose script does not load must not
/// start as though it did.
async function applicationModules() {
  const response = await fetch(new URL('./app.json', import.meta.url)).catch(() => null);
  if (!response?.ok) return [];
  const { js = [] } = await response.json();
  return Promise.all(js.map(name => import(new URL(`./${name}`, import.meta.url))));
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('dream-root');
  applicationModules().then(modules => startApplication(root,
    new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' }), globalThis, { modules }),
  error => {
    const text = document.createElement('p');
    text.setAttribute('role', 'alert');
    text.textContent = `The application stopped: its script did not load: ${error?.message ?? error}`;
    root.append(text);
    globalThis.ipc?.postMessage({ type: 'failure', message: String(error?.message ?? error) });
  });
}
