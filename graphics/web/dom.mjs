// A data-only DOM driver. It never evaluates code or accepts HTML strings.
const tags = new Set(('div span main section article header footer nav aside h1 h2 h3 h4 p ' +
  'button input label textarea select option optgroup form fieldset legend output progress meter ' +
  'ul ol li table thead tbody tfoot tr th td caption details summary dialog pre code strong em small ' +
  'br hr img svg g path rect circle ellipse line polyline polygon text title desc').split(' '));
const svgTags = new Set('svg g path rect circle ellipse line polyline polygon text title desc'.split(' '));
const attributes = new Set(('id title role tabindex type value checked disabled readonly required placeholder ' +
  'name for min max step multiple selected rows cols maxlength minlength autocomplete ' +
  'alt width height colspan rowspan scope open hidden dir lang class ' +
  'viewBox d x y x1 x2 y1 y2 cx cy r rx ry points fill stroke stroke-width transform').split(' '));
const events = new Set('click input change submit keydown keyup focus blur pointerdown pointerup'.split(' '));
const booleans = new Set('checked disabled readonly required multiple selected open hidden'.split(' '));
const MAX_NODES = 10000, MAX_DEPTH = 128;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (x, key) => Object.hasOwn(x, key);
const string = x => typeof x === 'string';
function fail(message) { throw new TypeError(`Dream graphics: ${message}`); }

export function validateTree(tree) {
  let count = 0;
  const keys = new Set();
  function walk(node, depth, svg = false) {
    if (++count > MAX_NODES || depth > MAX_DEPTH) fail('tree limit exceeded');
    if (!object(node) || !string(node.tag) || !string(node.key) || !string(node.text) ||
        !object(node.attrs) || !object(node.style) || !object(node.events) || !Array.isArray(node.children))
      fail('invalid node');
    if (node.key) {
      if (keys.has(node.key)) fail('duplicate key');
      keys.add(node.key);
    }
    if (node.tag === '#text') {
      if (node.children.length || Object.keys(node.attrs).length || Object.keys(node.events).length ||
          Object.keys(node.style).length) fail('text nodes cannot have attributes or children');
      return;
    }
    if (!tags.has(node.tag)) fail(`unsupported element ${node.tag}`);
    svg = svg || node.tag === 'svg';
    if (svg && !svgTags.has(node.tag)) fail('invalid SVG child');
    if (!node.key && (Object.keys(node.events).length || ['input', 'textarea', 'select'].includes(node.tag)))
      fail('interactive controls need stable keys');
    if (['input', 'br', 'hr', 'img'].includes(node.tag) && node.children.length) fail('void element has children');
    for (const [name, value] of Object.entries(node.attrs)) {
      if (!(attributes.has(name) || /^aria-[a-z-]+$/.test(name)) ||
          !(string(value) || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))))
        fail(`invalid attribute ${name}`);
      if (booleans.has(name) && typeof value !== 'boolean') fail(`boolean required for ${name}`);
    }
    for (const [name, value] of Object.entries(node.style)) {
      if (!/^(-?[a-z]+)(-[a-z]+)*$/.test(name) || !string(value) ||
          /url\s*\(|@import|expression\s*\(|[\\\u0000-\u001f]/i.test(value)) fail('invalid style');
    }
    for (const [name, message] of Object.entries(node.events)) {
      if (!events.has(name) || !string(message) || !message || message.length > 256) fail('invalid event binding');
    }
    for (const child of node.children) walk(child, depth + 1, svg);
  }
  walk(tree, 0);
  return tree;
}

export class DomDriver {
  constructor(root, send) {
    this.root = root;
    this.send = send;
    this.records = new Map();
    this.composing = new WeakSet();
    this.listeners = [];
    this.onCompositionStart = e => this.composing.add(e.target);
    this.onCompositionEnd = e => { this.composing.delete(e.target); };
    root.addEventListener('compositionstart', this.onCompositionStart);
    root.addEventListener('compositionend', this.onCompositionEnd);
  }
  render(tree) {
    validateTree(tree); // Validate the whole transaction before touching DOM.
    const next = new Map();
    const doc = this.root.ownerDocument;
    const patch = (node, position, svg = false) => {
      const id = node.key ? `key:${node.key}` : `pos:${position}`;
      svg = svg || node.tag === 'svg';
      let record = this.records.get(id);
      if (!record || record.node.tag !== node.tag || record.svg !== svg) {
        const el = node.tag === '#text' ? doc.createTextNode('') : svg
          ? doc.createElementNS('http://www.w3.org/2000/svg', node.tag) : doc.createElement(node.tag);
        record = { el, node: { attrs: {}, style: {}, events: {} }, svg, handlers: new Map() };
      }
      const { el, node: old } = record;
      next.set(id, record);
      if (node.tag === '#text') {
        if (el.data !== node.text) el.data = node.text;
      } else {
        for (const name of Object.keys(old.attrs)) if (!own(node.attrs, name)) {
          el.removeAttribute(name);
          if (name === 'value') el.value = '';
          if (name === 'checked' || name === 'selected') el[name] = false;
        }
        for (const [name, value] of Object.entries(node.attrs)) {
          if (name === 'value' && 'value' in el) {
            // Do not disrupt IME or reset the caret when the value is unchanged.
            if (!this.composing.has(el) && el.value !== String(value)) el.value = String(value);
          } else if (name === 'checked' || name === 'selected') {
            el[name] = value;
          } else if (booleans.has(name)) {
            el.toggleAttribute(name, value);
          } else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value));
        }
        for (const name of Object.keys(old.style)) if (!own(node.style, name)) el.style.removeProperty(name);
        for (const [name, value] of Object.entries(node.style)) if (old.style[name] !== value)
          el.style.setProperty(name, value);
        for (const [name, handler] of record.handlers) if (!own(node.events, name)) {
          el.removeEventListener(name, handler);
          record.handlers.delete(name);
        }
        for (const name of Object.keys(node.events)) if (!record.handlers.has(name)) {
          const handler = event => {
            if (name === 'submit') event.preventDefault();
            if (name === 'input' && (event.isComposing || this.composing.has(el))) return;
            let value = null;
            if (name === 'input' || name === 'change') value = el.type === 'checkbox' ? el.checked : el.value;
            if (name === 'keydown' || name === 'keyup') value = {
              key: event.key, code: event.code, alt: event.altKey, ctrl: event.ctrlKey,
              shift: event.shiftKey, meta: event.metaKey, repeat: event.repeat
            };
            this.send({ name: record.node.events[name], key: record.node.key, value });
          };
          el.addEventListener(name, handler);
          record.handlers.set(name, handler);
        }
        node.children.forEach((child, i) => {
          const childEl = patch(child, `${position}/${i}`, svg);
          if (el.childNodes[i] !== childEl) el.insertBefore(childEl, el.childNodes[i] ?? null);
        });
        while (el.childNodes.length > node.children.length) el.lastChild.remove();
      }
      record.node = node;
      return el;
    };
    const el = patch(tree, '0');
    if (this.root.firstChild !== el) this.root.replaceChildren(el);
    this.records = next;
  }
  dispose() {
    this.root.removeEventListener('compositionstart', this.onCompositionStart);
    this.root.removeEventListener('compositionend', this.onCompositionEnd);
    for (const { el, handlers } of this.records.values())
      for (const [name, handler] of handlers) el.removeEventListener(name, handler);
    this.records.clear();
    this.root.replaceChildren();
  }
}
