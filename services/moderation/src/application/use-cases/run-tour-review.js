// Use-case: tour.submitted -> save case -> geo rules + AI text check -> merge -> publish
// tour.ai_passed | tour.ai_rejected (task #AI-37). Uses only data inside the event.
//
// Same case flow as RunPlaceReview (review-case-flow.js): idempotent per (tour, tourId, revision), compare-and-set
// claims, sweeper retry / republish, execute() never throws.
//
// Check order:
//   1. Geo rules G1-G6 (domain/geo/tour-geo-rules.js, pure, no I/O) on type, durationMinutes and places.
//   2. One AI call: POST /moderate/tour (text only). Places are never sent to /moderate/place: their own
//      moderation already happened in the place flow.
//   3. mergeVerdicts([ai, geo]): worst verdict wins, max severity, reasons tagged source 'ai' | 'geo'.
//
// Decisions:
// - AI temporary failure (after retries, or 401): ai_failed, nothing published, even when geo found a G1 Reject.
//   One rule for every temporary failure; the sweeper retries and then publishes the merged result once.
// - AI permanent error (422): failed_permanent, geo findings merged with a human-review Warning reason
//   (a G1 Reject still wins).
// - tour.submitted keeps its content keys optional. Without `revision` there is no case key: logged and
//   skipped. With a revision but no title, language or places, the tour cannot be checked automatically:
//   a Warning with one human-review reason is published, without calling the AI.
// - Geo reasons with field `places[i]` (i = index after sorting by sequence) get " (placeId X)" appended to the
//   message so Tour can map them to a place; the domain messages stay unchanged.
import { MODERATION_EVENTS as EVENTS } from '../events.js';
import { SUBJECT, VERDICT } from '../../domain/entities/moderation-case.js';
import { mergeVerdicts } from '../../domain/moderation/merge-verdicts.js';
import { evaluateTourGeo, sortBySequence, DEFAULT_GEO_LIMITS } from '../../domain/geo/tour-geo-rules.js';
import {
  ReviewCaseFlow, toEventReasons, joinReasons, PERMANENT_ERROR_SEVERITY,
} from './review-case-flow.js';

export const TOUR_PERMANENT_ERROR_REASON = Object.freeze({
  field: 'description',
  category: 'other',
  message: 'Automatic check could not process this tour; needs human review.',
  source: 'ai',
});

export const TOUR_INCOMPLETE_REASON = Object.freeze({
  field: 'description',
  category: 'other',
  message: 'Tour data incomplete for automatic check; needs human review.',
  source: 'ai',
});

const PLACE_FIELD = /^places\[(\d+)\]$/;
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

/** True when the event carries what /moderate/tour needs (description and city are optional). */
export function isTourComplete(payload) {
  return isText(payload?.revision) && isText(payload?.title) && isText(payload?.language) && Array.isArray(payload?.places);
}

/** Appends " (placeId X)" to geo reasons whose field is places[i], i being the index after sorting by sequence. */
export function withPlaceIds(reasons, places) {
  const sorted = sortBySequence(Array.isArray(places) ? places : []);
  return reasons.map((r) => {
    const m = PLACE_FIELD.exec(r.field ?? '');
    const placeId = m ? sorted[Number(m[1])]?.placeId : undefined;
    return placeId ? { ...r, message: `${r.message} (placeId ${placeId})` } : r;
  });
}

// Recipient keys of tour.ai_passed / tour.ai_rejected (Notification), only when present in the input.
function recipientOf(payload) {
  const out = {};
  if (isText(payload?.contributorId)) out.contributorId = payload.contributorId;
  if (isText(payload?.title)) out.tourTitle = payload.title;
  return out;
}

/** Builds the result event from a stored case (done or failed_permanent). */
export function buildTourResultEvent(moderationCase, at) {
  const base = {
    tourId: moderationCase.subjectId,
    revision: moderationCase.revision,
    ...recipientOf(moderationCase.payload),
  };
  const reasons = toEventReasons(moderationCase.reasons ?? []);
  if (moderationCase.verdict === VERDICT.REJECT) {
    return {
      eventName: EVENTS.TOUR_AI_REJECTED,
      // `reason` stays a plain, non-empty string: Notification puts it in the email.
      payload: { ...base, reason: joinReasons(moderationCase.reasons ?? []), reasons, at },
    };
  }
  return {
    eventName: EVENTS.TOUR_AI_PASSED,
    payload: {
      ...base,
      warning: moderationCase.verdict === VERDICT.WARNING,
      severity: moderationCase.severity ?? 0,
      reasons,
      at,
    },
  };
}

export class RunTourReview extends ReviewCaseFlow {
  subjectType = SUBJECT.TOUR;

  label = 'tour';

  /**
   * @param {ConstructorParameters<typeof ReviewCaseFlow>[0] & { geoLimits?: typeof DEFAULT_GEO_LIMITS }} deps
   */
  constructor({ geoLimits = DEFAULT_GEO_LIMITS, ...deps }) {
    super(deps);
    this.geoLimits = geoLimits;
  }

  /** @param {object} payload a valid tour.submitted payload */
  async execute(payload) {
    if (!isText(payload?.revision)) {
      // No case key: Tour publishes the old event shape (feature flag off). Nothing to answer.
      this.logger.warn(`[moderation] tour ${this.tagOfPayload(payload)} has no revision, skipped`);
      return;
    }
    await super.execute(payload);
  }

  caseKey(payload) {
    return { subjectId: payload.tourId, tourId: payload.tourId, revision: payload.revision };
  }

  tagOfPayload(payload) {
    return `tourId=${payload?.tourId} revision=${payload?.revision}`;
  }

  tagOf(row) {
    return `tourId=${row?.subjectId} revision=${row?.revision}`;
  }

  async check(payload) {
    if (!isTourComplete(payload)) {
      this.logger.warn(`[moderation] tour ${this.tagOfPayload(payload)} incomplete, sent to human review without AI`);
      return { verdict: VERDICT.WARNING, severity: PERMANENT_ERROR_SEVERITY, reasons: [{ ...TOUR_INCOMPLETE_REASON }], model: null };
    }
    const geo = this.#geo(payload); // first: pure, no I/O
    const ai = await this.aiReviewer.reviewTour(payload);
    return { ...mergeVerdicts([{ ...ai, source: 'ai' }, geo]), model: ai.model ?? null };
  }

  permanentResult(payload) {
    const human = { verdict: VERDICT.WARNING, severity: PERMANENT_ERROR_SEVERITY, reasons: [{ ...TOUR_PERMANENT_ERROR_REASON }] };
    return mergeVerdicts([human, this.#geo(payload)]);
  }

  buildResultEvent(moderationCase, at) {
    return buildTourResultEvent(moderationCase, at);
  }

  #geo(payload) {
    const result = evaluateTourGeo(
      { type: payload?.type, durationMinutes: payload?.durationMinutes, places: payload?.places },
      this.geoLimits,
    );
    return { ...result, source: 'geo', reasons: withPlaceIds(result.reasons, payload?.places) };
  }
}
