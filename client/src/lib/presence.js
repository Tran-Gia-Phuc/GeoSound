// =========================================================
// Presence of this browser for the admin online view (UC23 A5, #329), signed in or not.
//   beatPresence()    : POST /api/auth/presence { deviceId }, at most once per HEARTBEAT_MS unless
//                       forced. Signed in, the access token goes along and Auth touches the session.
//   leavePresence()   : the page is closed -> sendBeacon /api/auth/presence/leave (out at once).
//   setMediaPlaying() : audio players report playback, so a hidden tab (screen locked while a
//                       tour plays) keeps beating; SessionWatcher runs the timer.
// Best effort everywhere: a lost beat only makes the device look offline for a while.
// =========================================================
import { api } from './api.js';
import { getDeviceId } from './device-id.js';

export const HEARTBEAT_MS = 60_000;

const BASE = import.meta.env.VITE_API_BASE_URL || '';

let lastBeat = 0;
const playing = new Set();

/** @param {{ force?: boolean }} [opts] */
export function beatPresence({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastBeat < HEARTBEAT_MS - 1000) return;
  lastBeat = now;
  api.post('/api/auth/presence', { deviceId: getDeviceId() }, { auth: true }).catch(() => {});
}

export function leavePresence() {
  lastBeat = 0;
  try {
    // A string body is sent as text/plain: no CORS preflight to the gateway.
    navigator.sendBeacon?.(`${BASE}/api/auth/presence/leave`, JSON.stringify({ deviceId: getDeviceId() }));
  } catch {
    /* the device drops out after the online window anyway */
  }
}

/** @param {object} source one key per player @param {boolean} isPlaying */
export function setMediaPlaying(source, isPlaying) {
  if (isPlaying) playing.add(source);
  else playing.delete(source);
}

export function isMediaPlaying() {
  return playing.size > 0;
}
