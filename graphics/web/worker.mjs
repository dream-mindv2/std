// No shared memory or browser threads. The host regains control after slices.
const MAX_BYTES = 1024 * 1024, MAX_RENDER_BYTES = 16 * MAX_BYTES;

export function installWorker(scope, createRuntime) {
  let runtime, loaded = false, ready = false, stopped = false, queued = [], timer, pendingRender, runtimeError;
  const encoder = new TextEncoder();
  function dispose() {
    scope.clearTimeout(timer);
    runtime?._dream_browser_dispose();
    runtime = null;
    queued = [];
  }
  function stop(error) {
    if (stopped) return;
    stopped = true;
    dispose();
    scope.postMessage({ type: 'failure', message: String(error) });
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
      const deadline = scope.performance.now() + 4;
      let status;
      do { status = runtime._dream_browser_tick(); }
      while (status === 1 && scope.performance.now() < deadline);
      if (status < 0 || runtimeError) throw new Error(runtimeError || 'Dream frontend failed');
      // A program may render and finish in the same slice.
      if (pendingRender) { scope.postMessage(pendingRender); pendingRender = null; }
      if (!status) {
        stopped = true;
        const code = runtime._dream_browser_exit_code?.() ?? 0;
        dispose();
        scope.postMessage({ type: 'finished', code });
        return;
      }
      const delay = runtime._dream_browser_delay();
      if (delay >= 0) timer = scope.setTimeout(tick, delay);
    } catch (e) { stop(e); }
  }
  scope.onmessage = async ({ data }) => {
    if (stopped) return;
    try {
      if (data.type === 'start') {
        if (loaded) throw new Error('frontend already started');
        loaded = true;
        const instance = await createRuntime({
          onMessage: text => {
            if (encoder.encode(text).length > MAX_RENDER_BYTES) throw new Error('render exceeds limit');
            const message = JSON.parse(text);
            // The renders of one slice go to the page as one message -- every
            // patch, since each is of what the one before made -- but nothing
            // may overtake them: a request after a render (focus the field
            // that render made) must reach the page after it.
            if (message.type === 'render') {
              pendingRender ??= { type: 'render', patches: [] };
              pendingRender.patches.push(message.patch);
            }
            else {
              if (pendingRender) { scope.postMessage(pendingRender); pendingRender = null; }
              scope.postMessage(message);
            }
          },
          // Defer disposal until the runtime has returned from its Wasm call.
          onError: message => { runtimeError = message; },
          print: text => scope.postMessage({ type: 'log', stream: 'stdout', message: text }),
          printErr: text => scope.postMessage({ type: 'log', stream: 'stderr', message: text })
        });
        if (stopped) { instance._dream_browser_dispose(); return; }
        runtime = instance;
        const response = await scope.fetch(new URL('./frontend.dream', import.meta.url));
        if (stopped) return;
        if (!response.ok) throw new Error('cannot load frontend.dream');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (stopped) return;
        if (bytes.length > 64 * 1024 * 1024) throw new Error('frontend image exceeds limit');
        const ptr = runtime._malloc(bytes.length);
        if (!ptr) throw new Error('frontend allocation failed');
        try {
          runtime.HEAPU8.set(bytes, ptr);
          if (!runtime._dream_browser_load(ptr, bytes.length)) throw new Error(runtimeError || 'invalid frontend image');
        } finally { runtime._free(ptr); }
        ready = true;
        for (const value of queued) event(value);
        queued = [];
        tick();
      } else if (data.type === 'event') {
        // Bound the bytes as well as the count while the runtime is loading.
        if (encoder.encode(JSON.stringify(data.event)).length > MAX_BYTES) throw new Error('event too large');
        if (!ready) {
          if (queued.length >= 256) throw new Error('startup queue is full');
          queued.push(data.event);
        } else {
          event(data.event);
          scope.clearTimeout(timer);
          timer = scope.setTimeout(tick, 0);
        }
      } else if (data.type === 'dispose') {
        stopped = true;
        dispose();
        scope.close();
      } else throw new Error('unknown worker message');
    } catch (e) { stop(e); }
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  installWorker(globalThis, async options => {
    const { default: createRuntime } = await import('./dream-browser.mjs');
    return createRuntime(options);
  });
}
