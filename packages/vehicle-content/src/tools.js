/**
 * vehicle-tools/1.0 — the frozen set of 12 functions (contract spec, "v1.0
 * API"). One JSON Schema per function is the single source of truth; provider
 * formats (OpenAI-compatible `tools`, Gemini function declarations) are
 * generated from it (adapters.js) and checked for drift by the test suite.
 *
 * Names, parameter names AND descriptions are part of the frozen version:
 * changing a description changes agent behavior, so it requires a version bump.
 */

import { POI_CATEGORIES, MEDIA_TYPES, NUMBER_TYPES, END_OUTCOMES, TOOLS_VERSION, THRESHOLDS } from './version.js';

const id = (what) => ({ type: 'string', description: `ID of the ${what}, as returned by a search function.` });

export const TOOL_SCHEMAS = [
  {
    name: 'search_contacts',
    domain: 'phone',
    kind: 'lookup',
    description: 'Search the driver\'s phone contacts by name, nickname or relationship (e.g. "Pipe", "my brother"). Returns candidates with IDs and the number types each contact has. Does not call anyone.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Name, nickname or relationship as the driver said it.' },
        filter: {
          type: 'object',
          description: 'Optional filters applied before matching.',
          properties: {
            relationship: { type: 'string', description: 'Relationship, e.g. "brother", "mother", "boss".' },
            tag: { type: 'string', description: 'Contact tag, e.g. "family" or "work".' },
            favorite: { type: 'boolean', description: 'Only favorites when true.' },
          },
          additionalProperties: false,
        },
        limit: { type: 'integer', minimum: 1, maximum: THRESHOLDS.maxLimit, description: 'Maximum candidates to return (default 5, max 10).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_contact',
    domain: 'phone',
    kind: 'lookup',
    description: 'Get the full record of one contact by ID, including its phone number types.',
    parameters: {
      type: 'object',
      properties: { contact_id: id('contact') },
      required: ['contact_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'call_contact',
    domain: 'phone',
    kind: 'action',
    description: 'Start a phone call to a contact by ID. Resolve the contact with search_contacts first. If number_type is omitted the contact\'s default number is used.',
    parameters: {
      type: 'object',
      properties: {
        contact_id: id('contact'),
        number_type: { type: 'string', enum: NUMBER_TYPES.slice(), description: 'Which of the contact\'s numbers to call.' },
      },
      required: ['contact_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_message',
    domain: 'phone',
    kind: 'action',
    description: 'Send a text message to a contact by ID. Resolve the contact with search_contacts first.',
    parameters: {
      type: 'object',
      properties: {
        contact_id: id('contact'),
        text: { type: 'string', minLength: 1, description: 'Message text, as dictated by the driver.' },
        number_type: { type: 'string', enum: NUMBER_TYPES.slice(), description: 'Which of the contact\'s numbers to use (default: mobile, else the default number).' },
      },
      required: ['contact_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_media',
    domain: 'media',
    kind: 'lookup',
    description: 'Search the car\'s media library (songs, artists, albums, playlists, radio stations, podcasts) by title, name, frequency or genre. Returns candidates with IDs. Does not play anything.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Title, artist, station name or frequency, or genre as the driver said it.' },
        types: {
          type: 'array',
          items: { type: 'string', enum: MEDIA_TYPES.slice() },
          description: 'Restrict to these media types, in order of preference.',
        },
        limit: { type: 'integer', minimum: 1, maximum: THRESHOLDS.maxLimit, description: 'Maximum candidates to return (default 5, max 10).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'play_media',
    domain: 'media',
    kind: 'action',
    description: 'Play a media item by ID (track, artist, album, playlist, station or podcast). Resolve the item with search_media first.',
    parameters: {
      type: 'object',
      properties: {
        item_id: id('media item'),
        options: {
          type: 'object',
          properties: { shuffle: { type: 'boolean', description: 'Shuffle the items of an artist, album or playlist.' } },
          additionalProperties: false,
        },
      },
      required: ['item_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_playback_state',
    domain: 'media',
    kind: 'lookup',
    description: 'Get what is currently playing, if anything.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_poi',
    domain: 'navigation',
    kind: 'lookup',
    description: 'Search points of interest (places) by name, brand or category, near the vehicle, along the active route, or near the destination. Needs at least one of query or category. Returns candidates with IDs, network distance in meters and whether they are open now.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Place name, brand or kind of place as the driver said it.' },
        category: { type: 'string', enum: POI_CATEGORIES.slice(), description: 'Restrict to one place category.' },
        scope: {
          type: 'string',
          enum: ['near_vehicle', 'along_route', 'near_destination'],
          description: 'Where to search (default near_vehicle). along_route and near_destination need an active route.',
        },
        radius_m: { type: 'number', exclusiveMinimum: 0, description: 'Search radius in meters along the road network (default 3000).' },
        open_now: { type: 'boolean', description: 'Only places that are open now.' },
        limit: { type: 'integer', minimum: 1, maximum: THRESHOLDS.maxLimit, description: 'Maximum candidates to return (default 5, max 10).' },
      },
      anyOf: [{ required: ['query'] }, { required: ['category'] }],
      additionalProperties: false,
    },
  },
  {
    name: 'get_poi',
    domain: 'navigation',
    kind: 'lookup',
    description: 'Get the full record of one point of interest by ID, including opening hours and attributes.',
    parameters: {
      type: 'object',
      properties: { poi_id: id('point of interest') },
      required: ['poi_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'navigate_to',
    domain: 'navigation',
    kind: 'action',
    description: 'Start route guidance to a point of interest by ID, replacing any active route. Resolve the place with search_poi first.',
    parameters: {
      type: 'object',
      properties: { poi_id: id('point of interest') },
      required: ['poi_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_waypoint',
    domain: 'navigation',
    kind: 'action',
    description: 'Add a stop at a point of interest (by ID) to the active route, before the destination. Fails with no_route when no route is active.',
    parameters: {
      type: 'object',
      properties: { poi_id: id('point of interest') },
      required: ['poi_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'end_task',
    domain: 'session',
    kind: 'session',
    description: 'End the current task. Use completed when the request was carried out, not_possible when it cannot be fulfilled (for example the contact, item or place does not exist), and needs_user when you hand control back to the driver.',
    parameters: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: END_OUTCOMES.slice(), description: 'How the task ended.' },
        reason: { type: 'string', description: 'Short reason, e.g. "No contact named Camila".' },
      },
      required: ['outcome'],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.name);

export function toolSchema(name) {
  return TOOL_SCHEMAS.find((t) => t.name === name) || null;
}

/**
 * The fixed, versioned system-prompt block describing the tool contract
 * (PromptDrive spec, "System prompt"). Logged by version in the header.
 */
export const SYSTEM_PROMPT_VERSION = TOOLS_VERSION + '#prompt-1';
export const SYSTEM_PROMPT_BLOCK = [
  `Vehicle tools (${TOOLS_VERSION}):`,
  '- The car\'s contacts, media and places are only reachable through these tools. Never invent IDs, names, numbers or places.',
  '- Search first, then act: call_contact, send_message, play_media, navigate_to and add_waypoint take IDs only, from a search result.',
  '- status "ok": act on the returned candidate.',
  '- status "ambiguous": several entries match equally well. Ask the driver which one they mean; do not pick one yourself.',
  '- status "not_found": nothing matches. Tell the driver it is not available. Suggestions are only near misses; confirm with the driver before using one.',
  '- status "invalid_argument": your call was malformed; fix the arguments.',
  '- An action that returns status "error" did not happen; tell the driver (error_code says why).',
  '- Call end_task when the request is done (completed), cannot be fulfilled (not_possible), or you hand back to the driver (needs_user).',
].join('\n');
