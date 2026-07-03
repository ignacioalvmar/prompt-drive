/**
 * Steering-wheel configuration UI, injected into the game's settings panel as
 * a collapsible "steering wheel" section (below the traffic section, which is
 * appended before this bundle loads).
 *
 * Mirrors TrafficPanel: the React-rendered settings list mounts/unmounts as
 * the user opens/closes it, so the section is (re)injected via a
 * MutationObserver and matches the native collapsible markup.
 *
 * All controls are live (dynamic class): enable, device, steering range,
 * per-axis calibration with live bars, and the button→action binding editor.
 */

const WP_STYLE_ID = 'pd-wheel-style';
const WP_SECTION_ID = 'pd-wheel-section';
const WP_CONTENT_ID = 'pd-wheel-content';

const WP_CSS = `
#${WP_SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${WP_SECTION_ID} .collapsible-cross{float:right}
#${WP_CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${WP_CONTENT_ID}.open{display:block}
#${WP_CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${WP_CONTENT_ID} .pd-wrow{display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:4px 0;font-size:13px}
#${WP_CONTENT_ID} .pd-step{display:flex;align-items:center;gap:6px}
#${WP_CONTENT_ID} .pd-step button{width:24px;height:24px;font:600 14px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${WP_CONTENT_ID} .pd-step button:hover{border-color:#3ec6b5}
#${WP_CONTENT_ID} .pd-step .val{min-width:52px;text-align:center;color:#eafffb;font-weight:600}
#${WP_CONTENT_ID} .pd-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#${WP_CONTENT_ID} .pd-actions button,#${WP_CONTENT_ID} .pd-cal{font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:6px 8px;cursor:pointer;letter-spacing:1px}
#${WP_CONTENT_ID} .pd-actions button{flex:1 1 auto}
#${WP_CONTENT_ID} .pd-actions button:hover,#${WP_CONTENT_ID} .pd-cal:hover{border-color:#3ec6b5}
#${WP_CONTENT_ID} .pd-actions button.on{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${WP_CONTENT_ID} .pd-cal{flex:0 0 auto;padding:3px 8px}
#${WP_CONTENT_ID} .pd-cal.capturing{background:#4a3413;border-color:#ffcf5c;color:#ffe9b0}
#${WP_CONTENT_ID} .pd-bar{position:relative;flex:1;height:10px;background:#111;
  border:1px solid #333;border-radius:5px;overflow:hidden;min-width:60px}
#${WP_CONTENT_ID} .pd-bar>i{position:absolute;top:0;bottom:0;background:#3ec6b5;border-radius:4px}
#${WP_CONTENT_ID} .pd-dev{font-size:11px;color:#8aa0a0;word-break:break-all}
#${WP_CONTENT_ID} .pd-dev b{color:#cfe9e6}
#${WP_CONTENT_ID} .pd-bind{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px}
#${WP_CONTENT_ID} .pd-bind .btn-id{flex:0 0 52px;color:#eafffb;font-weight:600}
#${WP_CONTENT_ID} .pd-bind select{flex:1;background:#111;color:#cfe9e6;border:1px solid #333;
  border-radius:5px;padding:3px;font:12px Jura,system-ui}
#${WP_CONTENT_ID} .pd-bind .rm{flex:0 0 auto;width:22px;height:22px;background:#2a2a2a;
  color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${WP_CONTENT_ID} .pd-bind .rm:hover{border-color:#c65a3e;color:#ffb8a6}
#${WP_CONTENT_ID} .pd-note{font-size:11px;color:#8aa0a0;margin-top:10px;line-height:1.4}
#${WP_CONTENT_ID} .pd-note b{color:#cfe9e6}
`;

class WheelPanel {
  constructor(store, getFacade) {
    this.store = store;
    this.getFacade = getFacade;
    this.expanded = false;
    this._raf = null;
    this._injectStyle();
    this._buildSection();
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._schedule());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInject();
    this._unsub = store.subscribe(() => this._render());
  }

  _injectStyle() {
    if (document.getElementById(WP_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = WP_STYLE_ID;
    s.textContent = WP_CSS;
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
    this.header = wpEl('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = WP_SECTION_ID;
    this.title = wpEl('div', 'collapsible-title', 'steering wheel');
    this.cross = wpEl('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    this.content = wpEl('div');
    this.content.id = WP_CONTENT_ID;

    // --- enable + device ---
    this.content.appendChild(wpEl('div', 'pd-fam', 'wheel & pedals'));
    const toggles = wpEl('div', 'pd-actions');
    this.enabledBtn = wpEl('button', null, 'Wheel off');
    this.enabledBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.getFacade().setEnabled(!this.store.get().enabled);
    });
    toggles.append(this.enabledBtn);
    this.content.appendChild(toggles);
    this.deviceRow = wpEl('div', 'pd-dev', 'no device detected');
    this.content.appendChild(this.deviceRow);

    // --- steering ---
    this.content.appendChild(wpEl('div', 'pd-fam', 'steering'));
    this.steerBarRow = this._barRow('Steer', 'steer', true);
    this.content.appendChild(this.steerBarRow.row);
    this.rangeRow = this._stepperRow('Rotation for full lock', () => this._adjustRange(-90), () => this._adjustRange(90));
    this.content.appendChild(this.rangeRow.row);

    // --- pedals ---
    this.content.appendChild(wpEl('div', 'pd-fam', 'pedals'));
    this.throttleRow = this._barRow('Throttle', 'throttle');
    this.brakeRow = this._barRow('Brake', 'brake');
    this.clutchRow = this._barRow('Clutch', 'clutch');
    this.content.append(this.throttleRow.row, this.brakeRow.row, this.clutchRow.row);

    // --- bindings ---
    this.content.appendChild(wpEl('div', 'pd-fam', 'button bindings'));
    this.bindList = wpEl('div');
    this.content.appendChild(this.bindList);
    const addRow = wpEl('div', 'pd-actions');
    this.addBindBtn = wpEl('button', null, 'Add binding — press a button…');
    this.addSelect = document.createElement('select');
    this.addSelect.style.cssText = 'flex:1;background:#111;color:#cfe9e6;border:1px solid #333;border-radius:5px;padding:5px;font:12px Jura,system-ui';
    for (const a of WHEEL_ACTIONS) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.label;
      this.addSelect.appendChild(o);
    }
    this.addSelect.addEventListener('click', (e) => e.stopPropagation());
    this.addBindBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._captureButton(this.addSelect.value);
    });
    addRow.append(this.addSelect, this.addBindBtn);
    this.content.appendChild(addRow);

    this.note = wpEl('div', 'pd-note');
    this.content.appendChild(this.note);

    this._applyExpanded();
  }

  _barRow(label, role, symmetric) {
    const row = wpEl('div', 'pd-wrow');
    row.appendChild(wpEl('span', null, label));
    const bar = wpEl('div', 'pd-bar');
    const fill = document.createElement('i');
    bar.appendChild(fill);
    const cal = wpEl('button', 'pd-cal', 'Calibrate');
    cal.addEventListener('click', (e) => {
      e.stopPropagation();
      this._calibrate(role, cal);
    });
    row.append(bar, cal);
    return { row, bar, fill, cal, role, symmetric };
  }

  _stepperRow(label, onMinus, onPlus) {
    const row = wpEl('div', 'pd-wrow');
    row.appendChild(wpEl('span', null, label));
    const step = wpEl('div', 'pd-step');
    const minus = wpEl('button', null, '−');
    const val = wpEl('span', 'val', '');
    const plus = wpEl('button', null, '+');
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

  _adjustRange(delta) {
    const cfg = this.store.get();
    this.store.set({ steering: { rangeDeg: cfg.steering.rangeDeg + delta } });
  }

  _calibrate(role, btn) {
    const facade = this.getFacade();
    const hint = role === 'steer'
      ? 'turn the wheel fully left, then fully right'
      : 'press the pedal fully, then release';
    const r = facade.calibrate(role);
    if (!r.ok) {
      btn.textContent = 'No device';
      setTimeout(() => { btn.textContent = 'Calibrate'; }, 1500);
      return;
    }
    btn.classList.add('capturing');
    btn.textContent = hint;
    const done = () => {
      btn.classList.remove('capturing');
      btn.textContent = 'Calibrated ✓';
      setTimeout(() => { btn.textContent = 'Calibrate'; }, 1500);
      off();
    };
    const off = facade.onEvent
      ? facade.onEvent('wheelCalibrated', done)
      : (setTimeout(done, 4200), () => {});
  }

  _captureButton(actionId) {
    const facade = this.getFacade();
    const r = facade.captureButton(actionId);
    if (!r.ok) {
      this.addBindBtn.textContent = 'No device';
      setTimeout(() => { this.addBindBtn.textContent = 'Add binding — press a button…'; }, 1500);
      return;
    }
    this.addBindBtn.classList.add('capturing');
    this.addBindBtn.textContent = 'Press the wheel button now…';
    const done = () => {
      this.addBindBtn.classList.remove('capturing');
      this.addBindBtn.textContent = 'Add binding — press a button…';
      off();
    };
    const off = facade.onEvent
      ? facade.onEvent('wheelCalibrated', done)
      : (setTimeout(done, 4200), () => {});
  }

  _toggle() {
    this.expanded = !this.expanded;
    this._applyExpanded();
  }

  _applyExpanded() {
    this.cross.textContent = this.expanded ? '−' : '+';
    this.content.classList.toggle('open', this.expanded);
    if (this.expanded) this._startLive();
    else this._stopLive();
  }

  // Live bars: poll the pad via the facade while the section is open.
  _startLive() {
    if (this._raf) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this._renderLive();
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stopLive() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _renderLive() {
    let st = null;
    try { st = this.getFacade().state(); } catch (_e) { return; }
    if (!st) return;
    this.deviceRow.innerHTML = st.connected
      ? `<b>${wpEsc(st.device.id)}</b> — ${st.device.axes} axes, ${st.device.buttons} buttons` +
        (st.active ? ' · <b>driving</b>' : '')
      : 'no device detected — press a wheel button or turn the wheel to wake it';
    const rows = [this.steerBarRow, this.throttleRow, this.brakeRow, this.clutchRow];
    for (const r of rows) {
      const v = st.signals ? st.signals[r.role] || 0 : 0;
      if (r.symmetric) {
        // centred bar: fill from the middle toward the deflection
        const half = Math.abs(v) * 50;
        r.fill.style.left = v < 0 ? 50 - half + '%' : '50%';
        r.fill.style.width = half + '%';
      } else {
        r.fill.style.left = '0';
        r.fill.style.width = Math.max(0, Math.min(1, v)) * 100 + '%';
      }
    }
  }

  _render() {
    if (!this.rangeRow) return;
    const cfg = this.store.get();
    this.enabledBtn.textContent = cfg.enabled ? 'Wheel on' : 'Wheel off';
    this.enabledBtn.classList.toggle('on', cfg.enabled);
    this.rangeRow.val.textContent = cfg.steering.rangeDeg + '°';

    // bindings list
    this.bindList.innerHTML = '';
    const btns = Object.keys(cfg.bindings).map(Number).sort((a, b) => a - b);
    for (const btn of btns) {
      const row = wpEl('div', 'pd-bind');
      row.appendChild(wpEl('span', 'btn-id', 'Btn ' + btn));
      const sel = document.createElement('select');
      for (const a of WHEEL_ACTIONS) {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = a.label;
        if (a.id === cfg.bindings[btn]) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        const bindings = this.store.get().bindings;
        bindings[btn] = sel.value;
        this.store.setBindings(bindings);
      });
      const rm = wpEl('button', 'rm', '×');
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        const bindings = this.store.get().bindings;
        delete bindings[btn];
        this.store.setBindings(bindings);
      });
      row.append(sel, rm);
      this.bindList.appendChild(row);
    }
    if (!btns.length) this.bindList.appendChild(wpEl('div', 'pd-dev', 'no buttons bound'));

    this.note.innerHTML =
      'Enabling the wheel switches the input mode to <b>gamepad</b>. ' +
      'Pedals self-calibrate after a full press; use <b>Calibrate</b> if an axis ' +
      'is mis-assigned. Steering reaches full lock at ±<b>' +
      Math.round(cfg.steering.rangeDeg / 2) + '°</b> of physical rotation.';
  }

  dispose() {
    this._stopLive();
    if (this._observer) this._observer.disconnect();
    if (this._unsub) this._unsub();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function wpEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function wpEsc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
