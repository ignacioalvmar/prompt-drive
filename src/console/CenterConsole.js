/**
 * Center console (center stack): a 16:9 touchscreen with a tight black rim,
 * mounted on the lateral center of the dashboard in the in-cabin view.
 *
 * Follows the InstrumentCluster pattern: a 2D canvas drawn ~30 Hz becomes a
 * CanvasTexture on a plane mesh inside the ego group (`Ae.geo`), gated on the
 * first-person observable. The engine creates one instance in the controller's
 * initialise (see the `CenterConsole` patches in scripts/build-main.js) and
 * calls `frame(Ae.geo, Js.value)` from updateUI.
 *
 * Interaction comes from two sides:
 *  - pointer events on the game canvas, hand-raycast onto the screen plane
 *    (this THREE build has no Raycaster — we unproject + intersect ourselves);
 *  - the integration API (`PromptDrive.console.*`), which drives the same app
 *    controllers and can synthesize taps via `tap(u, v)`.
 */

import { CONSOLE_CANVAS, SCREEN_PLANE, RIM, DOCK, SPLIT, CONSOLE_COLORS, APP_ORDER, CONSOLE_STORAGE } from './config.js';
import { HitMap, fillRoundRect, drawText, iconSplit, iconSwap, font } from './ui.js';
import { MapApp } from './apps/MapApp.js';
import { NavApp } from './apps/NavApp.js';
import { AudioApp } from './apps/AudioApp.js';
import { PhoneApp } from './apps/PhoneApp.js';
import { ComfortApp } from './apps/ComfortApp.js';

// The full-width dashboard surface is part of this mesh in the Roadster body
// OBJ (roadster-07-int); coords below are body-OBJ-local (+X forward, +Y up,
// +Z vehicle right). The dash top's rear edge sits at (x 1.9242, y 0.8672),
// laterally centred at z ≈ 0. The console is a tablet-style display standing
// on that edge, leaning back slightly toward the windscreen — low enough not
// to block the road, high enough that the whole screen (including the icon
// dock on its lower side) stays inside the first-person camera's view.
const INTERIOR_MESH = 'z_interior_Cube.008';
const MOUNT = {
  base: { x: 1.9242, y: 0.8672 }, // dash-top rear edge (screen bottom sits here)
  tilt: 0.21, // rad, lean-back from vertical (top toward the windscreen)
  sink: 0.008, // metres the rim bottom sinks into the dash (seated look)
};

// Match the binnacle/dash render order (2); rim just behind the screen.
const CONSOLE_RENDER_ORDER = 2;

// --- minified-THREE constructor discovery (cluster idiom) -------------------

function ccFindMaterial(THREE) {
  if (THREE.MeshBasicMaterial) return THREE.MeshBasicMaterial;
  if (THREE.C) return THREE.C;
  return null;
}

function ccFindPlaneGeometry(THREE) {
  if (THREE.PlaneGeometry) return THREE.PlaneGeometry;
  if (THREE.J) return THREE.J;
  return null;
}

function ccFindBufferGeometry(THREE) {
  if (THREE.BufferGeometry) return THREE.BufferGeometry;
  for (const k of Object.keys(THREE)) {
    const p = THREE[k] && THREE[k].prototype;
    if (p && typeof p.setAttribute === 'function' && typeof p.setIndex === 'function') return THREE[k];
  }
  return null;
}

function ccFindBufferAttribute(THREE) {
  if (THREE.BufferAttribute) return THREE.BufferAttribute;
  for (const k of Object.keys(THREE)) {
    const p = THREE[k] && THREE[k].prototype;
    if (p && typeof p.setXYZ === 'function') return THREE[k];
  }
  return null;
}

function ccFindVector3(THREE) {
  if (THREE.Vector3) return THREE.Vector3;
  if (THREE.W) return THREE.W;
  for (const k of Object.keys(THREE)) {
    const p = THREE[k] && THREE[k].prototype;
    if (p && typeof p.setFromMatrixPosition === 'function' && typeof p.unproject === 'function') return THREE[k];
  }
  return null;
}

function ccFindMeshCtor(root, THREE) {
  // Prefer a real Mesh from the scene (THREE.u is InstancedMesh in this build).
  let ctor = null;
  root?.traverse?.((child) => {
    if (!ctor && child?.isMesh) ctor = child.constructor;
  });
  return ctor || THREE.B || THREE.Mesh;
}

const CC_BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function ccCreateCanvasTexture(THREE, canvas) {
  if (THREE.CanvasTexture) return new THREE.CanvasTexture(canvas);
  for (const key of Object.keys(THREE)) {
    const val = THREE[key];
    if (typeof val === 'function' && val.prototype?.isTexture) {
      const tex = new val(canvas);
      tex.image = canvas;
      return tex;
    }
  }
  // Tree-shaken build: recover the Texture ctor through a TextureLoader, the
  // same way the instrument cluster does.
  const LoaderCtor = THREE.U || THREE.TextureLoader;
  if (LoaderCtor) {
    const tempTex = new LoaderCtor().load(CC_BLANK_PIXEL);
    const TextureCtor = tempTex.constructor;
    const texture = new TextureCtor(canvas);
    texture.image = canvas;
    tempTex.dispose();
    return texture;
  }
  throw new Error('CenterConsole: THREE.Texture constructor not found');
}

// Rounded-rectangle outline (counter-clockwise) for the rim prism.
function ccRoundedRectOutline(w, h, r, seg = 5) {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  corner(hw - rr, hh - rr, 0);
  corner(-hw + rr, hh - rr, Math.PI / 2);
  corner(-hw + rr, -hh + rr, Math.PI);
  corner(hw - rr, -hh + rr, Math.PI * 1.5);
  return pts;
}

// Extrude a 2D outline into a prism (front/back fans + walls), like the
// cluster pod. Double-sided material, so winding is unimportant.
function ccBuildPrism(THREE, outline, depth) {
  const BufGeo = ccFindBufferGeometry(THREE);
  const BufAttr = ccFindBufferAttribute(THREE);
  if (!BufGeo || !BufAttr) return null;
  const N = outline.length;
  const pos = [0, 0, 0, 0, 0, -depth];
  for (const p of outline) pos.push(p[0], p[1], 0);
  for (const p of outline) pos.push(p[0], p[1], -depth);
  const FR = 2;
  const BR = 2 + N;
  const idx = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    idx.push(0, FR + i, FR + j);
    idx.push(1, BR + j, BR + i);
    idx.push(FR + i, FR + j, BR + j);
    idx.push(FR + i, BR + j, BR + i);
  }
  const g = new BufGeo();
  g.setAttribute('position', new BufAttr(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class CenterConsole {
  constructor(THREE) {
    this.THREE = THREE;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CONSOLE_CANVAS.width;
    this.canvas.height = CONSOLE_CANVAS.height;
    this.ctx = this.canvas.getContext('2d');

    const MaterialCtor = ccFindMaterial(THREE);
    if (!MaterialCtor) throw new Error('CenterConsole: MeshBasicMaterial not found');
    this.texture = ccCreateCanvasTexture(THREE, this.canvas);
    this.texture.generateMipmaps = false;
    if (THREE.LinearFilter !== undefined) {
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
    }
    this.material = new MaterialCtor({
      map: this.texture,
      side: THREE.DoubleSide ?? 2,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.rimMaterial = new MaterialCtor({
      color: RIM.color,
      side: THREE.DoubleSide ?? 2,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });

    this.screenMesh = null;
    this.rimMesh = null;
    this._overlayParent = null;
    this._active = false;
    this._data = this._emptyData();

    // Apps: dock order matches APP_ORDER.
    this.apps = { map: MapApp, nav: NavApp, audio: AudioApp, phone: PhoneApp, comfort: ComfortApp };
    this._env = {};
    for (const id of APP_ORDER) {
      this._env[id] = { state: {}, hits: new HitMap(), data: this._data, now: 0, console: null };
    }
    this._dockHits = new HitMap();

    // Layout: fullscreen primary, or 2/3 + 1/3 split.
    this.layout = this._loadLayout();

    // Pointer capture: { appId, role } while an app holds a drag.
    this._capture = null;
    this._pointerArmed = false;

    // Facade handed to apps (and used by the API namespace).
    const facade = {
      open: (id) => this.open(id),
      split: (a, b) => this.split(a, b),
      layout: () => Object.assign({}, this.layout),
      emit: (name, payload) => this._emit(name, payload),
      requestDraw: () => this._requestDraw(),
    };
    this._facade = facade;
    for (const id of APP_ORDER) {
      this._env[id].console = facade;
      try { this.apps[id].init?.(facade); } catch (e) { console.error('CenterConsole app init failed', id, e); }
    }

    this._inputLocked = false; // benchmark mode: swallow screen taps, no routing
    this._ensureFonts();
    this._armPointer();
    this._wireEngineAudio();
    CenterConsole.lastInstance = this;
    this.draw(); // first paint so the texture is never black
  }

  /**
   * The console's HTMLAudio elements (music, ringtone) live outside the
   * engine's WebAudio graph, so they must mirror the master volume (KeyM
   * mute = AudioLevel 0) and the pause/blur auto-mute themselves. The core
   * computes one gain and pushes it to every app exposing onAudioGain(gain).
   */
  _wireEngineAudio() {
    const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
    if (!b || typeof b.whenAttached !== 'function') return;
    b.whenAttached((h) => {
      const push = () => {
        let gain = 1;
        try {
          const paused = !!(h.ticker && (h.ticker.paused || h.ticker.blurred));
          const level = (h.units && typeof h.units.AudioLevel === 'number') ? h.units.AudioLevel : 1;
          gain = paused ? 0 : level;
        } catch (_e) {}
        for (const id of APP_ORDER) {
          const app = this.apps[id];
          if (app && typeof app.onAudioGain === 'function') {
            try { app.onAudioGain(gain); } catch (_e) {}
          }
        }
      };
      try { h.units && h.units.addListener && h.units.addListener('AudioLevel', push); } catch (_e) {}
      try { h.ticker && h.ticker.addStateListener && h.ticker.addStateListener(push); } catch (_e) {}
      try { h.ticker && h.ticker.addBlurListener && h.ticker.addBlurListener(push); } catch (_e) {}
      push();
    });
  }

  _emptyData() {
    return {
      speedKph: 0, speedDisplay: 0, speedUnit: 'KPH', heading: 0,
      egoX: 0, egoZ: 0, autodrive: false, paused: false,
      clock: new Date(), handles: null, lanes: null, laneApplied: null, traffic: null,
    };
  }

  _ensureFonts() {
    if (this._fontsReady || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = `
      @font-face {
        font-family: 'ShareTech';
        src: url('./static/media/ShareTech.8b302ac6.ttf') format('truetype');
      }
    `;
    document.head.appendChild(style);
    this._fontsReady = true;
  }

  // --- layout state ----------------------------------------------------------

  _loadLayout() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CONSOLE_STORAGE.ui) || 'null'); } catch (_e) {}
    const ok = (id) => APP_ORDER.indexOf(id) >= 0;
    const layout = {
      mode: saved && saved.mode === 'split' ? 'split' : 'full',
      primary: saved && ok(saved.primary) ? saved.primary : 'map',
      secondary: saved && ok(saved.secondary) ? saved.secondary : 'audio',
    };
    if (layout.secondary === layout.primary) layout.secondary = layout.primary === 'audio' ? 'map' : 'audio';
    return layout;
  }

  _saveLayout() {
    try { localStorage.setItem(CONSOLE_STORAGE.ui, JSON.stringify(this.layout)); } catch (_e) {}
  }

  _layoutChanged() {
    this._saveLayout();
    this._emit('consoleLayout', Object.assign({}, this.layout));
    this._requestDraw();
  }

  /**
   * Coalesced out-of-band redraw, for state changes that happen outside the
   * engine's updateUI tick (API calls, taps while the sim is paused). The
   * renderer only presents the texture on the next rendered frame, but this
   * keeps the canvas current so resume/screenshot never shows stale UI.
   */
  _requestDraw() {
    if (this._drawQueued) return;
    this._drawQueued = true;
    setTimeout(() => {
      this._drawQueued = false;
      try { this.draw(); } catch (_e) {}
    }, 0);
  }

  /** Bring an app to the primary pane (kept in the current full/split mode). */
  open(id) {
    if (APP_ORDER.indexOf(id) < 0) return { ok: false, error: 'unknown_app', app: id };
    if (this.layout.primary !== id) {
      if (this.layout.mode === 'split') {
        // The old primary steps aside into the 1/3 pane.
        this.layout.secondary = this.layout.primary === id ? this.layout.secondary : this.layout.primary;
      }
      this.layout.primary = id;
      if (this.layout.secondary === id) this.layout.secondary = null;
      if (this.layout.mode === 'split' && !this.layout.secondary) this.layout.mode = 'full';
      this._layoutChanged();
    }
    return { ok: true, value: Object.assign({}, this.layout) };
  }

  /** Split view: primary takes 2/3, secondary 1/3. */
  split(primary, secondary) {
    const p = primary || this.layout.primary;
    if (APP_ORDER.indexOf(p) < 0) return { ok: false, error: 'unknown_app', app: p };
    let s = secondary || (this.layout.secondary !== p ? this.layout.secondary : null) ||
      (this.layout.primary !== p ? this.layout.primary : null) ||
      APP_ORDER.find((a) => a !== p);
    if (APP_ORDER.indexOf(s) < 0) return { ok: false, error: 'unknown_app', app: s };
    if (s === p) return { ok: false, error: 'bad_value', message: 'primary and secondary must differ' };
    this.layout.mode = 'split';
    this.layout.primary = p;
    this.layout.secondary = s;
    this._layoutChanged();
    return { ok: true, value: Object.assign({}, this.layout) };
  }

  setLayoutMode(mode) {
    if (mode !== 'full' && mode !== 'split') return { ok: false, error: 'bad_value', message: "mode must be 'full' or 'split'" };
    if (mode === 'split') return this.split(this.layout.primary, this.layout.secondary);
    this.layout.mode = 'full';
    this._layoutChanged();
    return { ok: true, value: Object.assign({}, this.layout) };
  }

  swap() {
    if (this.layout.mode !== 'split' || !this.layout.secondary) return { ok: false, error: 'not_split' };
    const p = this.layout.primary;
    this.layout.primary = this.layout.secondary;
    this.layout.secondary = p;
    this._layoutChanged();
    return { ok: true, value: Object.assign({}, this.layout) };
  }

  /** Pane rectangles in canvas px. Secondary reserves a small swap header. */
  _paneRects() {
    const W = this.canvas.width;
    const contentH = this.canvas.height - DOCK.height;
    if (this.layout.mode !== 'split' || !this.layout.secondary) {
      return { primary: { x: 0, y: 0, w: W, h: contentH }, secondary: null, header: null };
    }
    const pw = Math.round(W * SPLIT.primaryFrac) - SPLIT.divider;
    const sx = pw + SPLIT.divider * 2;
    const headerH = 36;
    return {
      primary: { x: 0, y: 0, w: pw, h: contentH },
      header: { x: sx, y: 0, w: W - sx, h: headerH },
      secondary: { x: sx, y: headerH, w: W - sx, h: contentH - headerH },
    };
  }

  // --- engine integration -----------------------------------------------------

  /**
   * Whether the console is turned on in the vehicle settings
   * (`VehicleConfig.showConsole`, the "Interior: Show center console" toggle).
   * Defaults to on when the handle isn't available yet. When off, the console
   * never renders and the API rejects console calls.
   */
  enabled() {
    const h = this._handles();
    try {
      if (h && h.vehicleConfig && h.vehicleConfig.value) {
        return h.vehicleConfig.value.showConsole !== false;
      }
    } catch (_e) {}
    return true;
  }

  /** Per-tick entry point (patched into updateUI): attach/show + redraw. */
  frame(root, active) {
    // Gate on the vehicle-config toggle as well as the cabin view, so turning
    // the console off in settings removes it even in first-person.
    const show = !!active && this.enabled();
    this.applyToObject(root, show);
    if (!this._active || !this.screenMesh) return;
    this._refreshData();
    this.draw();
  }

  /** Attach the screen+rim into the vehicle group; toggle with the cabin view. */
  applyToObject(root, active) {
    this._active = !!active;
    if (!this._active && this._capture) {
      // Leaving the cabin view mid-drag: close out the gesture so the app
      // isn't left waiting for an 'up' that can never arrive.
      const last = this._lastDragPt;
      this._routePoint('up', last ? last.x : -1, last ? last.y : -1);
      this._capture = null;
      this._lastDragPt = null;
    }
    if (!root) return null;
    if (active && !this._ensureMeshes(root)) return null;
    if (this.screenMesh) this.screenMesh.visible = this._active && this.screenMesh.parent != null;
    if (this.rimMesh) this.rimMesh.visible = this._active && this.rimMesh.parent != null;
    return this.screenMesh;
  }

  /** Called by the engine patch before Ae.geo is purged on a vehicle change. */
  resetForVehicleChange() {
    this._removeMeshes();
  }

  _findAnchor(root) {
    let mesh = null;
    root?.traverse?.((child) => {
      if (!mesh && child?.isMesh && child.name === INTERIOR_MESH) mesh = child;
    });
    return mesh && mesh.parent ? { mesh, parent: mesh.parent } : null;
  }

  _ensureMeshes(root) {
    const anchor = this._findAnchor(root);
    if (!anchor) return false;
    if (this.screenMesh && this.screenMesh.parent === anchor.parent) return true;
    this._removeMeshes();

    const THREE = this.THREE;
    const PlaneGeo = ccFindPlaneGeometry(THREE);
    const MeshCtor = ccFindMeshCtor(root, THREE);
    if (!PlaneGeo || !MeshCtor) return false;

    // Placement: display standing on the dash-top rear edge, tilted back.
    // The plane's up direction after rotation is (sin tilt, cos tilt, 0), and
    // its normal (-cos tilt, +sin tilt, 0) — facing the cabin, slightly up.
    const tilt = MOUNT.tilt;
    const rimH = SCREEN_PLANE.height + RIM.bezel * 2;
    const rimW = SCREEN_PLANE.width + RIM.bezel * 2;
    const lift = rimH / 2 - MOUNT.sink;
    const mid = {
      x: MOUNT.base.x + Math.sin(tilt) * lift,
      y: MOUNT.base.y + Math.cos(tilt) * lift,
    };
    const nx = -Math.cos(tilt); // screen normal (rearward, toward the driver)
    const ny = Math.sin(tilt);
    let zc = 0;
    try {
      anchor.mesh.geometry.computeBoundingBox();
      const bb = anchor.mesh.geometry.boundingBox;
      zc = (bb.min.z + bb.max.z) / 2; // lateral center of the cabin (~0)
    } catch (_e) {}

    // Rim: rounded-rect prism tightly framing the screen — the tablet body.
    const rimGeo = ccBuildPrism(THREE, ccRoundedRectOutline(rimW, rimH, RIM.cornerRadius), RIM.depth) ||
      new PlaneGeo(rimW, rimH);
    const rim = new MeshCtor(rimGeo, this.rimMaterial);
    rim.name = 'center_console_rim';
    rim.rotation.order = 'YXZ';
    rim.rotation.set(-tilt, -Math.PI / 2, 0);
    rim.position.set(mid.x - nx * 0.002, mid.y - ny * 0.002, zc);
    rim.frustumCulled = false;
    rim.renderOrder = CONSOLE_RENDER_ORDER - 1;
    anchor.parent.add(rim);
    this.rimMesh = rim;

    const screen = new MeshCtor(new PlaneGeo(SCREEN_PLANE.width, SCREEN_PLANE.height), this.material);
    screen.name = 'center_console_screen';
    screen.rotation.order = 'YXZ';
    screen.rotation.set(-tilt, -Math.PI / 2, 0);
    screen.position.set(mid.x + nx * 0.003, mid.y + ny * 0.003, zc);
    screen.frustumCulled = false;
    screen.renderOrder = CONSOLE_RENDER_ORDER;
    anchor.parent.add(screen);
    this.screenMesh = screen;
    this._overlayParent = anchor.parent;
    return true;
  }

  _removeMeshes() {
    if (this.rimMesh) {
      this.rimMesh.parent?.remove(this.rimMesh);
      this.rimMesh.geometry?.dispose();
      this.rimMesh = null;
    }
    if (this.screenMesh) {
      this.screenMesh.parent?.remove(this.screenMesh);
      this.screenMesh.geometry?.dispose();
      this.screenMesh = null;
    }
    this._overlayParent = null;
  }

  _handles() {
    const b = typeof window !== 'undefined' ? window.PromptDriveBridge : null;
    return (b && b.handles) || null;
  }

  _refreshData() {
    const d = this._data;
    const h = this._handles();
    d.handles = h;
    d.clock = new Date();
    if (h && h.ego) {
      const units = h.units && h.units.Units;
      const factor = units === 1 ? 3.59999 : 2.23694;
      d.speedKph = (h.ego.speed || 0) * 3.6;
      d.speedDisplay = Math.max(0, (h.ego.speed || 0) * factor);
      d.speedUnit = units === 1 ? 'KPH' : 'MPH';
      d.heading = h.ego.heading || 0;
      d.egoX = h.ego.position ? h.ego.position.x : 0;
      d.egoZ = h.ego.position ? h.ego.position.z : 0;
      d.autodrive = !!(h.autodrive && h.autodrive.value);
      d.paused = !!(h.ticker && h.ticker.paused);
    }
    try {
      d.lanes = (typeof window !== 'undefined' && window.LaneRoads) ? window.LaneRoads._resolved : null;
      d.laneApplied = (typeof window !== 'undefined' && window.LaneRoads && window.LaneRoads.applied) ? window.LaneRoads.applied() : null;
    } catch (_e) { d.lanes = null; }
    try {
      d.traffic = (typeof window !== 'undefined' && window.RoadTraffic && window.RoadTraffic._engineAttached)
        ? window.RoadTraffic._manager : null;
    } catch (_e) { d.traffic = null; }
  }

  _emit(name, payload) {
    try {
      if (typeof window !== 'undefined' && window.PromptDriveBridge) {
        window.PromptDriveBridge.emit(name, payload);
      }
    } catch (_e) { /* best-effort */ }
  }

  // --- drawing ----------------------------------------------------------------

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    ctx.fillStyle = CONSOLE_COLORS.screenBg;
    ctx.fillRect(0, 0, W, H);

    const rects = this._paneRects();
    this._drawPane(this.layout.primary, rects.primary, now);
    if (rects.secondary) {
      // Divider + secondary header (label + swap affordance), owned by the core.
      ctx.fillStyle = CONSOLE_COLORS.divider;
      ctx.fillRect(rects.primary.w, 0, rects.secondary.x - rects.primary.w, H - DOCK.height);
      this._drawSecondaryHeader(rects.header, now);
      this._drawPane(this.layout.secondary, rects.secondary, now);
    }
    this._drawDock(now);
    this.texture.needsUpdate = true;
  }

  _drawPane(appId, rect, now) {
    const app = this.apps[appId];
    const env = this._env[appId];
    if (!app || !env) return;
    env.hits.clear();
    env.data = this._data;
    env.now = now;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.translate(rect.x, rect.y);
    try {
      app.draw(ctx, { w: rect.w, h: rect.h, compact: rect.w < 500 }, env);
    } catch (e) {
      ctx.fillStyle = CONSOLE_COLORS.panel;
      ctx.fillRect(0, 0, rect.w, rect.h);
      drawText(ctx, `${app.label || appId} unavailable`, rect.w / 2, rect.h / 2, {
        size: 22, color: CONSOLE_COLORS.muted, align: 'center', baseline: 'middle',
      });
      if (!env._drawErrorLogged) {
        env._drawErrorLogged = true;
        console.error('CenterConsole app draw failed', appId, e);
      }
    }
    ctx.restore();
  }

  _drawSecondaryHeader(rect, _now) {
    const ctx = this.ctx;
    const app = this.apps[this.layout.secondary];
    ctx.fillStyle = CONSOLE_COLORS.dockBg;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    drawText(ctx, (app && app.label) || '', rect.x + 16, rect.y + rect.h / 2, {
      size: 16, color: CONSOLE_COLORS.muted, baseline: 'middle',
    });
    iconSwap(ctx, rect.x + rect.w - 26, rect.y + rect.h / 2, 18, CONSOLE_COLORS.muted);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + rect.h - 0.5);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h - 0.5);
    ctx.stroke();
  }

  _drawDock(_now) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const top = H - DOCK.height;
    this._dockHits.clear();

    ctx.fillStyle = CONSOLE_COLORS.dockBg;
    ctx.fillRect(0, top, W, DOCK.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(W, top + 0.5);
    ctx.stroke();

    const n = APP_ORDER.length;
    const slot = DOCK.iconSize + DOCK.gap;
    const total = n * slot - DOCK.gap;
    let x = (W - total) / 2;
    const cy = top + DOCK.height / 2 - 7;
    for (const id of APP_ORDER) {
      const app = this.apps[id];
      const cx = x + DOCK.iconSize / 2;
      const active = id === this.layout.primary || (this.layout.mode === 'split' && id === this.layout.secondary);
      const isPrimary = id === this.layout.primary;
      if (isPrimary) {
        fillRoundRect(ctx, cx - DOCK.iconSize / 2 - 8, top + 8, DOCK.iconSize + 16, DOCK.height - 16, 12, CONSOLE_COLORS.panelRaised);
      }
      const color = active ? CONSOLE_COLORS.dockActive : CONSOLE_COLORS.dockIdle;
      try { app.drawIcon(ctx, cx, cy, DOCK.iconSize * 0.62, color); } catch (_e) {}
      drawText(ctx, app.label, cx, top + DOCK.height - 14, { size: 12, color, align: 'center', baseline: 'middle' });
      // Generous touch target, full dock height.
      this._dockHits.add(`app:${id}`, cx - slot / 2, top, slot, DOCK.height);
      x += slot;
    }

    // Split toggle, far right.
    const st = { w: 56, h: 56 };
    const sx = W - st.w - 22;
    const sy = top + (DOCK.height - st.h) / 2;
    if (this.layout.mode === 'split') {
      fillRoundRect(ctx, sx, sy, st.w, st.h, 12, CONSOLE_COLORS.panelRaised);
    }
    iconSplit(ctx, sx + st.w / 2, sy + st.h / 2, 26, this.layout.mode === 'split' ? CONSOLE_COLORS.dockActive : CONSOLE_COLORS.dockIdle);
    this._dockHits.add('split', sx - 8, top, st.w + 16, DOCK.height);

    // Clock, far left of the dock.
    const t = this._data.clock;
    const timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    drawText(ctx, timeStr, 24, top + DOCK.height / 2, { size: 20, color: CONSOLE_COLORS.muted, baseline: 'middle' });
  }

  // --- pointer input -----------------------------------------------------------

  _armPointer() {
    if (this._pointerArmed || typeof document === 'undefined') return;
    // Capture-phase listeners on the document: the game's UI overlays cover
    // the render canvas (e.g. #game-ui-backing), and the engine's own input
    // singleton listens on #game-main in the bubble phase — capturing here
    // sees every pointer first and can stop the ones the console consumes.
    this._onDown = (e) => this._pointerEvent('down', e);
    this._onMove = (e) => this._pointerEvent('move', e);
    this._onUp = (e) => this._pointerEvent('up', e);
    document.addEventListener('pointerdown', this._onDown, true);
    document.addEventListener('pointermove', this._onMove, true);
    document.addEventListener('pointerup', this._onUp, true);
    document.addEventListener('pointercancel', this._onUp, true);
    this._pointerArmed = true;
  }

  /** The game's WebGL canvas (for pointer→NDC conversion). */
  _renderCanvas() {
    if (!this._gameCanvas || !this._gameCanvas.isConnected) {
      this._gameCanvas = (typeof document !== 'undefined') ? document.getElementById('render-canvas') : null;
    }
    return this._gameCanvas;
  }

  /** Project a pointer event onto the screen plane; route when it hits. */
  _pointerEvent(type, e) {
    if (!this._active || !this.screenMesh || !this.screenMesh.visible) return;
    if (type !== 'down' && !this._capture) return;
    // While the sim is paused nothing renders and hit regions go stale under
    // the PAUSED overlay — don't accept (or swallow) screen taps.
    const h = this._handles();
    if (h && h.ticker && h.ticker.paused) return;
    // Only intercept pointers aimed at the game surface itself. Clicks on the
    // game's own DOM controls (menu buttons, panels) layered above the canvas
    // must keep working even where they overlap the projected screen.
    const t = e.target;
    if (t && t.closest) {
      const ui = t.closest('#game-ui');
      if (ui && t.id !== 'game-ui-backing') return;
      if (!ui && t.id !== 'render-canvas' && !t.closest('#game-main')) return;
    }
    const pt = this._project(e);
    if (!pt) {
      // Drag released/moved past the plane edge: finish at the last on-screen
      // point instead of a bogus origin (a seek bar must not snap to 0).
      if (type === 'up' && this._capture) {
        const last = this._lastDragPt;
        this._routePoint('up', last ? last.x : -1, last ? last.y : -1);
        this._lastDragPt = null;
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (this._inputLocked) {
      // Benchmark mode (car-bench): the pointer hit the screen, so swallow it
      // (never leak a tap to the game) but do NOT route it to any app — the
      // vehicle state is Python-authoritative. Report the blocked attempt.
      e.preventDefault();
      e.stopPropagation();
      if (type === 'down') this._emitBlocked(pt);
      return;
    }
    if (this._capture) this._lastDragPt = pt;
    const consumed = this._routePoint(type, pt.x, pt.y);
    if (!this._capture) this._lastDragPt = null;
    if (consumed || this._capture) {
      // Keep the tap away from the game (in Mouse input mode a click is
      // throttle). preventDefault also suppresses the compat mouse events;
      // stopPropagation keeps it from the game's #game-main handlers.
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * Hand-rolled picking (no Raycaster in this THREE build): unproject the
   * pointer's NDC point, then intersect the ray with the screen plane in the
   * mesh's local frame (plane z=0). Returns canvas px or null.
   */
  _project(e) {
    const h = this._handles();
    const camera = h && h.camera;
    const canvas = this._renderCanvas();
    if (!camera || !canvas) return null;
    const V3 = ccFindVector3(this.THREE);
    if (!V3) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    try {
      const origin = new V3().setFromMatrixPosition(camera.matrixWorld);
      const target = new V3(ndcX, ndcY, 0.5).unproject(camera);
      // Ray endpoints into the mesh's local frame.
      const oLocal = this.screenMesh.worldToLocal(origin.clone ? origin.clone() : new V3(origin.x, origin.y, origin.z));
      const tLocal = this.screenMesh.worldToLocal(target);
      const dx = tLocal.x - oLocal.x;
      const dy = tLocal.y - oLocal.y;
      const dz = tLocal.z - oLocal.z;
      if (Math.abs(dz) < 1e-8) return null;
      const t = -oLocal.z / dz;
      if (t <= 0) return null;
      const lx = oLocal.x + dx * t;
      const ly = oLocal.y + dy * t;
      const hw = SCREEN_PLANE.width / 2;
      const hh = SCREEN_PLANE.height / 2;
      const pad = this._capture ? 0.03 : 0; // forgiving while dragging
      if (Math.abs(lx) > hw + pad || Math.abs(ly) > hh + pad) return null;
      const u = (lx + hw) / SCREEN_PLANE.width;
      const v = (hh - ly) / SCREEN_PLANE.height;
      return { x: u * this.canvas.width, y: v * this.canvas.height };
    } catch (_e) {
      return null;
    }
  }

  /** Route a canvas-space point to the dock or the owning pane. */
  _routePoint(type, cx, cy) {
    // Active drag: deliver to the captured pane regardless of where we are.
    if (this._capture) {
      const rect = this._captureRect();
      if (rect) {
        const env = this._env[this._capture.appId];
        try {
          this.apps[this._capture.appId].onPointer(type, cx - rect.x, cy - rect.y, { w: rect.w, h: rect.h, compact: rect.w < 500 }, env);
        } catch (_e) {}
      }
      if (type === 'up') this._capture = null;
      return true;
    }
    if (type !== 'down') return false;

    // Dock.
    const dockHit = this._dockHits.at(cx, cy);
    if (dockHit) {
      if (dockHit.id === 'split') {
        if (this.layout.mode === 'split') this.setLayoutMode('full');
        else this.split(this.layout.primary, this.layout.secondary);
      } else if (dockHit.id.indexOf('app:') === 0) {
        this.open(dockHit.id.slice(4));
        this._emit('consoleApp', { app: this.layout.primary, layout: Object.assign({}, this.layout) });
      }
      return true;
    }

    const rects = this._paneRects();
    // Secondary header: swap panes.
    if (rects.header && this._inRect(cx, cy, rects.header)) {
      this.swap();
      return true;
    }
    for (const role of ['primary', 'secondary']) {
      const rect = rects[role];
      if (!rect || !this._inRect(cx, cy, rect)) continue;
      const appId = this.layout[role];
      const app = this.apps[appId];
      const env = this._env[appId];
      if (!app || !env) return true;
      let capture = false;
      try {
        capture = !!app.onPointer('down', cx - rect.x, cy - rect.y, { w: rect.w, h: rect.h, compact: rect.w < 500 }, env);
      } catch (_e) {}
      if (capture) this._capture = { appId, role };
      return true;
    }
    return cy < this.canvas.height; // anywhere on the screen still swallows the tap
  }

  _captureRect() {
    if (!this._capture) return null;
    const rects = this._paneRects();
    if (this._capture.role === 'secondary' && !rects.secondary) { this._capture = null; return null; }
    const rect = this._capture.role === 'secondary' ? rects.secondary : rects.primary;
    if (this.layout[this._capture.role] !== this._capture.appId) { this._capture = null; return null; }
    return rect;
  }

  _inRect(x, y, r) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  /**
   * Benchmark-mode input lock (car-bench-compat-plan.md §4.5, lock #4). When
   * locked, screen taps are swallowed but not routed, and tap() is refused —
   * programmatic controller access (e.g. comfort.controller.set, VehicleState's
   * own projection path) stays open.
   */
  setInputLocked(locked) {
    this._inputLocked = !!locked;
    return { ok: true, value: { locked: this._inputLocked } };
  }

  _emitBlocked(pt) {
    try {
      const b = (typeof window !== 'undefined') ? window.PromptDriveBridge : null;
      if (b) b.emit('consoleInputBlocked', { u: pt.x / this.canvas.width, v: pt.y / this.canvas.height });
    } catch (_e) { /* no bridge yet — nothing to report to */ }
  }

  /** Synthetic tap for the API: u, v normalized 0..1 across the screen. */
  tap(u, v) {
    if (this._inputLocked) return { ok: false, error: 'locked' };
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return { ok: false, error: 'bad_value', message: 'u and v must be 0..1' };
    const x = u * this.canvas.width;
    const y = v * this.canvas.height;
    this._routePoint('down', x, y);
    this._routePoint('up', x, y);
    return { ok: true, value: { x: Math.round(x), y: Math.round(y) } };
  }

  // --- state for the API --------------------------------------------------------

  state() {
    let audio = null;
    let phone = null;
    let comfort = null;
    try { audio = AudioApp.controller ? AudioApp.controller.status() : null; } catch (_e) {}
    try { phone = PhoneApp.controller ? PhoneApp.controller.status() : null; } catch (_e) {}
    try { comfort = ComfortApp.controller ? ComfortApp.controller.get() : null; } catch (_e) {}
    return {
      enabled: this.enabled(),
      visible: !!(this._active && this.screenMesh && this.screenMesh.visible),
      layout: Object.assign({}, this.layout),
      apps: APP_ORDER.slice(),
      audio,
      phone,
      comfort,
    };
  }

  dispose() {
    this._removeMeshes();
    this.texture.dispose();
    this.material.dispose();
    this.rimMaterial.dispose();
    if (typeof document !== 'undefined' && this._onDown) {
      document.removeEventListener('pointerdown', this._onDown, true);
      document.removeEventListener('pointermove', this._onMove, true);
      document.removeEventListener('pointerup', this._onUp, true);
      document.removeEventListener('pointercancel', this._onUp, true);
    }
  }
}
