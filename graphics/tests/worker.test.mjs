import test from 'node:test';
import assert from 'node:assert/strict';
import { installWorker } from '../web/worker.mjs';

function setup(tick = () => 2, create) {
  const messages = [], timers = new Map(), received = [];
  let options, disposed = 0, nextTimer = 0;
  const runtime = {
    HEAPU8: new Uint8Array(2 * 1024 * 1024),
    _malloc: () => 1, _free() {}, _dream_browser_load: () => 1,
    _dream_browser_event: (ptr, len) => { received.push(JSON.parse(new TextDecoder().decode(runtime.HEAPU8.subarray(ptr, ptr + len)))); return 1; },
    _dream_browser_tick: () => tick(options), _dream_browser_delay: () => -1,
    _dream_browser_dispose: () => disposed++
  };
  const scope = {
    postMessage: m => messages.push(m), performance: { now: () => 0 },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: id => timers.delete(id), close() {},
    fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer })
  };
  installWorker(scope, async opts => { options = opts; return create ? create(runtime) : runtime; });
  return { scope, runtime, messages, timers, received, disposed: () => disposed,
    send: data => scope.onmessage({ data }) };
}
test('a render in the final slice is delivered before completion and disposal', async () => {
  const worker = setup(options => { options.onMessage(JSON.stringify({ type: 'render', patch: 'final' })); return 0; });
  await worker.send({ type: 'start' });
  assert.deepEqual(worker.messages, [{ type: 'render', patches: ['final'] }, { type: 'finished', code: 0 }]);
  assert.equal(worker.disposed(), 1);
  await worker.send({ type: 'event', event: { name: 'ignored' } });
  assert.equal(worker.received.length, 0);
});
test('startup events reach the runtime in order', async () => {
  const worker = setup();
  await worker.send({ type: 'event', event: { name: 'first' } });
  await worker.send({ type: 'event', event: { name: 'second' } });
  await worker.send({ type: 'start' });
  assert.deepEqual(worker.received, [{ name: 'first' }, { name: 'second' }]);
});
test('runtime failure is reported once, after the Wasm call returns', async () => {
  const worker = setup(options => {
    options.onError('broken frontend');
    assert.equal(worker.disposed(), 0);
    return -1;
  });
  await worker.send({ type: 'start' });
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].type, 'failure');
  assert.match(worker.messages[0].message, /broken frontend/);
  assert.equal(worker.disposed(), 1);
});
test('dispose while loading prevents a late runtime from starting', async () => {
  let resolve;
  const worker = setup(() => assert.fail('must not tick'), runtime => new Promise(r => { resolve = () => r(runtime); }));
  const starting = worker.send({ type: 'start' });
  await worker.send({ type: 'dispose' });
  resolve();
  await starting;
  assert.equal(worker.disposed(), 1);
  assert.deepEqual(worker.messages, []);
});
test('startup queues reject oversized events and too many events', async () => {
  const large = setup();
  await large.send({ type: 'event', event: { value: 'x'.repeat(1024 * 1024) } });
  assert.match(large.messages[0].message, /event too large/);
  const full = setup();
  for (let i = 0; i < 257; i++) await full.send({ type: 'event', event: { name: 'queued' } });
  assert.match(full.messages[0].message, /startup queue is full/);
});
test('nothing overtakes a render; the patches of a slice go together, in order', async () => {
  const worker = setup(options => {
    options.onMessage(JSON.stringify({ type: 'render', patch: 'a' }));
    options.onMessage(JSON.stringify({ type: 'render', patch: 'b' }));
    options.onMessage(JSON.stringify({ type: 'request', id: 0, service: 'focus' }));
    options.onMessage(JSON.stringify({ type: 'render', patch: 'c' }));
    return 0;
  });
  await worker.send({ type: 'start' });
  assert.deepEqual(worker.messages.map(m => m.patches ?? m.type), [['a', 'b'], 'request', ['c'], 'finished']);
});
