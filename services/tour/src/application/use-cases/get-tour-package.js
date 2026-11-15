// =========================================================
// UC03 (offline download, #103) — package manifest of a PUBLIC tour for one language.
//   GET /api/tours/:id/package?lang=xx -> { tourId, language, revision, detail, assets }
//   - detail   = the same view the player uses (buildTourDetailView), so the client plays a stored
//                package with the normal UC04 player. Audio that is not a downloadable file (null,
//                placeholder 'tts://...') becomes null: the device voice reads the text offline.
//   - assets   = every file the package needs (cover, place images, audio of this language, route
//                audio), deduplicated by URL. URLs stay as stored (absolute media URLs); the client
//                rewrites local gateway URLs like every other response.
//   - revision = newest updatedAt of the tour, its places, route config and translations (ISO):
//                the library shows "Có bản mới" when the server revision is newer.
// No sizes here: Tour does not know file sizes; the client measures the real bytes.
// Not public (draft / hidden / restricted / deleted) -> 404. Language not ready -> 400.
// =========================================================
import { TourNotFoundError, AppError } from '../../domain/errors/index.js';
import { buildTourDetailView } from './build-tour-detail.js';

export class LanguageNotAvailableError extends AppError {
  constructor(message = 'Ngôn ngữ này chưa sẵn sàng để tải') {
    super(message, { status: 400, code: 'language_not_available' });
  }
}

/** A URL the device can download and keep: http(s) or same-origin path. */
export function isDownloadableUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function latestRevision(items) {
  let max = 0;
  for (const item of items) {
    const t = item?.updatedAt ? new Date(item.updatedAt).getTime() : NaN;
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max ? new Date(max).toISOString() : null;
}

/**
 * Pure: detail view -> { detail (non-file audio nulled), assets[] }.
 * @param {object} view buildTourDetailView result
 */
export function buildPackageAssets(view) {
  const assets = [];
  const seen = new Set();
  const add = (url, kind, placeId) => {
    if (!isDownloadableUrl(url) || seen.has(url)) return;
    seen.add(url);
    assets.push(placeId ? { url, kind, placeId } : { url, kind });
  };
  const audioOrNull = (url) => (isDownloadableUrl(url) ? url : null);

  add(view.coverImageUrl, 'image');
  const places = (view.places ?? []).map((p) => {
    for (const img of p.images ?? []) add(typeof img === 'string' ? img : img?.url, 'image', p.id);
    const audioUrl = audioOrNull(p.audioUrl);
    if (audioUrl) add(audioUrl, 'audio', p.id);
    return { ...p, audioUrl };
  });
  const route = view.route ?? { path: [], triggers: [], navAudios: [] };
  const navAudios = (route.navAudios ?? []).map((n) => {
    const audioUrl = audioOrNull(n.audioUrl);
    if (audioUrl) add(audioUrl, 'audio');
    return { ...n, audioUrl };
  });
  const triggers = (route.triggers ?? []).map((t) => {
    if (!t?.nextHint || t.nextHint.audioUrl === undefined) return t;
    const audioUrl = audioOrNull(t.nextHint.audioUrl);
    if (audioUrl) add(audioUrl, 'audio', t.placeId);
    return { ...t, nextHint: { ...t.nextHint, audioUrl } };
  });
  return { detail: { ...view, places, route: { ...route, navAudios, triggers } }, assets };
}

export class GetTourPackage {
  /** @param {{ tourRepo, placeRepo, routeConfigRepo, tourLanguageRepo?, placeTranslationRepo? }} deps */
  constructor({ tourRepo, placeRepo, routeConfigRepo, tourLanguageRepo, placeTranslationRepo }) {
    this.tourRepo = tourRepo;
    this.placeRepo = placeRepo;
    this.routeConfigRepo = routeConfigRepo;
    this.tourLanguageRepo = tourLanguageRepo;
    this.placeTranslationRepo = placeTranslationRepo;
  }

  /** @param {{ id: string, lang?: string }} input */
  async execute({ id, lang }) {
    const tour = await this.tourRepo.findPublicById(id);
    if (!tour) throw new TourNotFoundError('Tour không còn khả dụng');
    return buildTourPackage(this, tour, lang);
  }
}

/**
 * Package of an already authorised tour (public in UC03, unlocked restricted tour in UC14).
 * @param {{ placeRepo, routeConfigRepo, tourLanguageRepo?, placeTranslationRepo? }} repos
 * @param {object} tour @param {string} [lang]
 */
export async function buildTourPackage(repos, tour, lang) {
  const id = tour.id;
  const [places, routeCfg, langs, translations] = await Promise.all([
    repos.placeRepo.listByTour(id),
    repos.routeConfigRepo.findByTour(id),
    repos.tourLanguageRepo?.listByTour(id) ?? [],
    repos.placeTranslationRepo?.listByTour(id) ?? [],
  ]);
  const view = buildTourDetailView({ tour, places, route: routeCfg, langs, translations, lang });
  // The detail falls back to the source language; a package must be exactly the chosen one.
  if (lang && view.selectedLanguage !== lang) throw new LanguageNotAvailableError();

  const language = view.selectedLanguage;
  const { detail, assets } = buildPackageAssets(view);
  const revision = latestRevision([
    tour,
    routeCfg,
    ...places,
    ...translations.filter((t) => t.languageCode === language),
  ]);
  return { tourId: id, language, revision, detail, assets };
}
