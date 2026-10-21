import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.DREAM_PLAYWRIGHT ? pathToFileURL(process.env.DREAM_PLAYWRIGHT) : 'playwright');
const assets = resolve(process.argv[2]);
const allowed = new Set(['index.html', 'main.mjs', 'dom.mjs', 'worker.mjs', 'dream-browser.mjs', 'dream-browser.wasm', 'frontend.dream']);
const server = createServer(async (req, res) => {
  const name = req.url.slice(1);
  if (!allowed.has(name)) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(await readFile(resolve(assets, name)));
  } catch { res.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.DREAM_CHROME || '/etc/profiles/per-user/blake/bin/google-chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.getByRole('heading', { name: 'Dream graphics' }).waitFor();
  assert.equal(await page.locator('output').innerText(), '0');
  await page.getByRole('button', { name: 'Increase count' }).click();
  await page.waitForFunction(() => document.querySelector('output')?.textContent === '1');
  await page.getByRole('button', { name: 'Decrease count' }).click();
  await page.waitForFunction(() => document.querySelector('output')?.textContent === '0');
  await page.getByRole('button', { name: 'Call Dream backend' }).click();
  await page.getByText(/backend_unavailable/).waitFor();
  assert.deepEqual(errors, []);
  console.log('Chromium: Web Worker, Wasm, CSP, DOM events, rendering and missing-backend response passed');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
