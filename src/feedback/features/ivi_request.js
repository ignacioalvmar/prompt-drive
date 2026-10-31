/**
 * IVI request cards: when an agent changes an in-vehicle function through the
 * API, a short-lived card on the center console says what changed
 * ("Temp · Driver  20 → 22 °C"), then fades out. When the change belongs to a
 * console app (Comfort, Audio, Nav), that app is put in the 1/3 pane of the
 * split view as the card disappears, so the function stays visible without
 * displacing what the driver had open (e.g. navigation keeps the 2/3 pane).
 *
 * Sources (API only; driver taps and reads never produce a card):
 *   vehicleState  — PromptDrive.vehicle.set (CAR-bench store); diffed against
 *                   the last snapshot this feature saw. vehicle.reset is task
 *                   initialisation, not a request, so it only re-baselines.
 *   iviRequest    — PromptDrive.console.audio.* / console.comfort.* mutators,
 *                   emitted by the API with before/after app state.
 * Phone calls are left out: the Phone app already brings itself up on ring/call.
 *
 * Requests that arrive within MERGE_MS of each other merge into one card (an
 * agent turn often fires several tool calls in a row). Failed requests never
 * reach here (the API only emits on success). Drawn over the app panes through
 * CenterConsole.registerOverlay({ layer: 'content' }), so nothing is reflowed.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const MERGE_MS = 750;   // gap that still counts as the same burst
  const HOLD_MS = 4000;   // card stays this long after the last request
  const FADE_MS = 250;
  const MAX_LINES = 4;    // more changes collapse into "+N more"
  const C = {
    card: 'rgba(20,23,28,0.96)', edge: 'rgba(64,224,208,0.55)', text: '#f4f6f8',
    muted: 'rgba(188,193,200,0.85)', faint: 'rgba(188,193,200,0.45)', accent: '#40E0D0',
  };
  const FONT = "'ShareTech', 'Share Tech', system-ui, sans-serif";

  // --- vehicle-state field presentation --------------------------------------
  const SIDE = { driver: 'Driver', passenger: 'Passenger', driver_rear: 'Rear left', passenger_rear: 'Rear right' };
  const pct = (v) => `${v}%`;
  const onOff = (v) => (v ? 'On' : 'Off');
  const level = (v) => (v ? `${v}/3` : 'Off');
  const words = (v) => String(v).toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' + ');
  const FIELDS = {
    sunroof_position: { label: 'Sunroof', fmt: pct },
    sunshade_position: { label: 'Sunshade', fmt: pct },
    trunk_door_position: { label: 'Trunk', fmt: (v) => words(v) },
    fog_lights: { label: 'Fog lights', fmt: onOff },
    head_lights_low_beams: { label: 'Low beams', fmt: onOff },
    head_lights_high_beams: { label: 'High beams', fmt: onOff },
    ambient_light: { label: 'Ambient light', fmt: words },
    steering_wheel_heating: { label: 'Wheel heating', fmt: level },
    fan_speed: { label: 'Fan', fmt: (v) => (v ? String(v) : 'Off'), app: 'comfort' },
    window_front_defrost: { label: 'Front defrost', fmt: onOff },
    window_rear_defrost: { label: 'Rear defrost', fmt: onOff },
    fan_airflow_direction: { label: 'Airflow', fmt: words },
    air_conditioning: { label: 'A/C', fmt: onOff },
    air_circulation: { label: 'Air circulation', fmt: (v) => ({ AUTO: 'Auto', FRESH_AIR: 'Fresh air', RECIRCULATION: 'Recirculation' }[v] || words(v)) },
    navigation_active: { label: 'Navigation', fmt: onOff, app: 'nav' },
    waypoints_id: { label: 'Waypoints', fmt: () => 'Updated', app: 'nav', noDelta: true },
    routes_to_final_destination_id: { label: 'Route', fmt: () => 'Updated', app: 'nav', noDelta: true },
    // email_addresses_sent_mail_to / phone_numbers_called are call logs, not functions: no card.
  };
  for (const s of ['driver', 'passenger', 'driver_rear', 'passenger_rear']) {
    FIELDS[`window_${s}_position`] = { label: `Window · ${SIDE[s]}`, fmt: pct };
    FIELDS[`reading_light_${s}`] = { label: `Reading light · ${SIDE[s]}`, fmt: onOff };
  }
  for (const s of ['driver', 'passenger']) {
    FIELDS[`climate_temperature_${s}`] = { label: `Temp · ${SIDE[s]}`, fmt: (v) => `${v} °C`, app: 'comfort' };
    FIELDS[`seat_heating_${s}`] = { label: `Seat heat · ${SIDE[s]}`, fmt: level, app: 'comfort' };
  }

  // --- state -------------------------------------------------------------------
  let card = null;        // { lines: Map key -> { label, from, to }, app, shownAt, lastAt, hideAt }
  let baseline = {};      // last VehicleState snapshot seen
  let unregister = null;
  let pollTimer = null;
  let hideTimer = null;
  const offs = [];

  function now() { return (typeof performance !== 'undefined') ? performance.now() : Date.now(); }

  function consoleInstance(ctx) {
    const h = ctx.handles();
    if (h && h.centerConsole) return h.centerConsole;
    const K = window.CenterConsole;
    return (K && K.lastInstance) || null;
  }

  function consoleOn(inst) {
    try { return !!inst && (typeof inst.enabled !== 'function' || inst.enabled()); } catch (_e) { return false; }
  }

  // --- card lifecycle ------------------------------------------------------------
  function push(ctx, lines, app) {
    const inst = consoleInstance(ctx);
    if (!consoleOn(inst) || !lines.length) return;
    const t = now();
    if (card && t - card.lastAt > MERGE_MS) finish(ctx); // previous burst is over
    if (!card) card = { lines: new Map(), app: null, shownAt: t, lastAt: t, hideAt: 0 };
    for (const l of lines) {
      const prev = card.lines.get(l.key);
      // Same function touched twice in a burst: keep the original "from".
      card.lines.set(l.key, prev ? Object.assign({}, l, { from: prev.from }) : l);
    }
    if (app) card.app = app;
    card.lastAt = t;
    card.hideAt = t + HOLD_MS;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => finish(ctx), HOLD_MS + FADE_MS);
    if (typeof inst._requestDraw === 'function') inst._requestDraw();
  }

  /** Card gone: put its function in the 1/3 pane unless it is already on screen. */
  function finish(ctx) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const done = card;
    card = null;
    if (!done) return;
    const inst = consoleInstance(ctx);
    if (!consoleOn(inst)) return;
    if (done.app) {
      const L = inst.layout || {};
      const visible = L.primary === done.app || (L.mode === 'split' && L.secondary === done.app);
      if (!visible && typeof inst.split === 'function') {
        try { inst.split(L.primary, done.app); } catch (_e) {}
      }
    }
    if (typeof inst._requestDraw === 'function') inst._requestDraw();
  }

  // --- sources --------------------------------------------------------------------
  function onVehicleState(ctx, payload) {
    const changed = (payload && payload.changed) || {};
    const lines = [];
    let app = null;
    for (const key of Object.keys(changed)) {
      const f = FIELDS[key];
      if (!f) continue;
      const to = changed[key];
      const from = baseline[key];
      const same = JSON.stringify(from) === JSON.stringify(to);
      lines.push({ key, label: f.label, from: (same || f.noDelta || from === undefined) ? null : f.fmt(from), to: f.fmt(to) });
      if (f.app) app = f.app;
    }
    if (payload && payload.snapshot) baseline = payload.snapshot;
    push(ctx, lines, app);
  }

  const ZONE = { driver: 'Driver', passenger: 'Passenger', rear: 'Rear' };
  function comfortLines(before, after) {
    const out = [];
    if (!after) return out;
    for (const z of Object.keys(ZONE)) {
      const b = (before && before[z]) || {}, a = after[z] || {};
      if (a.tempC !== b.tempC) out.push({ key: `cf.${z}.temp`, label: `Temp · ${ZONE[z]}`, from: b.tempC != null ? `${b.tempC} °C` : null, to: `${a.tempC} °C` });
      if (a.fan !== b.fan) out.push({ key: `cf.${z}.fan`, label: `Fan · ${ZONE[z]}`, from: b.fan != null ? (b.fan ? String(b.fan) : 'Off') : null, to: a.fan ? String(a.fan) : 'Off' });
      if (a.seatHeat !== b.seatHeat) out.push({ key: `cf.${z}.seat`, label: `Seat heat · ${ZONE[z]}`, from: b.seatHeat != null ? level(b.seatHeat) : null, to: level(a.seatHeat) });
    }
    if (before && !!after.auto !== !!before.auto) out.push({ key: 'cf.auto', label: 'Climate auto', from: onOff(before.auto), to: onOff(after.auto) });
    if (before && !!after.sync !== !!before.sync) out.push({ key: 'cf.sync', label: 'Climate sync', from: onOff(before.sync), to: onOff(after.sync) });
    return out;
  }

  function audioLines(action, before, after) {
    const out = [];
    if (!after) return out;
    const title = (s) => (s && s.track ? s.track.title : '');
    if (!before || title(before) !== title(after)) out.push({ key: 'au.track', label: 'Track', from: null, to: title(after) });
    if (!before || before.playing !== after.playing || action === 'play' || action === 'pause') {
      out.push({ key: 'au.play', label: 'Audio', from: null, to: after.playing ? 'Playing' : 'Paused' });
    }
    if (before && before.volume !== after.volume) {
      out.push({ key: 'au.vol', label: 'Volume', from: pct(Math.round(before.volume * 100)), to: pct(Math.round(after.volume * 100)) });
    }
    return out;
  }

  function onIviRequest(ctx, p) {
    if (!p) return;
    let lines = [];
    if (p.app === 'comfort') lines = comfortLines(p.before, p.after);
    else if (p.app === 'audio') lines = audioLines(p.action, p.before, p.after);
    if (!lines.length) return; // a request that changed nothing (already at that value)
    push(ctx, lines, p.app);
  }

  // --- drawing ---------------------------------------------------------------------
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function fit(c, text, maxW) {
    if (c.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function draw(c, rect, t) {
    if (!card) return;
    const fadeIn = Math.min(1, (t - card.shownAt) / FADE_MS);
    const fadeOut = Math.max(0, Math.min(1, (card.hideAt + FADE_MS - t) / FADE_MS));
    const alpha = Math.min(fadeIn, fadeOut);
    if (alpha <= 0) return;

    // Right third of the content area: the split view's secondary column.
    const margin = 14;
    const x = rect.x + Math.round(rect.w * 2 / 3) + margin;
    const w = rect.x + rect.w - margin - x;
    const all = Array.from(card.lines.values());
    const lines = all.length > MAX_LINES ? all.slice(0, MAX_LINES - 1) : all;
    const more = all.length - lines.length;
    const headH = 40, rowH = 52, pad = 16;
    const h = headH + (lines.length + (more ? 1 : 0)) * rowH + pad;
    const y = rect.y + margin - (1 - fadeIn) * 12;

    c.save();
    c.globalAlpha = alpha;
    roundRect(c, x, y, w, h, 14);
    c.fillStyle = C.card;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = C.edge;
    c.stroke();

    // Header: agent badge.
    c.fillStyle = C.accent;
    c.beginPath();
    c.arc(x + pad + 6, y + headH / 2 + 4, 6, 0, Math.PI * 2);
    c.fill();
    c.font = `600 15px ${FONT}`;
    c.textBaseline = 'middle';
    c.fillStyle = C.accent;
    c.fillText('AGENT', x + pad + 20, y + headH / 2 + 4);

    let ry = y + headH;
    for (const l of lines) {
      const cy = ry + rowH / 2;
      c.font = `400 17px ${FONT}`;
      c.fillStyle = C.muted;
      c.textAlign = 'left';
      c.fillText(fit(c, l.label, w - pad * 2), x + pad, cy - 11);
      c.font = `600 22px ${FONT}`;
      c.fillStyle = C.text;
      const value = l.from != null ? `${l.from}  →  ${l.to}` : l.to;
      c.fillText(fit(c, value, w - pad * 2), x + pad, cy + 12);
      ry += rowH;
    }
    if (more) {
      c.font = `400 17px ${FONT}`;
      c.fillStyle = C.faint;
      c.fillText(`+${more} more`, x + pad, ry + rowH / 2);
    }
    c.restore();
  }

  // --- registration -------------------------------------------------------------------
  function attach(ctx) {
    const inst = consoleInstance(ctx);
    if (!inst || typeof inst.registerOverlay !== 'function') return false;
    unregister = inst.registerOverlay({ id: 'ivi_request', layer: 'content', draw: (c, rect, t) => draw(c, rect, t) });
    return true;
  }

  CabinFeedback.register({
    id: 'ivi_request',
    title: 'IVI request cards (consola)',
    fields: [],

    init(ctx) {
      baseline = ctx.snapshot() || {};
      const b = window.PromptDriveBridge;
      if (b && typeof b.on === 'function') {
        offs.push(b.on('vehicleState', (p) => onVehicleState(ctx, p)));
        offs.push(b.on('vehicleReset', (p) => { if (p && p.snapshot && p.snapshot.dynamic) baseline = p.snapshot.dynamic; }));
        offs.push(b.on('iviRequest', (p) => onIviRequest(ctx, p)));
      }
      // The console exists only once the sim has started; keep (re)attaching.
      const tick = () => {
        const inst = consoleInstance(ctx);
        if (inst && (!unregister || (inst._overlays && !inst._overlays.some((o) => o.id === 'ivi_request')))) attach(ctx);
      };
      tick();
      pollTimer = setInterval(tick, 1000);
    },

    dispose() {
      if (pollTimer) clearInterval(pollTimer);
      if (hideTimer) clearTimeout(hideTimer);
      for (const off of offs) { try { off(); } catch (_e) {} }
      if (unregister) unregister();
    },
  });
})();
