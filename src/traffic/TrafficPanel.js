/**
 * Traffic configuration UI, injected into the game's settings sidebar as a
 * collapsible "traffic" section (placed below the road-lanes section, which
 * is appended before this bundle loads).
 *
 * Mirrors LanePanel: the React-rendered settings list mounts/unmounts as the
 * user opens/closes it, so the section is (re)injected via a MutationObserver
 * and matches the native collapsible markup so it looks built-in.
 *
 * Static config (enabled/density/speed/oncoming) applies on reload; the
 * stopped-vehicle event row is live (plan §8).
 */

const TP_STYLE_ID = 'pd-traffic-style';
const TP_SECTION_ID = 'pd-traffic-section';
const TP_CONTENT_ID = 'pd-traffic-content';

const TP_CSS = `
#${TP_SECTION_ID}{background:#222;border-bottom:0.57px solid #111;cursor:pointer}
#${TP_SECTION_ID} .collapsible-cross{float:right}
#${TP_CONTENT_ID}{background:#1c1c1c;border-bottom:0.57px solid #111;
  font-family:Jura,system-ui,sans-serif;color:rgba(255,255,255,.7);
  padding:6px 10px 12px;display:none}
#${TP_CONTENT_ID}.open{display:block}
#${TP_CONTENT_ID} .pd-fam{color:#888;font-size:11px;letter-spacing:2px;
  text-transform:uppercase;margin:10px 0 4px}
#${TP_CONTENT_ID} .pd-trow{display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:4px 0;font-size:13px}
#${TP_CONTENT_ID} .pd-step{display:flex;align-items:center;gap:6px}
#${TP_CONTENT_ID} .pd-step button{width:24px;height:24px;font:600 14px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;cursor:pointer}
#${TP_CONTENT_ID} .pd-step button:hover{border-color:#3ec6b5}
#${TP_CONTENT_ID} .pd-step .val{min-width:52px;text-align:center;color:#eafffb;font-weight:600}
#${TP_CONTENT_ID} .pd-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;
  border-top:1px solid #333;padding-top:10px}
#${TP_CONTENT_ID} .pd-actions button{flex:1 1 auto;font:600 12px Jura,system-ui;
  background:#2a2a2a;color:#cfe9e6;border:1px solid #3a3a3a;border-radius:5px;
  padding:7px 8px;cursor:pointer;letter-spacing:1px}
#${TP_CONTENT_ID} .pd-actions button:hover{border-color:#3ec6b5}
#${TP_CONTENT_ID} .pd-actions button.apply{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${TP_CONTENT_ID} .pd-actions button.on{background:#1d3a36;border-color:#3ec6b5;color:#eafffb}
#${TP_CONTENT_ID} .pd-note{font-size:11px;color:#8aa0a0;margin-top:10px;line-height:1.4}
#${TP_CONTENT_ID} .pd-note b{color:#cfe9e6}
`;

class TrafficPanel {
  constructor(store, getFacade) {
    this.store = store;
    this.getFacade = getFacade;
    this.expanded = false;
    this.eventDistance = 100;
    this.eventLane = 1;
    this._injectStyle();
    this._buildSection();
    this._scheduled = false;
    this._observer = new MutationObserver(() => this._schedule());
    this._observer.observe(document.body, { childList: true, subtree: true });
    this._tryInject();
    this._unsub = store.subscribe(() => this._render());
  }

  _injectStyle() {
    if (document.getElementById(TP_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = TP_STYLE_ID;
    s.textContent = TP_CSS;
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
    this.header = tpEl('div', 'settings-input-row settings-input-list_section collapsible');
    this.header.id = TP_SECTION_ID;
    this.title = tpEl('div', 'collapsible-title', 'traffic');
    this.cross = tpEl('div', 'collapsible-cross', '+');
    this.header.append(this.title, this.cross);
    this.header.addEventListener('click', () => this._toggle());

    this.content = tpEl('div');
    this.content.id = TP_CONTENT_ID;

    this.content.appendChild(tpEl('div', 'pd-fam', 'traffic vehicles'));
    const toggles = tpEl('div', 'pd-actions');
    this.enabledBtn = tpEl('button', null, 'Traffic off');
    this.enabledBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.store.set({ enabled: !this.store.get().enabled });
    });
    this.oncomingBtn = tpEl('button', null, 'Oncoming on');
    this.oncomingBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.store.set({ oncoming: !this.store.get().oncoming });
    });
    toggles.append(this.enabledBtn, this.oncomingBtn);
    this.content.appendChild(toggles);

    this.densityRow = this._stepperRow('Vehicles', () => this._adjust('density', -1), () => this._adjust('density', 1));
    this.speedRow = this._stepperRow('Speed', () => this._adjust('speed', -1), () => this._adjust('speed', 1));
    this.content.append(this.densityRow.row, this.speedRow.row);

    const applyRow = tpEl('div', 'pd-actions');
    this.applyBtn = tpEl('button', 'apply', 'Apply & restart');
    this.applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      location.reload();
    });
    applyRow.appendChild(this.applyBtn);
    this.content.appendChild(applyRow);

    // --- Stopped-vehicle event (live) ---
    this.content.appendChild(tpEl('div', 'pd-fam', 'stopped vehicle event'));
    this.evDistRow = this._stepperRow('Distance ahead', () => this._adjustEvent('eventDistance', -10), () => this._adjustEvent('eventDistance', 10));
    this.evLaneRow = this._stepperRow('Lane', () => this._adjustEvent('eventLane', -1), () => this._adjustEvent('eventLane', 1));
    this.content.append(this.evDistRow.row, this.evLaneRow.row);
    const evRow = tpEl('div', 'pd-actions');
    this.spawnBtn = tpEl('button', 'apply', 'Spawn stopped vehicle');
    this.spawnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._spawnStopped();
    });
    evRow.appendChild(this.spawnBtn);
    this.content.appendChild(evRow);

    this.note = tpEl('div', 'pd-note');
    this.content.appendChild(this.note);

    this._applyExpanded();
  }

  _spawnStopped() {
    let result = null;
    try {
      result = this.getFacade().spawnStopped({ distance: this.eventDistance, lane: this.eventLane });
    } catch (_e) {
      result = { ok: false, error: 'unavailable' };
    }
    this.spawnBtn.textContent = result && result.ok ? 'Spawned ✓' : 'Failed — sim live?';
    setTimeout(() => {
      this.spawnBtn.textContent = 'Spawn stopped vehicle';
    }, 1500);
  }

  _stepperRow(label, onMinus, onPlus) {
    const row = tpEl('div', 'pd-trow');
    row.appendChild(tpEl('span', null, label));
    const step = tpEl('div', 'pd-step');
    const minus = tpEl('button', null, '−');
    const val = tpEl('span', 'val', '');
    const plus = tpEl('button', null, '+');
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

  _adjustEvent(key, delta) {
    if (key === 'eventDistance') {
      this.eventDistance = Math.max(TRAFFIC_TUNING.stoppedEventMinDist, Math.min(600, this.eventDistance + delta));
    } else {
      // Signed lane: skip 0 (…-2, -1, 1, 2…), clamped to the configured layout.
      let next = this.eventLane + delta;
      if (next === 0) next += delta;
      let fwd = 5;
      let bwd = 5;
      try {
        const lanes = typeof window !== 'undefined' && window.LaneRoads ? window.LaneRoads.get() : null;
        if (lanes) {
          fwd = lanes.forward;
          bwd = lanes.backward;
        }
      } catch (_e) {
        /* keep permissive bounds */
      }
      this.eventLane = Math.max(bwd > 0 ? -bwd : 1, Math.min(fwd, next));
      if (this.eventLane === 0) this.eventLane = 1;
    }
    this._render();
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
    if (!this.densityRow) return;
    const cfg = this.store.get();
    this.enabledBtn.textContent = cfg.enabled ? 'Traffic on' : 'Traffic off';
    this.enabledBtn.classList.toggle('on', cfg.enabled);
    this.oncomingBtn.textContent = cfg.oncoming ? 'Oncoming on' : 'Oncoming off';
    this.oncomingBtn.classList.toggle('on', cfg.oncoming);
    this.densityRow.val.textContent = String(cfg.density);
    this.speedRow.val.textContent = cfg.speed + ' m/s';
    this.evDistRow.val.textContent = this.eventDistance + ' m';
    this.evLaneRow.val.textContent = this.eventLane > 0 ? `fwd ${this.eventLane}` : `onc ${-this.eventLane}`;
    this.note.innerHTML =
      `Traffic vehicles hold their lane at <b>${cfg.speed} m/s</b> ` +
      `(${Math.round(cfg.speed * 3.6)} km/h) and brake for obstacles ahead. ` +
      `Enable/density/speed apply on <b>Apply &amp; restart</b>. ` +
      `The stopped-vehicle event is live: lane <b>fwd 1</b> is the ego's lane, ` +
      `<b>onc</b> lanes are oncoming.`;
  }

  dispose() {
    if (this._observer) this._observer.disconnect();
    if (this._unsub) this._unsub();
    if (this.header) this.header.remove();
    if (this.content) this.content.remove();
  }
}

function tpEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
