// The examples in a real browser: headless Chromium through Playwright, each
// application served as the static site `mind build` makes, with its content
// security policy, and driven the way a person would.
//
//     node tests/browser.mjs APPS_DIR    (holding counter/, todo/, sketch/)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.DREAM_PLAYWRIGHT ? pathToFileURL(process.env.DREAM_PLAYWRIGHT) : 'playwright');

const apps = resolve(process.argv[2]);
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// One server per application, at its root, falling back to index.html for a
// path with no extension -- as a host serving a single-page application does.
async function serve(dir) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(dir, path);
    if (!extname(path) || !(await stat(file).catch(() => null))?.isFile()) file = join(dir, 'index.html');
    try {
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

const browser = await chromium.launch({ ...(process.env.DREAM_CHROME ? { executablePath: process.env.DREAM_CHROME } : {}), headless: true });
const servers = [];
async function open(name, path = '/index.html') {
  const site = await serve(join(apps, name, 'assets'));
  servers.push(site.server);
  const page = await browser.newPage();
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => logs.push(m.text()));
  await page.goto(site.url + path);
  page.problems = () => `\nErrors: ${errors}\nConsole: ${logs.join('\n')}\nPage: ${'' /* filled below */}`;
  page.errors = errors;
  page.logs = logs;
  page.site = site;
  return page;
}
/// `page.waitForFunction`, saying what the page showed when it gives up.
async function until(page, fn, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: 15000 }); }
  catch (error) {
    const seen = await page.evaluate(() => [document.activeElement?.outerHTML?.slice(0, 200), document.body.innerText]);
    throw new Error(`${error}${page.problems()}${seen.join('\n')}`);
  }
}
async function waitFor(page, locator) {
  try { await locator.waitFor({ timeout: 15000 }); }
  catch (error) { throw new Error(`${error}${page.problems()}${await page.locator('body').innerText()}`); }
}

try {
  // --- counter: typed messages, Dream CSS, a backend that is not there ------
  {
    const page = await open('counter');
    await waitFor(page, page.getByRole('heading', { name: 'Dream graphics' }));
    assert.equal(await page.locator('output').innerText(), '0');
    await page.getByRole('button', { name: 'Increase count' }).click();
    await until(page, () => document.querySelector('output')?.textContent === '1');
    await page.getByRole('button', { name: 'Decrease count' }).click();
    await until(page, () => document.querySelector('output')?.textContent === '0');
    assert.equal(await page.locator('output').evaluate(e => getComputedStyle(e).fontSize), '48px', 'the program stylesheet applies');
    await page.getByRole('button', { name: 'Call Dream backend' }).click();
    await waitFor(page, page.getByText('No backend: backend_unavailable'));
    assert.equal(await page.title(), 'Dream counter');
    assert.deepEqual(page.errors, []);
    console.log('Chromium: counter -- typed messages, a stylesheet in Dream, a missing backend answered as data');
  }

  // --- todo: forms, a keyed list, routes, storage, focus, JS and CSS of its own
  {
    const page = await open('todo');
    await waitFor(page, page.getByRole('heading', { name: 'Things to do' }));
    const box = page.getByRole('textbox', { name: 'New item' });
    await box.fill('Buy milk');
    await box.press('Enter');
    await waitFor(page, page.getByText('Buy milk'));
    await box.fill('Walk the dog');
    await page.getByRole('button', { name: 'Add' }).click();
    await waitFor(page, page.getByText('Walk the dog'));
    assert.equal(await box.inputValue(), '', 'the draft is cleared');
    await page.getByRole('checkbox', { name: 'Done: Buy milk' }).check();
    await until(page, () => document.querySelector('progress-ring')?.dataset.fraction === '0.50');
    assert.equal(await page.getByText('1 left').count(), 1);
    assert.equal(await page.locator('.remove').first().evaluate(e => getComputedStyle(e).borderStyle), 'none',
      'the hand-written stylesheet applies');

    // A link within the application is a route, not a page load.
    await page.getByRole('link', { name: 'Active' }).click();
    await page.waitForURL(/\/active$/);
    await until(page, () => !document.body.innerText.includes('Buy milk'));
    assert.equal(await page.getByRole('link', { name: 'Active' }).getAttribute('aria-current'), 'page');
    await page.getByRole('link', { name: 'All' }).click();
    await waitFor(page, page.getByText('Buy milk'));

    // A page-wide shortcut, which stays out of the way of typing.
    await page.locator('h1').click();
    await page.keyboard.press('/');
    await until(page, () => document.activeElement?.getAttribute('aria-label') === 'New item');
    await box.pressSequentially('a/b');
    assert.equal(await box.inputValue(), 'a/b');
    await box.fill('');

    // Double-click to rename: the update asks the page to focus the field.
    await page.getByText('Walk the dog').dblclick();
    const rename = page.getByRole('textbox', { name: 'Rename' });
    await until(page, () => document.activeElement?.getAttribute('aria-label') === 'Rename');
    await rename.fill('Walk the cat');
    await rename.press('Enter');
    await waitFor(page, page.getByText('Walk the cat'));

    // State outlives the page.
    await page.reload();
    await waitFor(page, page.getByText('Walk the cat'));
    assert.equal(await page.getByRole('checkbox', { name: 'Done: Buy milk' }).isChecked(), true);

    // A JavaScript function Dream calls: confirm, declined and then accepted.
    page.once('dialog', d => d.dismiss());
    await page.getByRole('button', { name: 'Clear finished' }).click();
    await page.waitForTimeout(200);
    assert.equal(await page.getByText('Buy milk').count(), 1, 'declined');
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Clear finished' }).click();
    await until(page, () => !document.body.innerText.includes('Buy milk'));

    // A deep route can be reloaded only by an application built with --base /;
    // this one is relative, so the route it is reloaded at is the root's.
    assert.deepEqual(page.errors, []);
    console.log('Chromium: todo -- forms, keyed list, routing, storage, focus, a custom element and a JS function');
  }

  // --- sketch: canvas, pointer, animation frames, keys -------------------------
  {
    const page = await open('sketch');
    await waitFor(page, page.getByRole('img', { name: 'Drawing area' }));
    const canvas = page.locator('canvas');
    const ratio = await page.evaluate(() => devicePixelRatio);
    assert.deepEqual(await canvas.evaluate(c => [c.width, c.height, c.style.width]), [640 * ratio, 400 * ratio, '640px']);
    const pixel = (x, y) => canvas.evaluate((c, [x, y]) => {
      const r = devicePixelRatio;
      return [...c.getContext('2d').getImageData(Math.round(x * r), Math.round(y * r), 1, 1).data];
    }, [x, y]);
    const frame = () => canvas.evaluate(c => c.toDataURL());
    const first = await frame();
    await page.waitForTimeout(300);
    assert.notEqual(await frame(), first, 'the animation moves');
    const at = await canvas.boundingBox();
    await page.mouse.move(at.x + 100, at.y + 50);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(at.x + 100 + i * 10, at.y + 50);
    await page.mouse.up();
    // The finished stroke is in the program's colour, #ff6b6b.
    await until(page, () => {
      const c = document.querySelector('canvas'), r = devicePixelRatio;
      const [red, green, blue] = c.getContext('2d').getImageData(Math.round(150 * r), Math.round(50 * r), 1, 1).data;
      return red > 200 && green < 140 && blue < 140;
    });
    await page.getByRole('button', { name: 'Colour #4d96ff' }).click();
    await until(page, () => {
      const c = document.querySelector('canvas'), r = devicePixelRatio;
      const [red, , blue] = c.getContext('2d').getImageData(Math.round(150 * r), Math.round(50 * r), 1, 1).data;
      return blue > 200 && red < 120;
    });
    await page.keyboard.press('z');
    await until(page, () => {
      const c = document.querySelector('canvas'), r = devicePixelRatio;
      const [red, , blue] = c.getContext('2d').getImageData(Math.round(150 * r), Math.round(50 * r), 1, 1).data;
      return blue < 120 && red < 120;
    });
    assert.ok((await pixel(5, 5))[2] < 60, 'the background is the drawing\'s clear colour');
    assert.deepEqual(page.errors, []);
    console.log('Chromium: sketch -- canvas at screen density, pointer strokes, animation frames, keys');
  }

  // --- budget: widgets alone -------------------------------------------------
  {
    const page = await open('budget');
    await waitFor(page, page.getByRole('heading', { name: 'Expenses' }));
    assert.equal(await page.getByText('$1,200.00').count(), 1, 'money is formatted');
    assert.equal(await page.getByRole('row').count(), 4, 'a header and three sample rows');

    // Search, down to nothing, and the empty state says so.
    const search = page.getByRole('searchbox', { name: 'Search expenses' });
    await search.fill('xyz');
    await waitFor(page, page.getByText('Nothing matches “xyz”.'));
    await search.fill('rent');
    await until(page, () => document.querySelectorAll('tbody tr').length === 1);
    await search.fill('');

    // A form that checks itself only once it has been tried.
    await page.getByRole('tab', { name: 'Add' }).click();
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Add expense' }).click();
    await waitFor(page, page.getByText('Say what it was for'));
    assert.equal(await page.getByRole('textbox', { name: 'What was it for?' }).getAttribute('aria-invalid'), 'true');
    await page.getByRole('textbox', { name: 'What was it for?' }).fill('Concert');
    await page.getByRole('spinbutton', { name: 'Amount, in dollars' }).fill('480');
    await page.getByRole('combobox', { name: 'Category' }).selectOption('Fun');
    await page.getByRole('checkbox', { name: 'This comes every month' }).check();
    await page.getByRole('spinbutton', { name: 'Amount, in dollars' }).press('Enter');
    await waitFor(page, page.getByText('Added Concert'));
    assert.equal(await page.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected'), 'true');
    await waitFor(page, page.getByText('You are $58.90 over budget.'));
    // The toast goes by itself.
    await until(page, () => !document.body.innerText.includes('Added Concert'));

    // A modal before anything is deleted: Escape keeps it, Remove removes it.
    await page.getByRole('button', { name: 'Remove Rent' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove this expense?' });
    await waitFor(page, dialog);
    await page.keyboard.press('Escape');
    await until(page, () => !document.querySelector('dialog'));
    assert.equal(await page.getByText('Rent', { exact: true }).count(), 1, 'kept');
    await page.getByRole('button', { name: 'Remove Rent' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await until(page, () => !document.body.innerText.includes('Rent\n'));
    assert.equal(await page.getByRole('row').count(), 4, 'a header and three rows: Concert in, Rent out');

    // Settings: the switch is a switch, dark mode is the page's, and it is kept.
    await page.getByRole('tab', { name: 'Settings' }).click();
    const dark = page.getByRole('switch', { name: 'Dark mode' });
    assert.equal(await dark.getAttribute('aria-checked'), 'false');
    await dark.click();
    await until(page, () => getComputedStyle(document.querySelector('.dw-page')).backgroundColor === 'rgb(17, 17, 22)');
    const slider = page.getByRole('slider', { name: 'Monthly budget, in dollars' });
    await slider.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await until(page, () => document.querySelector('.dw-value')?.textContent === '1400');
    assert.equal(await slider.inputValue(), '1400');
    await page.reload();
    await waitFor(page, page.getByRole('heading', { name: 'Expenses' }));
    await page.getByRole('tab', { name: 'Settings' }).click();
    await until(page, () => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true');
    await page.getByRole('tab', { name: 'Overview' }).click();
    await waitFor(page, page.getByText('$1,400.00'));   // the budget was kept
    await waitFor(page, page.getByText('Concert'));     // and the expense
    assert.deepEqual(page.errors, []);
    console.log('Chromium: budget -- widgets alone: tabs, search, a self-checking form, toasts, a modal, a switch, a slider, kept state');
  }
} finally {
  await browser.close();
  for (const s of servers) await new Promise(r => s.close(r));
}
