// =========================================================
// UC07 / UC08 — offline package of the owner's itinerary (same shape as the UC03 tour package):
//   GET /api/itineraries/:id/package?lang=xx -> { tourId, itineraryId, kind, language, revision, detail, assets }
//   - detail   = buildItineraryView (the view the UC08 player uses), audio that is not a file nulled
//   - assets   = images and recorded audio of the snapshot items (buildPackageAssets of UC03)
//   - revision = newest of the itinerary updatedAt and the items createdAt (ISO)
// Only the owner (loadOwnedItinerary: 404 otherwise). Language not offered by any item -> 400.
// UC25 (#446): items of a paid tour the owner neither wrote nor bought -> 402 payment_required.
// =========================================================
import { loadOwnedItinerary } from './load-owned-itinerary.js';
import { buildItineraryView } from './build-itinerary-view.js';
import { buildPackageAssets, LanguageNotAvailableError } from './get-tour-package.js';
import { PaymentRequiredError } from '../../domain/errors/index.js';

function latest(dates) {
  let max = 0;
  for (const d of dates) {
    const t = d ? new Date(d).getTime() : NaN;
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max ? new Date(max).toISOString() : null;
}

export class GetItineraryPackage {
  /** @param {{ itineraryRepo, purchaseRepo? }} deps */
  constructor({ itineraryRepo, purchaseRepo = null }) {
    this.itineraryRepo = itineraryRepo;
    this.purchaseRepo = purchaseRepo;
  }

  /** @param {{ ownerId: string, itineraryId: string, lang?: string }} input */
  async execute({ ownerId, itineraryId, lang }) {
    const itinerary = await loadOwnedItinerary(this.itineraryRepo, { ownerId, itineraryId });
    if (this.purchaseRepo) {
      const tourIds = [...new Set(itinerary.items.map((it) => it.tourId))];
      const locked = await this.purchaseRepo.lockedTourIds(ownerId, tourIds);
      if (locked.length) {
        throw new PaymentRequiredError('Lịch trình có điểm thuộc tour có phí bạn chưa mua; hãy mua tour đó trước khi tải về');
      }
    }
    const view = buildItineraryView({ itinerary, lang });
    if (lang && view.selectedLanguage !== lang) throw new LanguageNotAvailableError();
    const { detail, assets } = buildPackageAssets(view);
    return {
      tourId: itinerary.id, // package owner id on the device (the client prefixes it)
      itineraryId: itinerary.id,
      kind: 'itinerary',
      language: view.selectedLanguage,
      revision: latest([itinerary.updatedAt, ...itinerary.items.map((it) => it.createdAt)]),
      detail,
      assets,
    };
  }
}
