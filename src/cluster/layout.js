export const COLORS = {
  background: '#34373c',
  backgroundEdge: '#26282c',
  trapezoid: '#2a2c30',
  bodyFill: '#1c1d1f',
  text: '#f4f6f8',
  muted: 'rgba(188, 193, 200, 0.85)',
  speedArc: '#40E0D0',
  throttleArc: '#3ddc84',
  arcTrack: 'rgba(255, 255, 255, 0.14)',
  // Live road-worm: a dark recessed backing (like the clock pill) with a bright
  // road line over a darker casing, mirroring the game HUD worm.
  wormBackdrop: 'rgba(0, 0, 0, 0.32)',
  wormCasing: 'rgba(8, 9, 11, 0.9)',
  wormRoad: 'rgba(236, 239, 244, 0.95)',
  // Ego-vehicle silhouette (chase-cam 3/4 rear view, shaded to read as 3D).
  vehBodyLight: '#f4f6f8',
  vehBody: '#dfe3e8',
  vehBodyDark: '#bcc2ca',
  vehGlass: '#2c3037',
  vehBumper: '#3a3e45',
  vehTail: '#5c2a2f',
  vehWheel: '#161719',
  vehEdge: 'rgba(0, 0, 0, 0.4)',
};

// Dedicated screen canvas (cluster UI only — not the full vehicle atlas).
// Aspect ratio MUST match the 3D plane below (0.42 / 0.13 = 3.2308) so the
// texture is not stretched when mapped onto the dashboard.
export const SCREEN_CANVAS = {
  width: 1292,
  height: 400,
};

// 3D plane size in body-local space.
export const OVERLAY = {
  width: 0.30,
  height: 0.093,
};

// How much the top edge arches up in the centre (fraction of canvas height).
// Used by both the canvas panel outline and the 3D pod outline.
export const TOP_ARCH = 0.21;

const deg = (d) => (d * Math.PI) / 180;

export function zonesForCanvas(width, height) {
  const sr = { x: 0, y: 0, w: width, h: height };
  const gaugeCy = height * 0.46;
  const arcRadius = height * 0.32;
  const arcWidth = Math.max(4, Math.round(height * 0.032));
  // Top edge of the odometer text — sits below the road worm, whose bottom
  // reaches the gauge-arc centre line (gaugeCy). Centred, lower in the panel.
  const gaugeTopY = height * 0.50;
  return {
    screen: sr,
    arcWidth,
    gaugeTopY,
    // Left gauge: a big arc from 7 o'clock, up the left side and over the top
    // to 3 o'clock. The cyan fill is anchored at 9 o'clock and grows UPWARD
    // (over the top) toward 3 o'clock as speed increases.
    speed: {
      cx: sr.w * 0.225,
      cy: gaugeCy,
      radius: arcRadius,
      trackStart: deg(120), // 7 o'clock
      trackEnd: deg(360), // 3 o'clock
      fillAnchor: deg(120), // 7 o'clock — start of the arc
      fillTarget: deg(360), // 3 o'clock (final)
    },
    // Right gauge: a big arc from 9 o'clock, over the top and down the right
    // side to 4 o'clock. The green fill grows from 9 o'clock clockwise toward
    // 4 o'clock as throttle increases.
    throttle: {
      cx: sr.w * 0.775,
      cy: gaugeCy,
      radius: arcRadius,
      trackStart: deg(180), // 9 o'clock
      trackEnd: deg(390), // 4 o'clock
      fillAnchor: deg(180), // 9 o'clock (initial)
      fillTarget: deg(390), // 4 o'clock (final)
    },
    center: {
      x: sr.w * 0.5,
    },
    // Road-worm display area: top-centre, in the clear column between the two
    // gauges and above the odometer. The live worm (160x120 viewBox) is
    // contain-fitted inside this box and clipped to it, so the geometry is
    // always fully visible without overlapping the gauges or leaving the panel.
    // Left gauge reaches x≈cx-r+r = 0.225w+0.32h and the right gauge starts at
    // 0.775w-0.32h; maxW stays inside that gap with margin.
    worm: {
      cx: sr.w * 0.5,
      top: height * 0.03,
      // Recessed display box (portrait-ish) that frames the upward road. Width
      // stays well inside the gap between the gauges; height stops above the
      // odometer.
      maxW: height * 0.62,
      maxH: height * 0.45,
    },
    rows: {
      autodriveIcon: height * 0.70,
      status: height * 0.84, // AUTODRIVE + AWD, below the gauges
      clock: height * 0.95, // lowest point, centred
    },
    fonts: {
      speedValue: `600 ${Math.round(height * 0.24)}px ShareTech, Arial, sans-serif`,
      speedUnit: `400 ${Math.round(height * 0.088)}px ShareTech, Arial, sans-serif`,
      odometer: `400 ${Math.round(height * 0.125)}px ShareTech, Arial, sans-serif`,
      odometerUnit: `400 ${Math.round(height * 0.075)}px ShareTech, Arial, sans-serif`,
      modeLabel: `400 ${Math.round(height * 0.070)}px ShareTech, Arial, sans-serif`,
      driveMode: `400 ${Math.round(height * 0.072)}px ShareTech, Arial, sans-serif`,
      clock: `400 ${Math.round(height * 0.098)}px ShareTech, Arial, sans-serif`,
    },
    icons: {
      lightning: Math.round(height * 0.18),
      autodrive: Math.round(height * 0.13),
    },
  };
}
