/**
 * Optional "participant lockdown": hide the bottom-bar menu icons (`#menu-bar` —
 * the settings / scene / config icon groups) and the centre autodrive toggle
 * (`#autodrive`) so a participant without config-change privileges cannot open
 * the settings panels or flip drive conditions mid-study.
 *
 * Exposed two ways, mirroring autostart.js:
 *   - a static launch option — persisted to localStorage 'pd-hide-menu' (or the
 *     query param ?hideMenu=1), read on load and applied before the bar mounts;
 *   - a live dynamic toggle — PromptDrive.dynamic.hideMenu(bool) / the
 *     `ui.hideMenu` field — which shows/hides it on a running sim.
 *
 * Purely a DOM-overlay concern (it touches no engine state), so it lives in the
 * API bundle rather than a build-main engine patch. It injects a <style> rule
 * rather than toggling the nodes directly, so the rule takes effect the instant
 * the React-rendered bar appears — regardless of when that is relative to load.
 * The in-cabin instrument cluster (a 3D canvas) and passive HUD read-outs are
 * left untouched, so drivers still see their speed and autodrive status.
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var STORAGE_KEY = 'pd-hide-menu';
  var STYLE_ID = 'pd-hide-menu-style';
  // The interactive bottom-bar chrome: the menu icon groups (#menu-bar) and the
  // centre autodrive on/off toggle (#autodrive).
  var CSS = '#menu-bar,#autodrive{display:none!important;}';

  function readFlag() {
    try {
      var qs = new URLSearchParams(window.location.search);
      var q = qs.get('hideMenu') || qs.get('hidemenu');
      if (q === '1' || q === 'true') return true;
      if (q === '0' || q === 'false') return false;
    } catch (_e) { /* no URLSearchParams */ }
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw != null) return raw === '1' || raw === 'true';
    } catch (_e) { /* storage unavailable */ }
    return false;
  }

  // Inject or remove the hide rule. Idempotent.
  function apply(on) {
    var existing = document.getElementById(STYLE_ID);
    if (on) {
      if (!existing) {
        var el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = CSS;
        (document.head || document.documentElement).appendChild(el);
      }
    } else if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    return on;
  }

  // Apply live and (by default) remember the choice so it survives a reload.
  // Static config passes { persist: true }; a purely live dynamic toggle passes
  // { persist: false } to match the other live-only dynamic fields.
  function set(on, opts) {
    on = !!on;
    if (!opts || opts.persist !== false) {
      try {
        if (on) window.localStorage.setItem(STORAGE_KEY, '1');
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch (_e) { /* storage unavailable */ }
    }
    return apply(on);
  }

  function state() { return !!document.getElementById(STYLE_ID); }

  // Honour the persisted / query flag on load.
  if (readFlag()) apply(true);

  window.PromptDriveHideMenu = {
    set: set, apply: apply, state: state, readFlag: readFlag, STORAGE_KEY: STORAGE_KEY,
  };
})();
