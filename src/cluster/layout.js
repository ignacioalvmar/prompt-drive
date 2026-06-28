export const COLORS = {
  background: '#2a2a2e',
  bodyFill: '#1c1d1f',
  text: '#ffffff',
  muted: 'rgba(170, 170, 170, 0.6)',
  speedArc: '#40E0D0',
  throttleArc: '#3ddc84',
  arcTrack: 'rgba(255, 255, 255, 0.12)',
};

// Dedicated screen canvas (cluster UI only — not the full vehicle atlas).
export const SCREEN_CANVAS = {
  width: 680,
  height: 450,
};

// 3D plane size in body-local space (position derived from interior mesh bbox).
export const OVERLAY = {
  width: 0.42,
  height: 0.13,
};

export function zonesForCanvas(width, height) {
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
