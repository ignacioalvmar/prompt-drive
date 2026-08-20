/**
 * Map-generation UI, injected into the game's settings sidebar as a
 * collapsible "map generation" section (below the road-lanes section).
 *
 * Mirrors LanePanel: the React-rendered settings list mounts/unmounts as the
 * user opens/closes it, so the section is (re)injected via a MutationObserver
 * and matches the native collapsible markup so it looks built-in.
 *
 * `store` is the MapGenStore this UI reads/writes; `facade` is the MapGen
 * object (selection + preset/schema lookups).
 */

const MGP_STYLE_ID = 'pd-mapgen-style';
const MGP_SECTION_ID = 'pd-mapgen-section';
const MGP_CONTENT_ID = 'pd-mapgen-content';

const MGP_CSS = `
#${MGP_SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${MGP_SECTION_ID} .collapsible-cross{float:right}
#${MGP_CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${MGP_CONTENT_ID}.open{display:block}
#${MGP_CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${MGP_CONTENT_ID} .pd-mrow{display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:4px 0;font-size:13px}
#${MGP_CONTENT_ID} .pd-step{display:flex;align-items:center;gap:6px}
#${MGP_CONTENT_ID} .pd-step button{width:24px;height:24px;font:600 14px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${MGP_CONTENT_ID} .pd-step button:hover{border-color:#3ec6b5}
#${MGP_CONTENT_ID} .pd-step .val{min-width:58px;text-align:center;color:#eafffb;font-weight:600}
#${MGP_CONTENT_ID} .pd-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#${MGP_CONTENT_ID} .pd-presets button{flex:1 1 30%;font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:7px 8px;cursor:pointer;letter-spacing:1px}
#${MGP_CONTENT_ID} .pd-presets button:hover{border-color:#3ec6b5}
#${MGP_CONTENT_ID} .pd-presets button.sel{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${MGP_CONTENT_ID} .pd-presets button.apply{background:#1d3a36;border-color:#3ec6b5;color:#eafffb;flex:1 1 auto}
#${MGP_CONTENT_ID} .pd-seedrow{display:flex;gap:6px;margin-top:8px}
#${MGP_CONTENT_ID} .pd-seedrow input{flex:1;background:#151515;color:#eafffb;
  border:1px solid #3a3a3a;border-radius:5px;padding:6px 8px;font:600 12px Jura,system-ui}
#${MGP_CONTENT_ID} .pd-seedrow button{font:600 12px Jura,system-ui;background:#2a2a2a;
  color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;padding:6px 10px;cursor:pointer}
#${MGP_CONTENT_ID} .pd-seedrow button:hover{border-color:#3ec6b5}
#${MGP_CONTENT_ID} .pd-note{font-size:11px;color:#8aa0a0;margin-top:10px;line-height:1.4}
#${MGP_CONTENT_ID} .pd-note b{color:#cfe9e6}
`;

// Ladder used by the "detail layers" stepper to grow/shrink the Hills
// resolutions array (matches the progression of the engine's own presets).
const MGP_RES_LADDER = [3, 12, 24, 36, 48];

// Panel rows per scene: a curated, readable subset of PARAM_SCHEMA (the full
// schema stays reachable through MapGen.set / the API).
const MGP_ROWS = {
  Hills: [
    { key: 'heightScale', label: 'Terrain height' },
    { key: 'heightOffset', label: 'Base elevation' },
    { key: 'resolutions', label: 'Detail layers', ladder: true },
    { key: 'depthHeightFactor', label: 'Roughness' },
    { key: 'roadWidth', label: 'Road width' },
    { key: 'smoothWindow', label: 'Road smoothing' },
  ],
  Planet: [
    { key: 'heightScale', label: 'Terrain height' },
    { key: 'craterLayers', label: 'Crater layers' },
    { key: 'craterDepth', label: 'Crater depth' },
    { key: 'depth', label: 'Detail layers' },
    { key: 'roadWidth', label: 'Road width' },
    { key: 'smoothWindow', label: 'Road smoothing' },
  ],
};

class MapGenPanel {
  constructor(store, facade) {
    this.store = store;
    this.facade = facade;
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
    if (document.getElementById(MGP_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = MGP_STYLE_ID;
    s.textContent = MGP_CSS;
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
    this.header = mgEl('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = MGP_SECTION_ID;
    this.title = mgEl('div', 'collapsible-title', 'map generation');
    this.cross = mgEl('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    this.content = mgEl('div');
    this.content.id = MGP_CONTENT_ID;

    this.content.appendChild(mgEl('div', 'pd-fam', 'topography'));
    this.presetGrid = mgEl('div', 'pd-presets');
    this.content.appendChild(this.presetGrid);

    this.content.appendChild(mgEl('div', 'pd-fam', 'custom terrain'));
    this.paramBox = mgEl('div');
    this.content.appendChild(this.paramBox);

    this.content.appendChild(mgEl('div', 'pd-fam', 'world'));
    const seedRow = mgEl('div', 'pd-seedrow');
    this.seedInput = document.createElement('input');
    this.seedInput.placeholder = 'seed';
    this.seedInput.maxLength = 32;
    this.seedInput.addEventListener('click', (e) => e.stopPropagation());
    this.seedInput.addEventListener('change', () => this._setSeed(this.seedInput.value));
    const dice = mgEl('button', null, '🎲');
    dice.title = 'Random seed';
    dice.addEventListener('click', (e) => {
      e.stopPropagation();
      this._setSeed(Math.random().toString(36).slice(2, 10));
    });
    seedRow.append(this.seedInput, dice);
    this.content.appendChild(seedRow);

    const applyRow = mgEl('div', 'pd-presets');
    this.applyBtn = mgEl('button', 'apply', 'Rebuild world');
    this.applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        this.applyBtn.textContent = 'Rebuilding…';
        this.applyBtn.disabled = true;
      } catch (_e) {}
      this.facade.apply();
    });
    applyRow.appendChild(this.applyBtn);
    this.content.appendChild(applyRow);

    this.note = mgEl('div', 'pd-note');
    this.content.appendChild(this.note);

    this._applyExpanded();
  }

  _setSeed(value) {
    value = String(value || '').trim();
    if (!value) return;
    try {
      localStorage.setItem('seed', value);
    } catch (_e) {}
    this._render();
  }

  _scene() {
    return this.facade.currentScene();
  }

  _params() {
    const scene = this._scene();
    return this.store.get().custom[scene];
  }

  _setParam(key, value) {
    const scene = this._scene();
    this.facade.set({ custom: { [scene]: { [key]: value } } });
  }

  _stepParam(row, dir) {
    const scene = this._scene();
    const spec = PARAM_SCHEMA[scene][row.key];
    const params = this._params() || mgDefaultParams(scene);
    if (row.ladder) {
      const len = Math.max(1, Math.min(MGP_RES_LADDER.length, (params[row.key] || []).length + dir));
      this._setParam(row.key, MGP_RES_LADDER.slice(0, len));
    } else if (spec.type === 'boolean') {
      this._setParam(row.key, !params[row.key]);
    } else {
      this._setParam(row.key, (params[row.key] != null ? params[row.key] : spec.def) + dir * (spec.step || 1));
    }
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
    if (!this.presetGrid) return;
    const scene = this._scene();
    const selected = this.facade.selected();
    const params = this._params();

    // Topography preset grid (engine + expanded + custom when defined).
    this.presetGrid.textContent = '';
    for (const p of this.facade.presets(scene)) {
      const b = mgEl('button', p.id === selected ? 'sel' : null, p.label);
      if (p.desc) b.title = p.desc;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.facade.select(p.id);
        this._render();
      });
      this.presetGrid.appendChild(b);
    }

    // Custom-terrain parameter rows (or an enable button).
    this.paramBox.textContent = '';
    if (!params) {
      const row = mgEl('div', 'pd-presets');
      const enable = mgEl('button', null, 'Enable custom terrain');
      enable.addEventListener('click', (e) => {
        e.stopPropagation();
        this.facade.set({ custom: { [scene]: mgDefaultParams(scene) } });
      });
      row.appendChild(enable);
      this.paramBox.appendChild(row);
    } else {
      for (const row of MGP_ROWS[scene]) {
        const spec = PARAM_SCHEMA[scene][row.key];
        const line = mgEl('div', 'pd-mrow');
        const label = mgEl('span', null, row.label);
        if (spec.desc) label.title = spec.desc;
        line.appendChild(label);
        const step = mgEl('div', 'pd-step');
        const minus = mgEl('button', null, '−');
        const plus = mgEl('button', null, '+');
        minus.addEventListener('click', (e) => {
          e.stopPropagation();
          this._stepParam(row, -1);
        });
        plus.addEventListener('click', (e) => {
          e.stopPropagation();
          this._stepParam(row, 1);
        });
        const v = params[row.key];
        const text = Array.isArray(v)
          ? v.length + ' (' + v.join(',') + ')'
          : typeof v === 'boolean'
            ? v ? 'on' : 'off'
            : String(Math.round(v * 100) / 100);
        step.append(minus, mgEl('span', 'val', text), plus);
        line.appendChild(step);
        this.paramBox.appendChild(line);
      }
      const row = mgEl('div', 'pd-presets');
      const disable = mgEl('button', null, 'Disable custom');
      disable.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.facade.selected() === 'custom') this.facade.select('normal');
        this.facade.set({ custom: { [scene]: null } });
      });
      row.appendChild(disable);
      this.paramBox.appendChild(row);
    }

    try {
      this.seedInput.value = localStorage.getItem('seed') || '';
    } catch (_e) {}

    this.note.innerHTML =
      `Scene: <b>${scene}</b>, topography: <b>${selected}</b>. ` +
      `Selecting a topography regenerates the world in place; custom terrain ` +
      `parameters and a new seed bake in on <b>Rebuild world</b>.`;
  }

  dispose() {
    if (this._observer) this._observer.disconnect();
    if (this._unsub) this._unsub();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function mgEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
