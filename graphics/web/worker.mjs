// No shared memory or browser threads. The host regains control after slices.
import createRuntime from './dream-browser.mjs';
const MAX_BYTES = 1024 * 1024;
let runtime, loaded = false, ready = false, stopped = false, queued = [], timer, pendingRender;
const encoder = new TextEncoder();
function stop(error) {
  stopped = true;
  clearTimeout(timer);
  runtime?._dream_browser_dispose();
  postMessage({ type: 'failure', message: String(error) });
}
function event(value) {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > MAX_BYTES) throw new Error('event too large');
  const ptr = runtime._malloc(bytes.length);
  if (!ptr) throw new Error('event allocation failed');
  try {
    runtime.HEAPU8.set(bytes, ptr);
    if (!runtime._dream_browser_event(ptr, bytes.length)) throw new Error('graphics event queue is full');
  } finally { runtime._free(ptr); }
}
function tick() {
  if (stopped) return;
  try {
    const deadline = performance.now() + 4;
    let status;
    do { status = runtime._dream_browser_tick(); }
    while (status === 1 && performance.now() < deadline);
    if (status < 0) throw new Error('Dream frontend failed');
    if (!status) { stopped = true; postMessage({ type: 'finished' }); return; }
    if (pendingRender) { postMessage(pendingRender); pendingRender = null; }
    const delay = runtime._dream_browser_delay();
    if (delay >= 0) timer = setTimeout(tick, delay);
  } catch (e) { stop(e); }
}
onmessage = async ({ data }) => {
  if (stopped) return;
  try {
    if (data.type === 'start') {
      if (runtime || loaded) throw new Error('frontend already started');
      loaded = true;
      runtime = await createRuntime({
        onMessage: text => {
          if (encoder.encode(text).length > MAX_BYTES) throw new Error('render exceeds limit');
          const message = JSON.parse(text);
          if (message.type === 'render') pendingRender = message;
          else postMessage(message);
        },
        onError: message => postMessage({ type: 'failure', message }),
        print: text => postMessage({ type: 'log', message: text }),
        printErr: text => postMessage({ type: 'log', message: text })
      });
      const response = await fetch(new URL('./frontend.dream', import.meta.url));
      if (!response.ok) throw new Error('cannot load frontend.dream');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 64 * 1024 * 1024) throw new Error('frontend image exceeds limit');
      const ptr = runtime._malloc(bytes.length);
      if (!ptr) throw new Error('frontend allocation failed');
      try {
        runtime.HEAPU8.set(bytes, ptr);
        if (!runtime._dream_browser_load(ptr, bytes.length)) throw new Error('invalid frontend image');
      } finally { runtime._free(ptr); }
      ready = true;
      for (const value of queued) event(value);
      queued = [];
      tick();
    } else if (data.type === 'event') {
      if (!ready) {
        if (queued.length >= 256) throw new Error('startup queue is full');
        queued.push(data.event);
      } else {
        event(data.event);
        clearTimeout(timer);
        timer = setTimeout(tick, 0);
      }
    } else if (data.type === 'dispose') {
      stopped = true;
      clearTimeout(timer);
      runtime?._dream_browser_dispose();
      close();
    }
  } catch (e) { stop(e); }
};
