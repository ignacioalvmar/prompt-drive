/* Instrument cluster — built from src/cluster/ */
(function () {
const COLORS = {
  background: '#2a2a2e',
  bodyFill: '#1c1d1f',
  text: '#ffffff',
  muted: 'rgba(170, 170, 170, 0.6)',
  speedArc: '#40E0D0',
  throttleArc: '#3ddc84',
  arcTrack: 'rgba(255, 255, 255, 0.12)',
};

// Dedicated screen canvas (cluster UI only — not the full vehicle atlas).
const SCREEN_CANVAS = {
  width: 680,
  height: 450,
};

// 3D plane size in body-local space (position derived from interior mesh bbox).
const OVERLAY = {
  width: 0.42,
  height: 0.13,
};

function zonesForCanvas(width, height) {
  const sr = { x: 0, y: 0, w: width, h: height };
  const midY = height * 0.48;
  const arcRadius = height * 0.38;
  return {
    screen: sr,
    speed: {
      cx: sr.w * 0.24,
      cy: midY,
      radius: arcRadius,
      start: (200 * Math.PI) / 180,
      end: (340 * Math.PI) / 180,
    },
    throttle: {
      cx: sr.w * 0.76,
      cy: midY,
      radius: arcRadius,
      start: (20 * Math.PI) / 180,
      end: (160 * Math.PI) / 180,
    },
    center: {
      x: sr.w * 0.5,
      y: midY,
    },
    clock: {
      y: height * 0.88,
    },
    fonts: {
      speedValue: `600 ${Math.max(24, Math.round(height * 0.20))}px ShareTech, Arial, sans-serif`,
      speedUnit: `400 ${Math.max(9, Math.round(height * 0.032))}px ShareTech, Arial, sans-serif`,
      odometer: `400 ${Math.max(10, Math.round(height * 0.055))}px ShareTech, Arial, sans-serif`,
      odometerUnit: `400 ${Math.max(8, Math.round(height * 0.028))}px ShareTech, Arial, sans-serif`,
      modeLabel: `400 ${Math.max(7, Math.round(height * 0.024))}px ShareTech, Arial, sans-serif`,
      driveMode: `400 ${Math.max(7, Math.round(height * 0.022))}px ShareTech, Arial, sans-serif`,
      clock: `400 ${Math.max(9, Math.round(height * 0.032))}px ShareTech, Arial, sans-serif`,
    },
    icons: {
      lightning: Math.max(12, Math.round(height * 0.045)),
      autodrive: Math.max(10, Math.round(height * 0.038)),
    },
  };
}

function drawLightning(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const s = size / 24;
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.moveTo(4, 0);
  ctx.lineTo(-2, 13);
  ctx.lineTo(6, 13);
  ctx.lineTo(2, 24);
  ctx.lineTo(14, 9);
  ctx.lineTo(7, 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAutodriveIcon(ctx, x, y, size, active) {
  ctx.save();
  ctx.globalAlpha = active ? 1 : 0.3;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  const s = size / 24;
  ctx.translate(x, y);
  ctx.scale(s, s);

  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(12, 4 - i * 3, 4 + i * 3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(5, 18);
  ctx.lineTo(5, 14);
  ctx.quadraticCurveTo(5, 10, 12, 10);
  ctx.quadraticCurveTo(19, 10, 19, 14);
  ctx.lineTo(19, 18);
  ctx.lineTo(16, 18);
  ctx.lineTo(16, 15);
  ctx.lineTo(8, 15);
  ctx.lineTo(8, 18);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}



const DASHBOARD_MESH = 'z_dashboard_Cube.009';
const INTERIOR_MESH = 'z_interior_Cube.008';
// Dashboard (2) and steering wheel (3) use higher renderOrder in the game bundle.
// Match dashboard order; the overlay is added after the dash mesh so it draws on top of it.
const CLUSTER_RENDER_ORDER = 2;

function drawArc(ctx, cx, cy, radius, start, end, color, lineWidth, progress = 1) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.strokeStyle = COLORS.arcTrack;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  if (progress > 0.001) {
    const sweep = (end - start) * Math.min(1, progress);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function drawNeedle(ctx, x, y, speedLerp, lineWidth = 2) {
  const tilt = (speedLerp - 0.5) * 0.25;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, lineWidth);
  ctx.lineTo(0, -lineWidth * 6);
  ctx.stroke();
  ctx.restore();
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
    y: bb.min.y + (bb.max.y - bb.min.y) * 0.62,
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

class InstrumentCluster {
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
      side: THREE.DoubleSide ?? 2,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.overlayMesh = null;
    this._overlayParent = null;
    this._interiorMesh = null;
    this._dashboardMesh = null;
    this._placementMode = null;
    InstrumentCluster.lastInstance = this;
    this._fontsReady = false;
    document.querySelector?.('.instrument-cluster-hud')?.remove();
    this._ensureFonts();
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

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    const arcLine = Math.max(2, height * 0.007);

    const speedZone = zones.speed;
    drawArc(
      ctx,
      speedZone.cx,
      speedZone.cy,
      speedZone.radius,
      speedZone.start,
      speedZone.end,
      COLORS.speedArc,
      arcLine,
      speedLerp,
    );

    const throttleZone = zones.throttle;
    drawArc(
      ctx,
      throttleZone.cx,
      throttleZone.cy,
      throttleZone.radius,
      throttleZone.start,
      throttleZone.end,
      COLORS.throttleArc,
      arcLine,
      throttle,
    );

    const speedText = String(Math.round(speedKph));
    ctx.fillStyle = COLORS.text;
    ctx.font = zones.fonts.speedValue;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(speedText, speedZone.cx, speedZone.cy - height * 0.03);
    ctx.font = zones.fonts.speedUnit;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(speedUnit.toUpperCase(), speedZone.cx, speedZone.cy + height * 0.12);

    drawNeedle(
      ctx,
      zones.center.x,
      zones.center.y - height * 0.1,
      speedLerp,
      Math.max(1.5, height * 0.006),
    );

    const odoText = String(Math.max(0, Math.floor(odometerKm))).padStart(5, '0');
    ctx.fillStyle = COLORS.text;
    ctx.font = zones.fonts.odometer;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(odoText, zones.center.x, zones.center.y + height * 0.02);
    ctx.font = zones.fonts.odometerUnit;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(distUnit.toUpperCase(), zones.center.x, zones.center.y + height * 0.08);

    const iconSize = zones.icons.lightning;
    drawLightning(
      ctx,
      throttleZone.cx + throttleZone.radius * 0.12,
      throttleZone.cy - height * 0.04,
      iconSize,
    );
    drawAutodriveIcon(
      ctx,
      throttleZone.cx,
      throttleZone.cy + height * 0.12,
      zones.icons.autodrive,
      autodrive,
    );
    ctx.font = zones.fonts.modeLabel;
    ctx.fillStyle = autodrive ? COLORS.text : COLORS.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AUTODRIVE', throttleZone.cx, throttleZone.cy + height * 0.22);
    ctx.font = zones.fonts.driveMode;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(driveMode, sr.w * 0.92, sr.h * 0.9);

    const timeStr = clock.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    drawClockPill(ctx, zones.center.x, zones.clock.y, timeStr, zones.fonts.clock, height);
    this.texture.needsUpdate = true;
  }

  applyToObject(root, active = true) {
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
    } else if (this.overlayMesh) {
      this.overlayMesh.visible = false;
    }
    return this.overlayMesh;
  }

  dispose() {
    this._removeOverlay();
    this.texture.dispose();
    this.material.dispose();
  }
}

  if (typeof window !== 'undefined') {
    window.InstrumentCluster = InstrumentCluster;
  }
})();
