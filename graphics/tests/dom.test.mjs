import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { DomDriver, validateTree } from '../web/dom.mjs';
const { JSDOM } = await import(process.env.DREAM_JSDOM ? pathToFileURL(process.env.DREAM_JSDOM) : 'jsdom');
const node = (tag, key = '', extra = {}) => ({ tag, key, text: '', attrs: {}, events: {}, style: {}, children: [], ...extra });
function setup() {
  const dom = new JSDOM('<main></main>');
  const root = dom.window.document.querySelector('main');
  const events = [];
  return { dom, root, events, driver: new DomDriver(root, e => events.push(e)) };
}
test('keyed input retains identity, focus, and selection when siblings move', () => {
  const { root, driver, dom } = setup();
  const input = node('input', 'editor', { attrs: { value: 'hello' }, events: { input: 'edit' } });
  const label = node('label', 'label');
  driver.render(node('div', 'root', { children: [input, label] }));
  const element = root.querySelector('input');
  element.focus();
  element.setSelectionRange(2, 3);
  driver.render(node('div', 'root', { children: [label, input] }));
  assert.equal(root.querySelector('input'), element);
  assert.equal(dom.window.document.activeElement, element);
  assert.equal(element.selectionStart, 2);
  assert.equal(element.selectionEnd, 3);
});
test('event bindings update without duplicating listeners', () => {
  const { root, driver, events } = setup();
  driver.render(node('button', 'b', { events: { click: 'first' } }));
  driver.render(node('button', 'b', { events: { click: 'second' } }));
  root.querySelector('button').click();
  assert.deepEqual(events, [{ name: 'second', key: 'b', value: null }]);
  driver.render(node('button', 'b'));
  root.querySelector('button').click();
  assert.equal(events.length, 1);
});
test('composition is not overwritten by a concurrent render', () => {
  const { root, driver, dom, events } = setup();
  const view = value => node('input', 'editor', { attrs: { value }, events: { input: 'edit' } });
  driver.render(view(''));
  const input = root.firstChild;
  input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'に';
  driver.render(view('old backend value'));
  assert.equal(input.value, 'に');
  input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, isComposing: true }));
  assert.equal(events.length, 0);
  input.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
  input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  assert.equal(events[0].value, 'に');
});
test('invalid trees are rejected before existing DOM changes', () => {
  const { root, driver } = setup();
  driver.render(node('p', 'keep', { children: [node('#text', '', { text: 'safe' })] }));
  const element = root.firstChild;
  assert.throws(() => driver.render(node('div', 'bad', { children: [node('script')] })));
  assert.equal(root.firstChild, element);
  assert.equal(root.textContent, 'safe');
  assert.throws(() => validateTree(node('img', 'x', { attrs: { onerror: 'alert(1)' } })));
  assert.throws(() => validateTree(node('div', '', { style: { background: 'url(https://evil)' } })));
  assert.throws(() => validateTree(node('div', '', { children: [node('p', 'same'), node('p', 'same')] })));
});
test('text is literal and SVG uses its namespace', () => {
  const { root, driver } = setup();
  driver.render(node('div', '', { children: [node('#text', '', { text: '<img src=x onerror=alert(1)>' }),
    node('svg', 'shape', { children: [node('circle', 'circle', { attrs: { r: 5 } })] })] }));
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('circle').namespaceURI, 'http://www.w3.org/2000/svg');
});
test('dispose removes event listeners and owned DOM', () => {
  const { root, driver, events } = setup();
  driver.render(node('button', 'b', { events: { click: 'click' } }));
  const button = root.firstChild;
  driver.dispose();
  button.click();
  assert.equal(root.childNodes.length, 0);
  assert.equal(events.length, 0);
});
