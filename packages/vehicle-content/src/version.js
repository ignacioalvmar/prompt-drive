/**
 * Version constants of the shared contract. Every one of these is written into
 * the session header so a log can be replayed against the exact same rules.
 *
 * Versioning policy (contract spec, "Open decisions"): additive changes bump
 * the minor version; any change to existing behavior or thresholds bumps the
 * major version. Thresholds below are frozen within 1.x.
 */

export const PACKAGE_VERSION = '1.0.0';
export const SCHEMA_VERSION = '1.0';
export const TOOLS_VERSION = 'vehicle-tools/1.0';
export const SUPPORTED_TOOLS_VERSIONS = ['vehicle-tools/1.0'];
export const RESOLVER_VERSION = '1.0.0';

export const THRESHOLDS = Object.freeze({
  accept: 0.6, // entries below are not candidates
  ambiguityGap: 0.15, // top must lead the 2nd by this much for `ok`
  suggestion: 0.4, // near misses returned with not_found
  maxSuggestions: 3,
  alongRouteM: 300, // along_route corridor, network metres
  defaultRadiusM: 3000,
  defaultLimit: 5,
  maxLimit: 10,
  maxBrowseLimit: 50, // HMI-only empty-query paging
});

export const SCORES = Object.freeze({
  exact: 1.0,
  namePart: 0.9,
  tokenSet: 0.85,
  prefix: 0.75,
  phonetic: 0.7,
  fuzzyMin: 0.6,
  fuzzyMax: 0.8,
  category: 0.65,
});

export const POI_CATEGORIES = Object.freeze([
  'fuel', 'ev_charging', 'parking', 'restaurant', 'cafe', 'supermarket', 'pharmacy',
  'hospital', 'hotel', 'atm', 'car_service', 'landmark', 'home', 'work',
]);

export const MEDIA_TYPES = Object.freeze(['track', 'artist', 'album', 'playlist', 'station', 'podcast']);
export const MEDIA_BUCKETS = Object.freeze({
  track: 'tracks', artist: 'artists', album: 'albums', playlist: 'playlists', station: 'stations', podcast: 'podcasts',
});
export const NUMBER_TYPES = Object.freeze(['mobile', 'home', 'work', 'other']);
export const END_OUTCOMES = Object.freeze(['completed', 'not_possible', 'needs_user']);
export const SOURCES = Object.freeze(['agent', 'hmi_touch', 'hmi_voice']);
