/**
 * Lane-configuration UI, injected into the game's settings sidebar as a
 * collapsible "road lanes" section (placed below the driving-metrics section).
 *
 * Mirrors MetricsPanel: the React-rendered settings list mounts/unmounts as the
 * user opens/closes it, so the section is (re)injected via a MutationObserver
 * and matches the native collapsible markup so it looks built-in.
 *
 * `store` is the LaneStore this UI reads from and writes to.
 */

const LP_STYLE_ID = 'pd-lanes-style';
const LP_SECTION_ID = 'pd-lanes-section';
const LP_CONTENT_ID = 'pd-lanes-content';

const LP_CSS = `
#${LP_SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${LP_SECTION_ID} .collapsible-cross{float:right}
#${LP_CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${LP_CONTENT_ID}.open{display:block}
#${LP_CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${LP_CONTENT_ID} .pd-lrow{display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:4px 0;font-size:13px}
#${LP_CONTENT_ID} .pd-step{display:flex;align-items:center;gap:6px}
#${LP_CONTENT_ID} .pd-step button{width:24px;height:24px;font:600 14px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${LP_CONTENT_ID} .pd-step button:hover{border-color:#3ec6b5}
#${LP_CONTENT_ID} .pd-step .val{min-width:42px;text-align:center;color:#eafffb;font-weight:600}
#${LP_CONTENT_ID} .pd-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;
  border-top:1px solid #333;padding-top:10px}
#${LP_CONTENT_ID} .pd-presets button{flex:1 1 auto;font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:7px 8px;cursor:pointer;letter-spacing:1px}
#${LP_CONTENT_ID} .pd-presets button:hover{border-color:#3ec6b5}
#${LP_CONTENT_ID} .pd-note{font-size:11px;color:#8aa0a0;margin-top:10px;line-height:1.4}
#${LP_CONTENT_ID} .pd-note b{color:#cfe9e6}
`;

class LanePanel {
  constructor(store) {
    this.store = store;
    this.expanded = false;
    this._injectStyle();
    this._buildSection();
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._schedule());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInject();
    this._unsub = store.subscribe(() => this._render());
  }

  _injectStyle() {
    if (document.getElementById(LP_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = LP_STYLE_ID;
    s.textContent = LP_CSS;
    document.head.appendChild(s);
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => {
      this._scheduled = false;
      this._tryInject();
    });
  }

  _tryInject() {
    const list = document.querySelector('.settings-input-list');
    if (!list) return;
    if (list.contains(this.header) && list.contains(this.content)) return;
    list.appendChild(this.header);
    list.appendChild(this.content);
    this._render();
  }

  _buildSection() {
    this.header = el('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = LP_SECTION_ID;
    this.title = el('div', 'collapsible-title', 'road lanes');
    this.cross = el('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    this.content = el('div');
    this.content.id = LP_CONTENT_ID;

    this.content.appendChild(el('div', 'pd-fam', 'lanes'));
    this.fwdRow = this._stepperRow('Forward (your way)', () => this._adjust('forward', -1), () => this._adjust('forward', 1));
    this.bwdRow = this._stepperRow('Oncoming', () => this._adjust('backward', -1), () => this._adjust('backward', 1));
    this.widthRow = this._stepperRow('Lane width', () => this._adjustWidth(-0.1), () => this._adjustWidth(0.1));
    this.content.append(this.fwdRow.row, this.bwdRow.row, this.widthRow.row);

    const presets = el('div', 'pd-presets');
    for (const p of LANE_PRESETS) {
      const b = el('button', null, p.label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.store.set(p.cfg);
      });
      presets.appendChild(b);
    }
    this.content.appendChild(presets);

    this.note = el('div', 'pd-note');
    this.content.appendChild(this.note);

    this._applyExpanded();
  }

  _stepperRow(label, onMinus, onPlus) {
    const row = el('div', 'pd-lrow');
    row.appendChild(el('span', null, label));
    const step = el('div', 'pd-step');
    const minus = el('button', null, '−');
    const val = el('span', 'val', '');
    const plus = el('button', null, '+');
    const stop = (fn) => (e) => {
      e.stopPropagation();
      fn();
    };
    minus.addEventListener('click', stop(onMinus));
    plus.addEventListener('click', stop(onPlus));
    step.append(minus, val, plus);
    row.appendChild(step);
    return { row, val };
  }

  _adjust(key, delta) {
    const cfg = this.store.get();
    this.store.set({ [key]: cfg[key] + delta });
  }

  _adjustWidth(delta) {
    const cfg = this.store.get();
    // First press out of "auto" snaps to 3.2, then steps.
    const base = cfg.width == null ? 3.2 : cfg.width;
    const next = Math.round((base + delta) * 10) / 10;
    this.store.set({ width: next });
  }

  _toggle() {
    this.expanded = !this.expanded;
    this._applyExpanded();
  }

  _applyExpanded() {
    this.cross.textContent = this.expanded ? '−' : '+';
    this.content.classList.toggle('open', this.expanded);
  }

  _render() {
    if (!this.fwdRow) return;
    const cfg = this.store.get();
    this.fwdRow.val.textContent = String(cfg.forward);
    this.bwdRow.val.textContent = String(cfg.backward);
    this.widthRow.val.textContent = cfg.width == null ? 'auto' : cfg.width.toFixed(1) + 'm';
    const total = cfg.forward + cfg.backward;
    this.note.innerHTML =
      `<b>${total}</b> lane${total === 1 ? '' : 's'} total. Changes apply to road generated ` +
      `<b>ahead</b> of you, tapering in over a short distance — keep driving to reach them.`;
  }

  dispose() {
    if (this._observer) this._observer.disconnect();
    if (this._unsub) this._unsub();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
