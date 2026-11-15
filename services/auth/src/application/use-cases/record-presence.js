// =========================================================
// #329 — presence of every visitor, signed in or not, for the admin online view.
//   RecordPresence : a beat from a device (page open and visible, or audio playing). With a valid
//                    token the session is touched too, like the #265 heartbeat.
//   LeavePresence  : the page was closed (sendBeacon): the device leaves the online set at once.
// Presence is best effort: a Redis failure never fails the request (the device just looks offline).
// =========================================================

export class RecordPresence {
  /**
   * @param {{ presence: import('../../domain/ports/index.js').PresenceStore,
   *           sessionHeartbeat?: import('./session-heartbeat.js').SessionHeartbeat|null,
   *           now?: () => Date, logger?: Console }} deps
   */
  constructor({ presence, sessionHeartbeat = null, now, logger }) {
    this.presence = presence;
    this.sessionHeartbeat = sessionHeartbeat;
    this.now = now ?? (() => new Date());
    this.logger = logger ?? console;
    this.warned = false;
  }

  /** @param {{ deviceId: string, currentSid?: string|null }} input @returns {Promise<{ recorded: boolean, touched: boolean }>} */
  async execute({ deviceId, currentSid = null }) {
    let recorded = false;
    try {
      await this.presence.touch(deviceId, this.now());
      recorded = true;
      this.warned = false;
    } catch (err) {
      // Logged once per outage, not once per beat.
      if (!this.warned) this.logger.warn(`[auth] presence not recorded: ${err.message}`);
      this.warned = true;
    }
    const touched =
      currentSid && this.sessionHeartbeat ? (await this.sessionHeartbeat.execute({ currentSid })).touched : false;
    return { recorded, touched };
  }
}

export class LeavePresence {
  /** @param {{ presence: import('../../domain/ports/index.js').PresenceStore }} deps */
  constructor({ presence }) {
    this.presence = presence;
  }

  /** @param {{ deviceId: string }} input @returns {Promise<{ left: boolean }>} */
  async execute({ deviceId }) {
    try {
      await this.presence.leave(deviceId);
      return { left: true };
    } catch {
      return { left: false }; // the device drops out when its last beat is older than the window
    }
  }
}
