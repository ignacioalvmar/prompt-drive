/**
 * AOI (area-of-interest) projection + classification. Turns the current 3D
 * scene into a small set of screen-space rects — instrument-cluster zones
 * (projected from the dashboard plane mesh through the render camera), the
 * road-ahead look point, and DOM chrome (menu bar, metrics overlay) — then
 * classifies gaze points against them.
 *
 * Projection is recomputed on a 1 Hz timer plus resize/camera events; per
 * sample classification is a handful of rect tests. Engine handles come from
 * window.PromptDriveBridge (camera, ego, controller, THREE) and every access
 * is defensive: with no handles the projector falls back to static regions.
 *
 * Zone geometry mirrors src/cluster/layout.js `zonesForCanvas()` (the cluster
 * bundle does not export it); canvas + plane dimensions are read live from the
 * cluster instance/mesh so a layout resize keeps the two in sync.
 */

import { AOI, GAZE_THRESHOLDS, FALLBACK_REGIONS } from './config.js';
import { pxPerDeg } from './gaze-math.js';

const REPROJECT_MS = 1000;

export class AoiProjector {
  constructor() {
    this._zones = []; // [{aoi, rect:{x,y,w,h}}] in CSS px, priority order
    this._roadAhead = null; // {cx, cy, r} px
    this._lastProject = 0;
    this._onResize = () => {
      this._lastProject = 0;
    };
    window.addEventListener('resize', this._onResize);
  }

  _handles() {
    try {
      return (window.PromptDriveBridge && window.PromptDriveBridge.handles) || null;
    } catch (_) {
      return null;
    }
  }

  /** Recompute projected zones if the reproject interval elapsed. */
  _maybeProject() {
    const now = performance.now();
    if (now - this._lastProject < REPROJECT_MS) return;
    this._lastProject = now;
    this._zones = [];
    this._roadAhead = null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // --- DOM chrome (always available) ---
    const overlay = document.querySelector('.pd-overlay.open');
    if (overlay) {
      const r = overlay.getBoundingClientRect();
      this._zones.push({ aoi: AOI.METRICS_OVERLAY, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
    }
    const bar = document.getElementById('menu-bar') || document.getElementById('menu-bar-left');
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        this._zones.push({ aoi: AOI.MENU_BAR, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }
    } else {
      const f = FALLBACK_REGIONS.menuBar;
      this._zones.push({ aoi: AOI.MENU_BAR, rect: { x: f.x * vw, y: f.y * vh, w: f.w * vw, h: f.h * vh } });
    }

    const h = this._handles();
    const camera = h && h.camera;
    const THREE = h && h.THREE;

    // --- Instrument cluster zones (interior view only) ---
    const controller = h && h.controller;
    const cluster = controller && controller.instrumentCluster;
    const mesh = (controller && controller.clusterMesh) || (cluster && cluster.overlayMesh);
    if (camera && THREE && mesh && mesh.parent && mesh.visible !== false) {
      try {
        this._projectClusterZones(mesh, cluster, camera, THREE, vw, vh);
      } catch (_) {
        /* mesh/camera mid-rebuild — retry next tick */
      }
    }

    // --- Road-ahead look point ---
    if (camera && THREE) {
      try {
        this._projectRoadAhead(h, camera, THREE, vw, vh);
      } catch (_) {
        this._roadAhead = null;
      }
    }
    if (!this._roadAhead) {
      const f = FALLBACK_REGIONS.roadAhead;
      this._roadAhead = {
        rect: { x: f.x * vw, y: f.y * vh, w: f.w * vw, h: f.h * vh },
      };
    }
  }

  _projectClusterZones(mesh, cluster, camera, THREE, vw, vh) {
    const geo = mesh.geometry;
    const planeW = (geo && geo.parameters && geo.parameters.width) || 0.30;
    const planeH = (geo && geo.parameters && geo.parameters.height) || 0.093;
    const canvas = cluster && cluster.canvas;
    const cw = (canvas && canvas.width) || 1292;
    const chh = (canvas && canvas.height) || 400;

    // canvas-space zone rects, mirroring cluster/layout.js zonesForCanvas()
    const gaugeCy = chh * 0.46;
    const r = chh * 0.32;
    const pad = chh * 0.05;
    const canvasZones = [
      { aoi: AOI.SPEEDOMETER, x: cw * 0.225 - r - pad, y: gaugeCy - r - pad, w: 2 * (r + pad), h: 2 * (r + pad) },
      { aoi: AOI.THROTTLE_GAUGE, x: cw * 0.775 - r - pad, y: gaugeCy - r - pad, w: 2 * (r + pad), h: 2 * (r + pad) },
      { aoi: AOI.ROAD_WORM, x: cw * 0.5 - (chh * 0.62) / 2, y: chh * 0.03, w: chh * 0.62, h: chh * 0.45 },
      { aoi: AOI.ODOMETER, x: cw * 0.35, y: chh * 0.50, w: cw * 0.30, h: chh * 0.50 },
      { aoi: AOI.CLUSTER_OTHER, x: 0, y: 0, w: cw, h: chh },
    ];

    mesh.updateWorldMatrix(true, false);
    const v = new THREE.Vector3();
    const project = (cx, cy) => {
      // canvas px -> plane-local metres -> world -> NDC -> CSS px
      v.set((cx / cw - 0.5) * planeW, (0.5 - cy / chh) * planeH, 0);
      mesh.localToWorld(v);
      v.project(camera);
      if (v.z > 1) return null; // behind the camera
      return { x: ((v.x + 1) / 2) * vw, y: ((1 - v.y) / 2) * vh };
    };

    for (const z of canvasZones) {
      const corners = [
        project(z.x, z.y),
        project(z.x + z.w, z.y),
        project(z.x, z.y + z.h),
        project(z.x + z.w, z.y + z.h),
      ];
      if (corners.some((c) => !c)) continue;
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      this._zones.push({
        aoi: z.aoi,
        rect: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY },
      });
    }
  }

  _projectRoadAhead(h, camera, THREE, vw, vh) {
    const dist = GAZE_THRESHOLDS.ROAD_AHEAD_DISTANCE_M;
    const dir = new THREE.Vector3();
    const origin = new THREE.Vector3();
    const ego = h.ego;
    const vel = ego && ego.vel;
    if (vel && typeof vel.length === 'function' && vel.length() > 2) {
      dir.copy(vel).normalize();
      origin.copy(ego.position);
    } else {
      // stationary: look where the camera looks
      camera.getWorldDirection(dir);
      camera.getWorldPosition(origin);
    }
    const p = origin.clone().addScaledVector(dir, dist);
    p.y += 0.5; // roughly at road-surface eye line rather than under the car
    p.project(camera);
    if (p.z > 1) return;
    const cx = ((p.x + 1) / 2) * vw;
    const cy = ((1 - p.y) / 2) * vh;
    const fov = camera.fov || 60;
    const rPx = GAZE_THRESHOLDS.ROAD_AHEAD_RADIUS_DEG * pxPerDeg(vh, fov);
    if (!Number.isFinite(rPx) || rPx <= 0) return;
    this._roadAhead = { cx, cy, r: rPx };
  }

  /**
   * Classify one gaze sample. Priority: eyes-closed > invalid > off-screen >
   * DOM chrome > cluster zones > road-ahead > other-onscreen.
   * @returns {number} AOI code
   */
  classify(x, y, eyesClosed, valid) {
    if (eyesClosed) return AOI.EYES_CLOSED;
    if (!valid || !Number.isFinite(x) || !Number.isFinite(y)) return AOI.INVALID;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (x < 0 || y < 0 || x > vw || y > vh) return AOI.OFF_SCREEN;
    this._maybeProject();

    for (const z of this._zones) {
      const r = z.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return z.aoi;
    }
    const ra = this._roadAhead;
    if (ra) {
      if (ra.r != null) {
        if (Math.hypot(x - ra.cx, y - ra.cy) <= ra.r) return AOI.ROAD_AHEAD;
      } else if (ra.rect) {
        const r = ra.rect;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return AOI.ROAD_AHEAD;
      }
    }
    return AOI.OTHER_ONSCREEN;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
  }
}
