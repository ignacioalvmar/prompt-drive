/**
 * Center-console constants: canvas geometry, theme, dock layout, storage keys
 * and the sample content (audio tracks, phone contacts, comfort zones) used by
 * the apps. Pure data — no DOM or engine access.
 */

// Dedicated screen canvas. 16:9, matching the 3D plane (SCREEN_PLANE below) so
// the texture maps 1:1 without stretching.
export const CONSOLE_CANVAS = {
  width: 1280,
  height: 720,
};

// 3D plane size in dashboard-local space (metres). 16:9 like the canvas.
export const SCREEN_PLANE = {
  width: 0.264,
  height: 0.1485,
};

// Black rim tightly framing the screen (metres beyond the screen on each side),
// and how deep the rim prism sinks toward the dash.
export const RIM = {
  bezel: 0.011,
  depth: 0.045,
  cornerRadius: 0.014,
  color: 0x0a0b0d,
};

// Lower app dock (canvas px).
export const DOCK = {
  height: 88,
  iconSize: 44,
  gap: 26,
};

// Split layout: primary pane takes 2/3 of the width, secondary 1/3.
export const SPLIT = {
  divider: 2,
  primaryFrac: 2 / 3,
};

export const CONSOLE_COLORS = {
  screenBg: '#0b0d10',
  panel: '#14171c',
  panelRaised: '#1c2027',
  panelSunken: '#08090b',
  divider: '#000000',
  text: '#f4f6f8',
  muted: 'rgba(188, 193, 200, 0.85)',
  faint: 'rgba(188, 193, 200, 0.4)',
  accent: '#40E0D0', // cluster cyan — keep the cockpit family consistent
  success: '#3ddc84', // cluster green
  danger: '#e5484d',
  warning: '#f5a623',
  dockBg: '#101318',
  dockActive: '#40E0D0',
  dockIdle: 'rgba(188, 193, 200, 0.7)',
  // Map app
  mapBg: '#0e1116',
  mapGrid: 'rgba(255, 255, 255, 0.045)',
  mapRoadCasing: '#05070a',
  mapRoad: '#39414c',
  mapRoadEdge: '#5a6470',
  mapCenterline: 'rgba(244, 246, 248, 0.55)',
  mapEgo: '#40E0D0',
  // Navigation app
  navBg: '#10141a',
  navRoad: '#232932',
  navShoulder: '#161a20',
  navLaneLine: 'rgba(226, 232, 238, 0.8)',
  navDivider: '#e8c14a',
  navEdgeLine: 'rgba(226, 232, 238, 0.95)',
  navEgo: '#2f9edb',
  navEgoTop: '#63bdf0',
  navActor: '#c8ced6',
  navActorTop: '#e8ecf1',
  navActorStopped: '#e5484d',
  navOncoming: '#a7742c',
};

export const CONSOLE_FONT = 'ShareTech, Arial, sans-serif';

// App ids in dock order.
export const APP_ORDER = ['map', 'nav', 'audio', 'phone', 'comfort'];

// localStorage keys (subsystem owns its persistence, like lanes/traffic/wheel).
export const CONSOLE_STORAGE = {
  ui: 'pd-console-ui', // { layout: 'full'|'split', primary, secondary }
  audio: 'pd-console-audio', // { track, volume }
  comfort: 'pd-console-comfort', // { zones: {...} }
};

// --- Audio sample library ----------------------------------------------------
// Tracks link the repo's own shipped media (offline-safe, no new assets).
// Titles/artists are fictional; covers are drawn procedurally from `hue`.
export const AUDIO_TRACKS = [
  {
    id: 'spring-meadows',
    title: 'Spring Meadows',
    artist: 'The Verge Markers',
    album: 'Open Roads',
    src: './static/media/ambiance_spring.791a03fe.mp3',
    hue: 145,
  },
  {
    id: 'summer-haze',
    title: 'Summer Haze',
    artist: 'Crossfade Fine',
    album: 'Golden Hour Drives',
    src: './static/media/ambiance_summer_low.0e101ef7.mp3',
    hue: 38,
  },
  {
    id: 'night-wind',
    title: 'Night Wind',
    artist: 'Topo Square',
    album: 'Offworld',
    src: './static/media/wind_02.deef0e2d.mp3',
    hue: 215,
  },
  {
    id: 'rolling-home',
    title: 'Rolling Home',
    artist: 'The Verge Markers',
    album: 'Open Roads',
    src: './static/media/rolling_06.ca3a3b85.mp3',
    hue: 285,
  },
];

// --- Phone sample agenda -------------------------------------------------------
export const PHONE_CONTACTS = [
  { name: 'Alex Meridian', phone: '+49 151 2340 001', hue: 205 },
  { name: 'Billie Coast', phone: '+49 151 2340 002', hue: 12 },
  { name: 'Chris Junction', phone: '+49 151 2340 003', hue: 268 },
  { name: 'Dana Hillcrest', phone: '+49 151 2340 004', hue: 96 },
  { name: 'Eli Overpass', phone: '+49 151 2340 005', hue: 330 },
  { name: 'Frankie Lane', phone: '+49 151 2340 006', hue: 176 },
  { name: 'Georgie Bypass', phone: '+49 151 2340 007', hue: 52 },
  { name: 'Harper Viaduct', phone: '+49 151 2340 008', hue: 232 },
  { name: 'Izzy Roundabout', phone: '+49 151 2340 009', hue: 145 },
  { name: 'Jules Milestone', phone: '+49 151 2340 010', hue: 305 },
];

// Ring/alert sound reuses a shipped asset at low volume.
export const PHONE_RINGTONE = './static/media/achievement.97104f4a.mp3';

// --- Comfort zones -------------------------------------------------------------
export const COMFORT_LIMITS = {
  tempMin: 16,
  tempMax: 28,
  fanMax: 5,
  seatHeatMax: 3,
};

export const COMFORT_ZONES = [
  { id: 'driver', label: 'Driver' },
  { id: 'passenger', label: 'Passenger' },
  { id: 'rear', label: 'Rear' },
];

export const COMFORT_DEFAULTS = {
  driver: { tempC: 21, fan: 2, seatHeat: 0 },
  passenger: { tempC: 21, fan: 2, seatHeat: 0 },
  rear: { tempC: 21, fan: 1, seatHeat: 0 },
  auto: true,
  sync: false,
};
