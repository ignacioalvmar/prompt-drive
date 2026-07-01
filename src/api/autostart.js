/**
 * Optional auto-start: bypass the "begin" splash gate so a remote/headless
 * caller (or the test console) can launch straight into a running simulation
 * from a static configuration — no manual click required.
 *
 * Enabled by either:
 *   - query param  ?autostart=1   (set when launching a fresh instance), or
 *   - localStorage 'pd-autostart' === '1'  (set by PromptDrive.config.autostart).
 *
 * Default OFF, so the normal app still shows the splash. When on, we watch for
 * the splash "begin" control (#splash-loader.splash-ready) and click it once —
 * the same React onClick path a user takes — which runs beginGame() and brings
 * up the live sim (and with it the API bridge attach).
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function enabled() {
    try {
      const qs = new URLSearchParams(window.location.search);
      const q = qs.get('autostart');
      if (q === '1' || q === 'true') return true;
    } catch (_e) { /* no URLSearchParams */ }
    try {
      if (window.localStorage.getItem('pd-autostart') === '1') return true;
    } catch (_e) { /* storage unavailable */ }
    return false;
  }

  if (!enabled()) return;

  let clicked = false;
  function tryClick() {
    if (clicked) return true;
    const el = document.getElementById('splash-loader');
    // Only the "begin" state (a fresh start), not "return", and only once the
    // splash is ready for interaction.
    if (el && el.classList.contains('splash-ready') && /begin/i.test(el.textContent || '')) {
      clicked = true;
      try { el.click(); } catch (_e) {}
      return true;
    }
    return false;
  }

  // The splash mounts after the React app loads, so poll briefly until it shows.
  const iv = setInterval(() => { if (tryClick()) clearInterval(iv); }, 200);
  setTimeout(() => clearInterval(iv), 30000);

  // Expose for the bridge/test console to invoke or inspect.
  window.PromptDriveAutostart = { tryClick, enabled };
})();
