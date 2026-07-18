/**
 * Optional ambience sync for VehicleState (WP3, car-bench-compat-plan.md §4.7 /
 * Appendix B). Maps a task's time-of-day + weather condition onto a sim weather
 * preset — pure visual flavor with zero eval impact. Python resolves the weather
 * condition string for the current location and passes it in; the sim only
 * chooses a preset by name-substring against the active skin's weather list.
 *
 * Installs VehicleState.ambience(spec) and a reset pre-hook (so the preset lands
 * before reset projects the linked fields — the weather system's forced
 * headlight write is then overridden by the headlight projection under the lock).
 */
(function () {
  if (typeof VehicleState === 'undefined') return;

  function pd() { return (typeof window !== 'undefined') ? window.PromptDrive : null; }

  // hour + condition -> a preset intent (substring to match against skin weathers)
  function pickPreset(hour, condition) {
    let slot = 'clear';
    if (hour != null) {
      const h = Number(hour);
      if (h >= 5 && h < 8) slot = 'sunrise';
      else if (h >= 8 && h < 17) slot = 'clear';
      else if (h >= 17 && h < 20) slot = 'sunset';
      else slot = 'night';
    }
    let want = slot;
    if (slot !== 'night' && condition) { // night wins over condition
      const c = String(condition).toLowerCase();
      if (/rain|thunderstorm|hail/.test(c)) want = 'rain';
      else if (/snow/.test(c)) want = 'snow';
      else if (/fog/.test(c)) want = 'rain'; // closest wet/dim preset
    }
    return want;
  }

  function applyAmbience(spec) {
    spec = spec || {};
    const api = pd();
    if (!api) return { ok: false, error: 'unavailable' };
    try {
      const want = pickPreset(spec.hour, spec.condition);
      const list = (typeof api.weathers === 'function') ? api.weathers() : [];
      let match = null;
      for (const w of list) {
        if (String(w.name).toLowerCase().indexOf(want) >= 0) { match = w; break; }
      }
      if (!match && want === 'sunset') { // sunset also satisfied by 'twilight'
        for (const w of list) { if (/twilight/i.test(w.name)) { match = w; break; } }
      }
      const target = match ? match.name : (list[1] ? list[1].name : null);
      if (target != null && api.dynamic && api.dynamic.weather) api.dynamic.weather(target);
      return { ok: true, value: { requested: want, applied: target } };
    } catch (e) {
      return { ok: false, error: 'exception', message: String((e && e.message) || e) };
    }
  }

  VehicleState.ambience = function (spec) { return applyAmbience(spec); };

  // Reset pre-hook: read datetime from the incoming initConfig (the fixed store
  // isn't populated yet at this point) and the condition from opts.
  VehicleState.onReset('pre', (initConfig, opts) => {
    if (!opts || opts.ambience === false) return;
    const dt = (initConfig && initConfig.current_datetime) || null;
    applyAmbience({ hour: dt ? dt.hour : null, condition: opts.ambienceCondition || null });
  });
})();
