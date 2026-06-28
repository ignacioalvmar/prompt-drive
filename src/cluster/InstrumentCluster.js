import { COLORS, SCREEN_CANVAS, OVERLAY, TOP_ARCH, zonesForCanvas } from './layout.js';
import { drawLightning, drawAutodriveIcon, drawRoadWorm } from './icons.js';

const DASHBOARD_MESH = 'z_dashboard_Cube.009';
const INTERIOR_MESH = 'z_interior_Cube.008';
// Dashboard (2) and steering wheel (3) use higher renderOrder in the game bundle.
// Match dashboard order; the overlay is added after the dash mesh so it draws on top of it.
const CLUSTER_RENDER_ORDER = 2;

// Draws a gauge: a full track arc, plus a coloured fill that grows from
// `fillAnchor` toward `fillTarget` as value goes 0→1.
function drawGauge(ctx, z, color, lineWidth, value) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(z.cx, z.cy, z.radius, z.trackStart, z.trackEnd);
  ctx.strokeStyle = COLORS.arcTrack;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  const v = Math.max(0, Math.min(1, value));
  if (v > 0.001) {
    const to = z.fillAnchor + (z.fillTarget - z.fillAnchor) * v;
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, z.radius, Math.min(z.fillAnchor, to), Math.max(z.fillAnchor, to));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

// Builds the rounded panel path with an arched top (higher in the centre).
function panelPath(ctx, width, height) {
  const arch = height * TOP_ARCH;
  const r = height * 0.13;
  ctx.beginPath();
  ctx.moveTo(0, arch);
  ctx.quadraticCurveTo(width / 2, -arch, width, arch); // arched top
  ctx.lineTo(width, height - r);
  ctx.arcTo(width, height, width - r, height, r);
  ctx.lineTo(r, height);
  ctx.arcTo(0, height, 0, height - r, r);
  ctx.closePath();
}

function drawClockPill(ctx, x, y, text, font, height) {
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const padX = height * 0.022;
  const pillH = Math.round(height * 0.052);
  const pillW = metrics.width + padX * 2;
  const pillX = x - pillW / 2;
  const pillY = y - pillH + height * 0.008;
  const r = pillH / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.moveTo(pillX + r, pillY);
  ctx.lineTo(pillX + pillW - r, pillY);
  ctx.arc(pillX + pillW - r, pillY + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(pillX + r, pillY + pillH);
  ctx.arc(pillX + r, pillY + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

const BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function findMeshBasicMaterial(THREE) {
  if (THREE.MeshBasicMaterial) return THREE.MeshBasicMaterial;
  if (THREE.C) return THREE.C;
  return null;
}

function findPlaneGeometry(THREE) {
  if (THREE.PlaneGeometry) return THREE.PlaneGeometry;
  if (THREE.J) return THREE.J;
  return null;
}

function findBufferGeometry(THREE) {
  if (THREE.BufferGeometry) return THREE.BufferGeometry;
  for (const k of Object.keys(THREE)) {
    const v = THREE[k];
    const p = v && v.prototype;
    if (p && typeof p.setAttribute === 'function' && typeof p.setIndex === 'function') return v;
  }
  return null;
}

function findBufferAttribute(THREE) {
  if (THREE.BufferAttribute) return THREE.BufferAttribute;
  for (const k of Object.keys(THREE)) {
    const v = THREE[k];
    const p = v && v.prototype;
    if (p && typeof p.setXYZ === 'function') return v;
  }
  return null;
}

// Extrudes a 2D outline (array of [x,y]) into a prism: front face fan, back
// face fan and side walls. Double-sided material, so winding is unimportant.
function buildPrismFromOutline(THREE, outline, depth) {
  const BufGeo = findBufferGeometry(THREE);
  const BufAttr = findBufferAttribute(THREE);
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
    idx.push(0, FR + i, FR + j); // front fan
    idx.push(1, BR + j, BR + i); // back fan
    idx.push(FR + i, FR + j, BR + j); // wall
    idx.push(FR + i, BR + j, BR + i);
  }
  const g = new BufGeo();
  g.setAttribute('position', new BufAttr(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The recessed cluster pod: a 3D prism whose front face is a rounded rectangle
// with an arched top (higher in the centre), matching the screen panel shape.
function makeArchedPrism(THREE, w, h, depth, radius, arch, seg = 6) {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(radius, hw, hh * 0.5);
  const topSideY = hh - arch;
  const outline = [];
  // Arched top: quadratic Bézier from (-hw, topSideY) → peak (0, hh) → (hw, topSideY).
  const aseg = seg * 2;
  for (let i = 0; i <= aseg; i++) {
    const t = i / aseg;
    const mt = 1 - t;
    const x = mt * mt * -hw + t * t * hw;
    const y = mt * mt * topSideY + 2 * mt * t * (hh + arch) + t * t * topSideY;
    outline.push([x, y]);
  }
  // Right edge down to the bottom-right corner.
  outline.push([hw, -hh + rr]);
  for (let i = 1; i <= seg; i++) {
    const a = -(i / seg) * (Math.PI / 2);
    outline.push([hw - rr + Math.cos(a) * rr, -hh + rr + Math.sin(a) * rr]);
  }
  // Bottom-left corner (the bottom edge is the segment between the corners).
  for (let i = 1; i <= seg; i++) {
    const a = -Math.PI / 2 - (i / seg) * (Math.PI / 2);
    outline.push([-hw + rr + Math.cos(a) * rr, -hh + rr + Math.sin(a) * rr]);
  }
  // The closing segment back to the first point forms the left edge.
  return buildPrismFromOutline(THREE, outline, depth);
}

function findMeshCtor(root, THREE) {
  let ctor = null;
  root?.traverse?.((child) => {
    if (!ctor && child?.isMesh) {
      ctor = child.constructor;
    }
  });
  return ctor || THREE.u || THREE.Mesh;
}

function createCanvasTexture(THREE, canvas) {
  if (THREE.CanvasTexture) {
    return new THREE.CanvasTexture(canvas);
  }

  for (const key of Object.keys(THREE)) {
    const val = THREE[key];
    if (typeof val === 'function' && val.prototype?.isTexture) {
      const tex = new val(canvas);
      tex.image = canvas;
      return tex;
    }
  }

  const LoaderCtor = THREE.U || THREE.TextureLoader;
  if (LoaderCtor) {
    const tempTex = new LoaderCtor().load(BLANK_PIXEL);
    const TextureCtor = tempTex.constructor;
    const texture = new TextureCtor(canvas);
    texture.image = canvas;
    tempTex.dispose();
    return texture;
  }

  throw new Error('InstrumentCluster: THREE.Texture constructor not found');
}

function configureTexture(texture, THREE) {
  texture.generateMipmaps = false;
  const linear = THREE.LinearFilter;
  if (linear !== undefined) {
    texture.minFilter = linear;
    texture.magFilter = linear;
  }
}

function findDashboardAnchor(root) {
  let mesh = null;
  let parent = null;
  root?.traverse?.((child) => {
    if (child?.isMesh && child.name === DASHBOARD_MESH) {
      mesh = child;
      parent = child.parent;
    }
  });
  return mesh && parent ? { mesh, parent } : null;
}

function findInteriorMesh(root) {
  let interior = null;
  root?.traverse?.((child) => {
    if (child?.isMesh && child.name === INTERIOR_MESH) interior = child;
  });
  return interior;
}

function dashboardRecessPlacement(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  return {
    width: OVERLAY.width,
    height: OVERLAY.height,
    x: bb.min.x + 0.012,
    // Sit slightly above the wheel hub (the wheel centre is ~0 in this frame),
    // centred in the inner ring so the rim frames the cluster.
    y: bb.min.y + (bb.max.y - bb.min.y) * 0.53,
    z: (bb.min.z + bb.max.z) * 0.5,
    rotY: -Math.PI / 2,
  };
}

function interiorRecessPlacement(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  return {
    width: OVERLAY.width,
    height: OVERLAY.height,
    x: bb.max.x - 0.02,
    y: bb.min.y + (bb.max.y - bb.min.y) * 0.55,
    z: (bb.min.z + bb.max.z) * 0.5,
    rotY: -Math.PI / 2,
  };
}

export class InstrumentCluster {
  constructor(THREE) {
    this.THREE = THREE;
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_CANVAS.width;
    this.canvas.height = SCREEN_CANVAS.height;
    this.ctx = this.canvas.getContext('2d');
    const MaterialCtor = findMeshBasicMaterial(THREE);
    if (!MaterialCtor) {
      throw new Error('InstrumentCluster: MeshBasicMaterial constructor not found');
    }
    this.texture = createCanvasTexture(THREE, this.canvas);
    configureTexture(this.texture, THREE);
    this.material = new MaterialCtor({
      map: this.texture,
      transparent: true, // rounded corners — outside the panel is transparent
      side: THREE.DoubleSide ?? 2,
      depthTest: true, // so the steering wheel occludes the cluster
      depthWrite: false,
      toneMapped: false,
    });
    // Dark backing that forms the recessed pod behind the screen.
    this.podMaterial = new MaterialCtor({
      color: 0x111316,
      side: THREE.DoubleSide ?? 2,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    this.podMesh = null;
    this.overlayMesh = null;
    this._overlayParent = null;
    this._interiorMesh = null;
    this._dashboardMesh = null;
    this._placementMode = null;
    InstrumentCluster.lastInstance = this;
    this._fontsReady = false;
    document.querySelector?.('.instrument-cluster-hud')?.remove();
    this._ensureFonts();
    this._ensureWormStyle();
    this.draw({
      speedKph: 0,
      speedLerp: 0,
      odometerKm: 0,
      throttle: 0,
      autodrive: false,
      driveMode: 'AWD',
      speedUnit: 'KPH',
      distUnit: 'KM',
      clock: new Date(),
    });
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

  // The road worm now lives in the cluster, so the on-screen HUD worm is hidden
  // while the cluster is active (first-person). `visibility: hidden` keeps the
  // SVG laid out so its geometry (getCTM/points) stays readable for the cluster.
  _ensureWormStyle() {
    if (this._wormStyleReady || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = `
      body.cluster-active #upcoming-container { visibility: hidden !important; }
    `;
    document.head.appendChild(style);
    this._wormStyleReady = true;
  }

  syncPlacement(_steeringPos, _sideSign = 1) {
    if (!this.overlayMesh || this._placementMode !== 'interior' || !this._interiorMesh?.geometry) {
      return;
    }
    const place = interiorRecessPlacement(this._interiorMesh.geometry);
    this.overlayMesh.position.set(place.x, place.y, place.z);
    this.overlayMesh.rotation.set(0, place.rotY, 0);
    const PlaneGeo = findPlaneGeometry(this.THREE);
    if (PlaneGeo) {
      this.overlayMesh.geometry.dispose();
      this.overlayMesh.geometry = new PlaneGeo(place.width, place.height);
    }
  }

  _resolveAnchor(root) {
    const dashboard = findDashboardAnchor(root);
    if (dashboard) {
      return {
        mode: 'dashboard',
        parent: dashboard.parent,
        geometry: dashboard.mesh.geometry,
        placement: dashboardRecessPlacement,
        // The original gray binnacle pod — hidden so the cluster screen reads
        // as a clean dark display instead of protruding from the recess.
        hideMesh: dashboard.mesh,
      };
    }

    const interior = findInteriorMesh(root);
    if (interior?.parent) {
      return {
        mode: 'interior',
        parent: interior.parent,
        geometry: interior.geometry,
        placement: interiorRecessPlacement,
      };
    }

    return null;
  }

  _ensureOverlay(root) {
    const anchor = this._resolveAnchor(root);
    if (!anchor) return false;

    this._hideMesh = anchor.hideMesh || null;

    if (
      this.overlayMesh &&
      this._overlayParent === anchor.parent &&
      this._placementMode === anchor.mode &&
      this.overlayMesh.parent === anchor.parent
    ) {
      this._dashboardMesh = anchor.mode === 'dashboard' ? anchor.geometry : null;
      this._interiorMesh = anchor.mode === 'interior' ? { geometry: anchor.geometry } : null;
      return true;
    }

    this._removeOverlay();

    const THREE = this.THREE;
    const PlaneGeo = findPlaneGeometry(THREE);
    const MeshCtor = findMeshCtor(root, THREE);
    if (!PlaneGeo || !MeshCtor) return false;

    const place = anchor.placement(anchor.geometry);

    // Recessed pod: a 3D prism with depth, rounded edges and an arched top,
    // matching the screen panel — a physical housing, not a floating texture.
    const podBezel = 0.018;
    const podW = place.width + podBezel * 2;
    const podH = place.height + podBezel * 2;
    const podArch = podH * TOP_ARCH;
    const podGeo =
      makeArchedPrism(THREE, podW, podH, 0.05, podH * 0.34, podArch, 6) ||
      new PlaneGeo(podW, podH);
    const pod = new MeshCtor(podGeo, this.podMaterial);
    pod.name = 'instrument_cluster_pod';
    // Front face sits just behind the screen (slightly away from the driver).
    pod.position.set(place.x + 0.002, place.y, place.z);
    pod.rotation.set(0, place.rotY, 0);
    pod.frustumCulled = false;
    pod.renderOrder = CLUSTER_RENDER_ORDER - 1;
    anchor.parent.add(pod);
    this.podMesh = pod;

    const plane = new MeshCtor(new PlaneGeo(place.width, place.height), this.material);
    plane.name = 'instrument_cluster_overlay';
    plane.position.set(place.x, place.y, place.z);
    plane.rotation.set(0, place.rotY, 0);
    plane.frustumCulled = false;
    plane.renderOrder = CLUSTER_RENDER_ORDER;
    anchor.parent.add(plane);

    this.overlayMesh = plane;
    this._overlayParent = anchor.parent;
    this._placementMode = anchor.mode;
    this._dashboardMesh = anchor.mode === 'dashboard' ? anchor.geometry : null;
    this._interiorMesh = anchor.mode === 'interior' ? { geometry: anchor.geometry } : null;
    return true;
  }

  _removeOverlay() {
    if (this.podMesh) {
      this.podMesh.parent?.remove(this.podMesh);
      this.podMesh.geometry?.dispose();
      this.podMesh = null;
    }
    if (!this.overlayMesh) return;
    this.overlayMesh.parent?.remove(this.overlayMesh);
    this.overlayMesh.geometry?.dispose();
    this.overlayMesh = null;
    this._overlayParent = null;
    this._interiorMesh = null;
    this._dashboardMesh = null;
    this._placementMode = null;
  }

  draw({
    speedKph = 0,
    speedLerp = 0,
    odometerKm = 0,
    throttle = 0,
    autodrive = false,
    driveMode = 'AWD',
    speedUnit = 'KPH',
    distUnit = 'KM',
    clock = new Date(),
  }) {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const zones = zonesForCanvas(width, height);
    const sr = zones.screen;

    // Dark panel with a rounded body and an arched top (higher in the centre).
    // Drawn on a transparent canvas so edges reveal the dark pod / dash behind.
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, COLORS.background);
    bg.addColorStop(1, COLORS.backgroundEdge);
    panelPath(ctx, width, height);
    ctx.fillStyle = bg;
    ctx.fill();

    const arcLine = zones.arcWidth;
    const speedZone = zones.speed;
    const throttleZone = zones.throttle;
    drawGauge(ctx, speedZone, COLORS.speedArc, arcLine, speedLerp);
    drawGauge(ctx, throttleZone, COLORS.throttleArc, arcLine, throttle);

    const cx = zones.center.x;
    const rows = zones.rows;

    // --- Left gauge: speed value centred inside the ring + unit below it ---
    const speedText = String(Math.round(speedKph));
    ctx.fillStyle = COLORS.text;
    ctx.font = zones.fonts.speedValue;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(speedText, speedZone.cx, speedZone.cy - height * 0.02);
    ctx.font = zones.fonts.speedUnit;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(speedUnit.toUpperCase(), speedZone.cx, speedZone.cy + height * 0.12);

    // --- Right gauge: power icon centred inside the ring ---
    drawLightning(ctx, throttleZone.cx, throttleZone.cy, zones.icons.lightning);

    // --- Road worm (live upcoming road geometry), top centre. Mirrors the
    // game HUD worm and its show/hide setting; draws nothing when the setting
    // hides it (so "Never" / autodrive truly show nothing here). ---
    this._wormView ||= {};
    drawRoadWorm(ctx, zones.worm, {
      backdrop: COLORS.wormBackdrop,
      casing: COLORS.wormCasing,
      road: COLORS.wormRoad,
      vehBodyLight: COLORS.vehBodyLight,
      vehBody: COLORS.vehBody,
      vehBodyDark: COLORS.vehBodyDark,
      vehGlass: COLORS.vehGlass,
      vehBumper: COLORS.vehBumper,
      vehTail: COLORS.vehTail,
      vehWheel: COLORS.vehWheel,
      vehEdge: COLORS.vehEdge,
    }, this._wormView);

    // --- Odometer: top edge aligned with the gauges' upper endpoints ---
    const odoText = String(Math.max(0, Math.floor(odometerKm))).padStart(5, '0');
    ctx.fillStyle = COLORS.text;
    ctx.font = zones.fonts.odometer;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(odoText, cx, zones.gaugeTopY);
    ctx.font = zones.fonts.odometerUnit;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(distUnit.toUpperCase(), cx, zones.gaugeTopY + height * 0.15);

    // --- Bottom status: autodrive icon + "AUTODRIVE" grouped on the right,
    // immediately to the left of the drive-mode (AWD) label, the whole group
    // centred under the right gauge. ---
    const statusY = rows.status;
    const adLabel = 'AUTODRIVE';
    const iconSize = zones.icons.autodrive;
    const gapIconLabel = iconSize * 0.45;
    const gapLabels = height * 0.05;
    ctx.textBaseline = 'middle';
    ctx.font = zones.fonts.modeLabel;
    const adW = ctx.measureText(adLabel).width;
    ctx.font = zones.fonts.driveMode;
    const dmW = ctx.measureText(driveMode).width;
    const totalW = iconSize + gapIconLabel + adW + gapLabels + dmW;
    let gx = throttleZone.cx - totalW / 2;
    drawAutodriveIcon(ctx, gx + iconSize / 2, statusY, iconSize, autodrive);
    gx += iconSize + gapIconLabel;
    ctx.textAlign = 'left';
    ctx.font = zones.fonts.modeLabel;
    ctx.fillStyle = autodrive ? COLORS.text : COLORS.muted;
    ctx.fillText(adLabel, gx, statusY);
    gx += adW + gapLabels;
    ctx.font = zones.fonts.driveMode;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(driveMode, gx, statusY);

    // --- Clock: lowest point, centred ---
    const timeStr = clock.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    drawClockPill(ctx, cx, rows.clock, timeStr, zones.fonts.clock, height);

    this.texture.needsUpdate = true;
  }

  applyToObject(root, active = true) {
    // Hide the on-screen HUD worm only while the cluster is actually shown
    // (first-person); restore it otherwise so the third-person view is unchanged.
    if (typeof document !== 'undefined') {
      document.body?.classList?.toggle('cluster-active', !!active);
    }
    if (!root) return null;

    const anchor = this._resolveAnchor(root);
    if (!anchor) {
      if (!active) {
        if (this.overlayMesh) this.overlayMesh.visible = false;
        return this.overlayMesh;
      }
      return null;
    }

    if (active) {
      if (!this._ensureOverlay(root)) return null;
      if (this.overlayMesh) this.overlayMesh.visible = true;
      if (this.podMesh) this.podMesh.visible = true;
      // Hide the gray binnacle pod while the cluster screen is shown.
      if (anchor.hideMesh) anchor.hideMesh.visible = false;
    } else {
      if (this.overlayMesh) this.overlayMesh.visible = false;
      if (this.podMesh) this.podMesh.visible = false;
      // Restore the original binnacle when the cluster screen is not shown.
      if (anchor.hideMesh) anchor.hideMesh.visible = true;
    }
    return this.overlayMesh;
  }

  dispose() {
    this._removeOverlay();
    this.texture.dispose();
    this.material.dispose();
  }
}
