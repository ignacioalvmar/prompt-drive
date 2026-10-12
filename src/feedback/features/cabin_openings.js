/**
 * Cabin openings: spatial, read-only feedback for windows and the sunroof.
 * The car diagram mirrors for right-hand-drive layouts. A short detail view
 * confirms changed positions, then becomes a compact persistent reminder.
 */
(function () {
  if (typeof CabinFeedback === 'undefined') return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WINDOWS = [
    { key: 'window_driver_position', short: 'C', label: 'Conductor' },
    { key: 'window_passenger_position', short: 'CP', label: 'Copiloto' },
    { key: 'window_driver_rear_position', short: 'TC', label: 'Trasera conductor' },
    { key: 'window_passenger_rear_position', short: 'TP', label: 'Trasera copiloto' },
  ];
  const FIELDS = WINDOWS.map((item) => item.key).concat([
    'sunshade_position', 'sunroof_position', 'air_conditioning',
  ]);
  const OPENINGS = WINDOWS.map((item) => item.key).concat(['sunroof_position']);
  const DETAIL_MS = 2500;
  const BATCH_MS = 150;
  const values = Object.fromEntries(FIELDS.map((key) => [key, 0]));
  values.air_conditioning = false;
  let card = null;
  let diagram = null;
  let details = null;
  let compactText = null;
  let message = null;
  let shadeLayer = null;
  let roofOpening = null;
  let openShapes = {};
  let visual = Object.assign({}, values);
  let hasState = false;
  let detailTimer = null;
  let batchTimer = null;
  let roofTimer = null;
  let pendingKeys = new Set();
  let pendingRoof = null;
  let shadeMotionEnds = 0;
  let rain = false;
  let weatherOff = null;
  let readyOff = null;
  let reducedMotion = false;

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number));
  }

  function svgElement(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
    return node;
  }

  function appendWindow(group, x, y, key) {
    group.appendChild(svgElement('rect', {
      x, y, width: 9, height: 34, rx: 2, class: 'co-window-frame',
    }));
    const opening = svgElement('rect', {
      x: x + 1, y: y + 1, width: 7, height: 32, rx: 1, class: 'co-window-open',
      'data-field': key,
    });
    opening.style.transformBox = 'fill-box';
    opening.style.transformOrigin = 'center bottom';
    opening.style.transform = 'scaleY(0)';
    openShapes[key] = opening;
    group.appendChild(opening);
  }

  function makeDiagram(ctx) {
    const svg = svgElement('svg', {
      class: 'co-car', viewBox: '0 0 100 190', role: 'img',
      'aria-label': 'Vista superior del carro y sus aperturas',
    });
    svg.dataset.mirrored = ctx.config.side === 'right' ? 'true' : 'false';

    svg.appendChild(svgElement('path', {
      d: 'M50 3 C34 3 26 8 22 19 L15 43 Q12 50 12 61 L12 137 Q12 148 16 159 L22 176 Q27 187 50 187 Q73 187 78 176 L84 159 Q88 148 88 137 L88 61 Q88 50 85 43 L78 19 C74 8 66 3 50 3 Z',
      class: 'co-body',
    }));
    svg.appendChild(svgElement('path', {
      d: 'M28 22 Q50 13 72 22 L77 43 L23 43 Z', class: 'co-windshield',
    }));
    svg.appendChild(svgElement('path', {
      d: 'M23 146 L77 146 L71 170 Q50 179 29 170 Z', class: 'co-rear-glass',
    }));
    svg.appendChild(svgElement('path', {
      d: 'M19 48 L81 48 L81 72 L19 72 Z M19 91 L81 91 L81 121 L19 121 Z',
      class: 'co-cabin-seams',
    }));

    const windows = svgElement('g', { class: 'co-windows' });
    appendWindow(windows, 13, 52, 'window_driver_position');
    appendWindow(windows, 78, 52, 'window_passenger_position');
    appendWindow(windows, 13, 94, 'window_driver_rear_position');
    appendWindow(windows, 78, 94, 'window_passenger_rear_position');
    svg.appendChild(windows);

    svg.appendChild(svgElement('rect', {
      x: 34, y: 72, width: 32, height: 48, rx: 4, class: 'co-roof-frame',
    }));
    roofOpening = svgElement('rect', {
      x: 38, y: 76, width: 24, height: 40, rx: 2, class: 'co-roof-open',
    });
    roofOpening.style.transformBox = 'fill-box';
    roofOpening.style.transformOrigin = 'center top';
    roofOpening.style.transform = 'scaleY(0)';
    svg.appendChild(roofOpening);
    shadeLayer = svgElement('rect', {
      x: 36, y: 74, width: 28, height: 44, rx: 2, class: 'co-shade',
    });
    shadeLayer.style.transformBox = 'fill-box';
    shadeLayer.style.transformOrigin = 'center top';
    shadeLayer.style.transform = 'scaleY(1)';
    svg.appendChild(shadeLayer);

    svg.appendChild(svgElement('path', {
      d: 'M50 5 L50 13 M46 10 L50 14 L54 10', class: 'co-front-mark',
    }));
    return svg;
  }

  function openKeys() {
    return OPENINGS.filter((key) => values[key] > 0);
  }

  function anyOpening() { return openKeys().length > 0; }

  function hasRisk() {
    const anyWindow = WINDOWS.some((item) => values[item.key] > 0);
    return (anyWindow && (Boolean(values.air_conditioning) || rain)) || (values.sunroof_position > 0 && rain);
  }

  function refreshCopy() {
    const lines = [];
    for (const item of WINDOWS) {
      const amount = values[item.key];
      if (amount > 0) lines.push(`${item.label}: ${amount}% abierta`);
    }
    if (values.sunroof_position > 0) lines.push(`Techo: ${values.sunroof_position}% abierto`);
    if (values.sunshade_position > 0) lines.push(`Cortinilla: ${values.sunshade_position}% retraída`);
    else if (values.sunroof_position > 0) lines.push('Cortinilla: cerrada');
    details.textContent = lines.length ? lines.join(' · ') : 'Todo cerrado';

    const compact = [];
    for (const item of WINDOWS) {
      const amount = values[item.key];
      if (amount > 0) compact.push(`${item.short} ${amount}%`);
    }
    if (values.sunroof_position > 0) compact.push(`Techo ${values.sunroof_position}%`);
    if (values.sunshade_position > 0 && values.sunroof_position > 0) compact.push(`Cort. ${values.sunshade_position}%`);
    else if (values.sunroof_position > 0) compact.push('Cort. cerrada');
    compactText.textContent = compact.join(' · ');
    card.dataset.empty = anyOpening() ? 'false' : 'true';
    card.dataset.roofObstructed = values.sunroof_position > 0 && values.sunshade_position < 100 ? 'true' : 'false';

    if (hasRisk()) {
      const reasons = [];
      if (values.air_conditioning && WINDOWS.some((item) => values[item.key] > 0)) reasons.push('ventana abierta con A/C');
      if (rain && (WINDOWS.some((item) => values[item.key] > 0) || values.sunroof_position > 0)) reasons.push('apertura con lluvia');
      message.textContent = `Atención: ${reasons.join(' · ')}`;
      card.dataset.risk = 'true';
    } else {
      message.textContent = '';
      card.dataset.risk = 'false';
    }
  }

  function setVisibility(visible) {
    card.dataset.visible = visible ? 'true' : 'false';
    card.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function setMode(mode) { card.dataset.mode = mode; }

  function displayDuration(from, to) {
    if (reducedMotion || from === to) return 0;
    return Math.max(300, Math.min(3000, Math.abs(to - from) * 30));
  }

  function applyPercent(key, node, next, transformFor) {
    const previous = Number(visual[key]) || 0;
    const duration = displayDuration(previous, next);
    node.style.transition = duration ? `transform ${duration}ms cubic-bezier(0.2, 0.7, 0.2, 1)` : 'none';
    node.style.transform = transformFor(next);
    visual[key] = next;
    return duration;
  }

  function finishPendingRoof() {
    if (pendingRoof == null) return;
    if (values.sunshade_position < 100) return;
    const target = pendingRoof;
    pendingRoof = null;
    if (roofTimer) { clearTimeout(roofTimer); roofTimer = null; }
    const delay = Math.max(0, shadeMotionEnds - Date.now());
    if (delay > 0 && target > 0) {
      roofTimer = setTimeout(() => {
        roofTimer = null;
        applyPercent('sunroof_position', roofOpening, target, (n) => `scaleY(${n / 100})`);
      }, delay);
    } else {
      applyPercent('sunroof_position', roofOpening, target, (n) => `scaleY(${n / 100})`);
    }
  }

  function renderVisual(keys, animate, reset) {
    const changed = new Set(keys);
    for (const item of WINDOWS) {
      if (!animate || reset) {
        openShapes[item.key].style.transition = 'none';
        openShapes[item.key].style.transform = `scaleY(${values[item.key] / 100})`;
        visual[item.key] = values[item.key];
      } else if (changed.has(item.key)) {
        applyPercent(item.key, openShapes[item.key], values[item.key], (n) => `scaleY(${n / 100})`);
      }
    }

    if (!animate || reset) {
      shadeLayer.style.transition = 'none';
      roofOpening.style.transition = 'none';
      shadeLayer.style.transform = `scaleY(${(100 - values.sunshade_position) / 100})`;
      roofOpening.style.transform = `scaleY(${values.sunroof_position / 100})`;
      visual.sunshade_position = values.sunshade_position;
      visual.sunroof_position = values.sunroof_position;
      shadeMotionEnds = 0;
      pendingRoof = null;
      if (roofTimer) { clearTimeout(roofTimer); roofTimer = null; }
      return;
    }

    if (changed.has('sunshade_position')) {
      const duration = applyPercent('sunshade_position', shadeLayer, values.sunshade_position,
        (n) => `scaleY(${(100 - n) / 100})`);
      shadeMotionEnds = Date.now() + duration;
      if (values.sunshade_position < 100) {
        pendingRoof = null;
        if (roofTimer) { clearTimeout(roofTimer); roofTimer = null; }
        if (values.sunroof_position > 0) {
          applyPercent('sunroof_position', roofOpening, values.sunroof_position,
            (n) => 'scaleY(' + (n / 100) + ')');
        }
      } else if (pendingRoof != null) {
        finishPendingRoof();
      }
    }

    if (changed.has('sunroof_position')) {
      const target = values.sunroof_position;
      if (target > 0 && values.sunshade_position >= 100 && Date.now() < shadeMotionEnds) {
        pendingRoof = target;
        finishPendingRoof();
      } else {
        pendingRoof = null;
        if (roofTimer) { clearTimeout(roofTimer); roofTimer = null; }
        applyPercent('sunroof_position', roofOpening, target, (n) => `scaleY(${n / 100})`);
      }
    }
  }

  function updateCard(animate, reset, changedKeys) {
    const staticRender = !animate || reset;
    const keys = Array.isArray(changedKeys) ? changedKeys : Array.from(pendingKeys);
    if (staticRender) card.style.transition = 'none';
    refreshCopy();
    renderVisual(keys, animate, reset);
    const active = anyOpening();
    const openingChanged = keys.some((key) => OPENINGS.includes(key) || key === 'sunshade_position');
    if (reset) {
      if (detailTimer) { clearTimeout(detailTimer); detailTimer = null; }
      setMode('compact');
      setVisibility(active);
      card.offsetHeight;
      card.style.transition = '';
      return;
    }

    // Context-only updates with no open window or roof do not create a false message.
    if (!active && !openingChanged) return;

    setVisibility(true);
    setMode('detail');
    if (detailTimer) clearTimeout(detailTimer);
    if (active) {
      detailTimer = setTimeout(() => {
        setMode('compact');
        detailTimer = null;
      }, DETAIL_MS);
    } else {
      // refreshCopy already shows the single neutral “Todo cerrado” confirmation.
      detailTimer = setTimeout(() => {
        setVisibility(false);
        detailTimer = null;
      }, DETAIL_MS);
    }
    if (staticRender) {
      card.offsetHeight;
      card.style.transition = '';
    }
  }

  function updateWeather(isRain) {
    rain = Boolean(isRain);
    if (card && hasState) refreshCopy();
  }

  function normalizeSide(side) {
    if (side === 'right' || side === 0 || side === '0') return 'right';
    if (side === 'left' || side === 1 || side === '1') return 'left';
    return null;
  }

  function applyDriverSide(side) {
    const normalized = normalizeSide(side);
    if (!normalized || !card || !diagram) return;
    card.dataset.side = normalized === 'right' ? 'left' : 'right';
    diagram.dataset.mirrored = normalized === 'right' ? 'true' : 'false';
  }

  function rainFromWeather(value, weatherList) {
    let candidate = value;
    if (candidate && typeof candidate === 'object') {
      candidate = candidate.name != null ? candidate.name : candidate.index;
    }
    if (typeof candidate === 'number' && Array.isArray(weatherList)) {
      const entry = weatherList.find((item) => item && Number(item.index) === candidate);
      candidate = entry && entry.name;
    }
    return typeof candidate === 'string' && /(rain|rainy|lluvia|lluvioso|storm|tormenta|drizzle|llovizna)/i.test(candidate);
  }

  function readInitialWeather() {
    try {
      const pd = window.PromptDrive;
      if (!pd || typeof pd.get !== 'function' || typeof pd.weathers !== 'function') return false;
      const index = pd.get('scene.weatherIndex');
      const list = pd.weathers();
      if (!Array.isArray(list) || list.length === 0) return false;
      return rainFromWeather(index, list);
    } catch (_error) { return false; }
  }

  CabinFeedback.register({
    id: 'cabin_openings',
    title: 'Aperturas de cabina',
    fields: FIELDS,

    init(ctx) {
      reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const style = document.createElement('style');
      style.textContent = `
        .co-card {
          position: absolute; top: max(1.6vh, env(safe-area-inset-top));
          width: clamp(14vw, 18vw, 23vw); max-width: 24vw; box-sizing: border-box;
          padding: clamp(0.65vh, 1vh, 1.4vh) clamp(0.65vw, 0.9vw, 1.2vw);
          border: 1px solid rgba(151, 205, 217, 0.48); border-radius: 1.1vw;
          background: rgba(10, 18, 25, 0.91); color: #f4f7f8;
          box-shadow: 0 1vh 2.3vw rgba(0, 0, 0, 0.28);
          font: 500 clamp(0.72vw, 0.9vw, 1.05vw)/1.28 system-ui, -apple-system, sans-serif;
          opacity: 0; visibility: hidden; transform: translateY(-0.7vh) scale(0.98);
          transition: opacity 220ms ease, transform 220ms ease, visibility 220ms;
          backdrop-filter: blur(0.5vw); overflow: hidden;
        }
        .co-card[data-side="left"] { left: max(1.3vw, env(safe-area-inset-left)); }
        .co-card[data-side="right"] { right: max(1.3vw, env(safe-area-inset-right)); }
        .co-card[data-visible="true"] { opacity: 1; visibility: visible; transform: none; }
        .co-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1vw; margin-bottom: 0.65vh; }
        .co-title { color: #bce9ef; font-size: 0.82em; font-weight: 750; letter-spacing: 0.1em; text-transform: uppercase; }
        .co-front-label { color: rgba(244,247,248,0.68); font-size: 0.78em; }
        .co-content { display: flex; align-items: center; gap: 0.65vw; }
        .co-car { display: block; flex: 0 0 31%; width: 31%; max-height: 25vh; overflow: visible; transition: transform 200ms ease; }
        .co-car[data-mirrored="true"] { transform: scaleX(-1); }
        .co-body { fill: #26343e; stroke: rgba(236,246,250,0.88); stroke-width: 1.5; }
        .co-windshield, .co-rear-glass { fill: #506a76; stroke: rgba(220,239,244,0.78); stroke-width: 1; }
        .co-cabin-seams { fill: none; stroke: rgba(220,239,244,0.5); stroke-width: 1; }
        .co-window-frame { fill: #101b22; stroke: rgba(220,239,244,0.85); stroke-width: 1; }
        .co-window-open { fill: #5ac6d4; opacity: 0.95; }
        .co-roof-frame { fill: #18242c; stroke: rgba(220,239,244,0.8); stroke-width: 1; }
        .co-roof-open { fill: #14212a; stroke: #8eced8; stroke-width: 1; }
        .co-shade { fill: #aab9be; stroke: #e6eff0; stroke-width: 1; }
        .co-front-mark { fill: none; stroke: #f4f7f8; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
        .co-copy { flex: 1 1 auto; min-width: 0; }
        .co-details { color: rgba(244,247,248,0.95); font-size: 0.95em; line-height: 1.55; overflow-wrap: anywhere; }
        .co-compact { display: none; color: rgba(244,247,248,0.95); font-variant-numeric: tabular-nums; line-height: 1.4; overflow-wrap: anywhere; }
        .co-message { min-height: 0; margin-top: 0.25vh; color: rgba(244,247,248,0.9); font-weight: 700; }
        .co-message:empty { display: none; }
        .co-card[data-risk="true"] { border-color: #f1b647; box-shadow: 0 0 0 0.16vw rgba(241,182,71,0.16), 0 1vh 2.3vw rgba(0,0,0,0.28); }
        .co-card[data-risk="true"] .co-message { color: #ffd18a; }
        .co-card[data-risk="true"] .co-window-open, .co-card[data-risk="true"] .co-roof-open { fill: #f1b647; stroke: #ffd18a; }
        .co-card[data-roof-obstructed="true"] .co-roof-open { fill: #f1b647; stroke: #ffd18a; }
        .co-card[data-roof-obstructed="true"] .co-shade { fill: rgba(241,182,71,0.34); stroke: #ffd18a; }
        .co-card[data-empty="true"] .co-details { color: rgba(244,247,248,0.8); }
        .co-card[data-mode="compact"] { width: clamp(9vw, 11vw, 15vw); max-width: 16vw; }
        .co-card[data-mode="compact"] .co-details, .co-card[data-mode="compact"] .co-front-label { display: none; }
        .co-card[data-mode="compact"] .co-compact { display: block; }
        .co-card[data-mode="compact"] .co-car { flex-basis: 26%; width: 26%; max-height: 12vh; }
        @media (prefers-reduced-motion: reduce) {
          .co-card, .co-car, .co-window-open, .co-roof-open, .co-shade { transition: none !important; }
        }
      `;
      ctx.layer.appendChild(style);

      card = document.createElement('section');
      card.className = 'co-card';
      card.dataset.visible = 'false';
      card.dataset.risk = 'false';
      card.dataset.mode = 'detail';
      card.setAttribute('aria-hidden', 'true');
      card.setAttribute('aria-label', 'Estado de las ventanas, techo y cortinilla');

      const heading = document.createElement('div');
      heading.className = 'co-heading';
      const title = document.createElement('span');
      title.className = 'co-title';
      title.textContent = 'Aperturas';
      const front = document.createElement('span');
      front.className = 'co-front-label';
      front.textContent = '↑ frente';
      heading.append(title, front);
      card.appendChild(heading);

      const content = document.createElement('div');
      content.className = 'co-content';
      diagram = makeDiagram(ctx);
      content.appendChild(diagram);
      const copy = document.createElement('div');
      copy.className = 'co-copy';
      details = document.createElement('div');
      details.className = 'co-details';
      details.setAttribute('aria-live', 'polite');
      compactText = document.createElement('div');
      compactText.className = 'co-compact';
      message = document.createElement('div');
      message.className = 'co-message';
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      copy.append(details, compactText);
      content.appendChild(copy);
      card.append(heading, content, message);
      ctx.layer.appendChild(card);

      applyDriverSide(ctx.config.side);

      rain = readInitialWeather();
      try {
        const pd = window.PromptDrive;
        if (pd && typeof pd.on === 'function') {
          weatherOff = pd.on('weatherChange', (payload) => {
            let list = [];
            try { list = typeof pd.weathers === 'function' ? pd.weathers() : []; } catch (_error) {}
            updateWeather(rainFromWeather(payload, list));
          });
          readyOff = pd.on('ready', () => {
            try { applyDriverSide(pd.get('vehicle.side')); } catch (_error) { applyDriverSide(ctx.config.side); }
            updateWeather(readInitialWeather());
          });
        }
      } catch (_error) { weatherOff = null; }
    },

    onChange(changed, snapshot) {
      const initial = !hasState;
      const reset = !initial && FIELDS.every((key) => Object.prototype.hasOwnProperty.call(changed, key));
      const source = snapshot || changed || {};
      for (const key of FIELDS) {
        if (Object.prototype.hasOwnProperty.call(changed || {}, key)) values[key] = key === 'air_conditioning'
          ? Boolean(changed[key]) : clampPercent(changed[key]);
        else if (Object.prototype.hasOwnProperty.call(source, key)) values[key] = key === 'air_conditioning'
          ? Boolean(source[key]) : clampPercent(source[key]);
      }
      hasState = true;
      for (const key of Object.keys(changed || {})) if (FIELDS.includes(key)) pendingKeys.add(key);

      if (initial || reset) {
        if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
        pendingKeys = new Set(FIELDS);
        updateCard(false, true);
        pendingKeys.clear();
        return;
      }

      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => {
        batchTimer = null;
        const keys = Array.from(pendingKeys);
        updateCard(true, false, keys);
        pendingKeys.clear();
        // Rendering a new target must be followed by the ordinary detail timeout.
        if (keys.length === 0) setMode(anyOpening() ? 'compact' : 'detail');
      }, BATCH_MS);
    },

    dispose() {
      if (detailTimer) clearTimeout(detailTimer);
      if (batchTimer) clearTimeout(batchTimer);
      if (roofTimer) clearTimeout(roofTimer);
      if (typeof weatherOff === 'function') weatherOff();
      if (typeof readyOff === 'function') readyOff();
    },
  });
})();
