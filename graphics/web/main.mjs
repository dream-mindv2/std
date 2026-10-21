import { DomDriver } from './dom.mjs';
const root = document.getElementById('dream-root');
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
const send = event => worker.postMessage({ type: 'event', event });
const driver = new DomDriver(root, send);
let pending, frame, failed = false;
function failure(message) {
  if (failed) return;
  failed = true;
  cancelAnimationFrame(frame);
  worker.terminate();
  driver.dispose();
  const text = document.createElement('p');
  text.setAttribute('role', 'alert');
  text.textContent = `The application stopped: ${message}`;
  root.append(text);
}
worker.onerror = event => { event.preventDefault(); failure(event.message); };
worker.onmessage = ({ data }) => {
  if (failed) return;
  try {
    switch (data.type) {
      case 'render':
        pending = data.node;
        if (!frame) frame = requestAnimationFrame(() => {
          frame = null;
          try { driver.render(pending); } catch (e) { failure(e.message); }
        });
        break;
      case 'open': document.title = String(data.options.title); break;
      case 'invoke':
        if (globalThis.ipc?.postMessage) globalThis.ipc.postMessage(JSON.stringify(data));
        else send({ name: data.reply, key: '', value: { ok: false, error: 'backend_unavailable' } });
        break;
      case 'close':
        if (globalThis.ipc?.postMessage) globalThis.ipc.postMessage('{"type":"close"}');
        break;
      case 'failure': failure(data.message); break;
      case 'log': console.info(data.message); break;
      case 'finished': break;
      default: throw new Error('unknown graphics message');
    }
  } catch (e) { failure(e.message); }
};
// Host messages are data. The host embeds JSON as a JS string literal and
// calls this one receiver; application-provided text is never evaluated.
Object.defineProperty(globalThis, '__dreamReceive', { value: send, writable: false });
addEventListener('pagehide', () => { worker.terminate(); driver.dispose(); });
worker.postMessage({ type: 'start' });
