// The application's own JavaScript, for what the page has and Dream does not.
// `setup` is given `dream` (web/main.mjs says what it holds); a custom element
// is rendered from Dream by name, and fed through properties.
class ProgressRing extends HTMLElement {
  #fraction = 0;
  set fraction(value) { this.#fraction = Math.max(0, Math.min(1, Number(value) || 0)); this.draw(); }
  get fraction() { return this.#fraction; }
  connectedCallback() { this.draw(); }
  draw() {
    const r = 16, c = 2 * Math.PI * r;
    this.innerHTML = `<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".15" stroke-width="4"/>
      <circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"
        stroke-dasharray="${c * this.#fraction} ${c}" transform="rotate(-90 20 20)"/></svg>`;
    this.dataset.fraction = this.#fraction.toFixed(2);
  }
}

export function setup(dream) {
  customElements.define('progress-ring', ProgressRing);
  // `confirm` blocks, and only the page's main thread has it.
  dream.handle('confirm', ({ text }) => window.confirm(text));
}
