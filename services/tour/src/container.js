// =========================================================
// Composition Root (tour) — ráp (wire) các tầng tại MỘT chỗ duy nhất.
// DI thủ công: infrastructure (impl ports) → use-case → controller.
//
//   domain         : KHÔNG import gì ở đây (lõi, thuần JS)
//   application     : use-case nhận ports qua constructor
//   infrastructure  : implement ports (Prisma + PostGIS / Redis cache)
//   interfaces/http : controller gọi use-case
//
// Tour dùng PostGIS nhiều nhất: query không gian nằm trong
// infrastructure/persistence (repository), KHÔNG rò rỉ ra domain.
// Nhờ chỗ này, test use-case bằng fake ports trong RAM (không cần DB).
// =========================================================
import crypto from 'node:crypto';
import { prisma } from './infrastructure/persistence/prisma-client.js';
import { PrismaTourRepository } from './infrastructure/persistence/prisma-tour-repository.js';
import { PrismaPlaceRepository } from './infrastructure/persistence/prisma-place-repository.js';
import { PrismaItineraryRepository } from './infrastructure/persistence/prisma-itinerary-repository.js';
import { PrismaForbiddenZoneRepository } from './infrastructure/persistence/prisma-forbidden-zone-repository.js';
import { PrismaRouteConfigRepository } from './infrastructure/persistence/prisma-route-config-repository.js';
import { PrismaTourLanguageRepository } from './infrastructure/persistence/prisma-tour-language-repository.js';
import { PrismaPlaceTranslationRepository } from './infrastructure/persistence/prisma-place-translation-repository.js';
import { PolygonZoneChecker } from './infrastructure/zone/polygon-zone-checker.js';
import { EchoTranslator } from './infrastructure/i18n/echo-translator.js';
import { AiTranslator } from './infrastructure/i18n/ai-translator.js';
import { PlaceholderTtsSynthesizer } from './infrastructure/i18n/placeholder-tts.js';
import { EventModerationGateway } from './infrastructure/messaging/event-moderation-gateway.js';
import { EventTourCatalogPublisher } from './infrastructure/messaging/event-tour-catalog-publisher.js';
import { EventTourReviewPublisher } from './infrastructure/messaging/event-tour-review-publisher.js';
import { PrismaTourReviewActionRepository } from './infrastructure/persistence/prisma-tour-review-action-repository.js';
import { isModerationEnabled, isChatbotEventsEnabled } from './config.js';

import { CreateTour } from './application/use-cases/create-tour.js';
import { ListMyTours } from './application/use-cases/list-my-tours.js';
import { GetMyTour } from './application/use-cases/get-my-tour.js';
import { UpdateTour } from './application/use-cases/update-tour.js';
import { DeleteTour } from './application/use-cases/delete-tour.js';
import { GetPublishReadiness, PublishTour, UnpublishTour } from './application/use-cases/publish-tour.js';
import { ApplyModerationResult } from './application/use-cases/apply-moderation-result.js';
import { buildModerationResultHandler } from './interfaces/events/moderation-result-handler.js';
import {
  ListReviewQueue,
  GetReviewDossier,
  ApproveTour,
  RejectTour,
  RequestTourChanges,
} from './application/use-cases/review-tour.js';

import { AddPlace } from './application/use-cases/add-place.js';
import { ListPlaces } from './application/use-cases/list-places.js';
import { UpdatePlace } from './application/use-cases/update-place.js';
import { DeletePlace } from './application/use-cases/delete-place.js';
import { ReorderPlaces } from './application/use-cases/reorder-places.js';

import { GetRouteConfig } from './application/use-cases/get-route-config.js';
import { SaveRouteConfig } from './application/use-cases/save-route-config.js';

import { SearchTours } from './application/use-cases/search-tours.js';
import { GetPublicTour } from './application/use-cases/get-public-tour.js';
import { PreviewTour } from './application/use-cases/preview-tour.js';

import { GetLanguageConfig } from './application/use-cases/get-language-config.js';
import { SetTourLanguages } from './application/use-cases/set-tour-languages.js';
import { PreviewTts } from './application/use-cases/preview-tts.js';
import { UpdateTranslation } from './application/use-cases/update-translation.js';

import { CreateItinerary } from './application/use-cases/create-itinerary.js';
import { ListMyItineraries } from './application/use-cases/list-my-itineraries.js';
import { GetItinerary } from './application/use-cases/get-itinerary.js';
import { RenameItinerary } from './application/use-cases/rename-itinerary.js';
import { DeleteItinerary } from './application/use-cases/delete-itinerary.js';
import { AddItineraryItem } from './application/use-cases/add-itinerary-item.js';
import { RemoveItineraryItem } from './application/use-cases/remove-itinerary-item.js';
import { ReorderItineraryItems } from './application/use-cases/reorder-itinerary-items.js';
import { ShareItinerary } from './application/use-cases/share-itinerary.js';
import { GetSharedItinerary } from './application/use-cases/get-shared-itinerary.js';
import { ExplorePlaces } from './application/use-cases/explore-places.js';

import { TourController } from './interfaces/http/controllers/tour-controller.js';
import { buildTourRouter } from './interfaces/http/routes/tour-routes.js';
import { PlaceController } from './interfaces/http/controllers/place-controller.js';
import { buildPlaceRouter } from './interfaces/http/routes/place-routes.js';
import { RouteConfigController } from './interfaces/http/controllers/route-config-controller.js';
import { buildRouteConfigRouter } from './interfaces/http/routes/route-config-routes.js';
import { PublicTourController } from './interfaces/http/controllers/public-tour-controller.js';
import { buildPublicTourRouter } from './interfaces/http/routes/public-tour-routes.js';
import { LanguageController } from './interfaces/http/controllers/language-controller.js';
import { buildLanguageRouter } from './interfaces/http/routes/language-routes.js';
import { PreviewController } from './interfaces/http/controllers/preview-controller.js';
import { buildPreviewRouter } from './interfaces/http/routes/preview-routes.js';
import { ItineraryController } from './interfaces/http/controllers/itinerary-controller.js';
import { buildItineraryRouter } from './interfaces/http/routes/itinerary-routes.js';
import { ExploreController } from './interfaces/http/controllers/explore-controller.js';
import { buildExploreRouter } from './interfaces/http/routes/explore-routes.js';
import { buildPublicItineraryRouter } from './interfaces/http/routes/public-itinerary-routes.js';
import { AdminReviewController } from './interfaces/http/controllers/admin-review-controller.js';
import { buildAdminReviewRouter } from './interfaces/http/routes/admin-review-routes.js';

// Dịch thật qua AI service khi có khoá Gemini (hoặc ép bằng TRANSLATOR=ai|echo).
function selectTranslator(env) {
  const mode = env.TRANSLATOR || (env.GEMINI_API_KEY ? 'ai' : 'echo');
  if (mode !== 'ai') return new EchoTranslator();
  return new AiTranslator({ baseUrl: env.AI_SERVICE_URL || 'http://ai:3004' });
}

/**
 * @param {object} env
 * @param {{ publish?, validateEvent?, verifyJwt? }} [shared] functions from ../shared (only index.js imports it);
 *   publish / validateEvent are needed only when an event flag is on, verifyJwt guards the admin routes (UC19)
 */
export function buildContainer(env = process.env, { publish = null, validateEvent = null, verifyJwt = null } = {}) {
  // --- infrastructure (impl của domain/ports) ---
  const tourRepo = new PrismaTourRepository(prisma);
  const placeRepo = new PrismaPlaceRepository(prisma);
  // Vùng cấm (E2): kiểm điểm trong polygon vùng cấm đang bật.
  const zoneRepo = new PrismaForbiddenZoneRepository(prisma);
  const zoneChecker = new PolygonZoneChecker({ zoneRepo });
  // Cấu hình route & kích hoạt (UC11).
  const routeConfigRepo = new PrismaRouteConfigRepository(prisma);
  // Đa ngôn ngữ & TTS (UC12). Dịch: AI service (Gemini/Groq) hoặc Echo khi dev
  // chưa có khoá. TTS vẫn là placeholder (client đọc bằng Web Speech).
  const tourLanguageRepo = new PrismaTourLanguageRepository(prisma);
  const placeTranslationRepo = new PrismaPlaceTranslationRepository(prisma);
  const translator = selectTranslator(env);
  const ttsSynthesizer = new PlaceholderTtsSynthesizer();
  // Lịch trình cá nhân (UC07).
  const itineraryRepo = new PrismaItineraryRepository(prisma);
  const generateShareToken = () => crypto.randomBytes(12).toString('base64url');
  // UC15 — gateway for place.submitted / tour.submitted; null when the flag is off -> behaviour as today.
  const moderation =
    isModerationEnabled(env) && publish ? new EventModerationGateway({ publish }) : null;
  // #240 — publisher for tour.published / tour.unpublished (chatbot index); null when the flag is off.
  const catalog =
    isChatbotEventsEnabled(env) && publish ? new EventTourCatalogPublisher({ publish }) : null;
  const i18nRepos = { tourLanguageRepo, placeTranslationRepo };
  // UC19 — admin decision log + tour.approved / tour.rejected / tour.changes_requested for Notification.
  // The broker is loaded when an event flag is on; otherwise no publish -> decisions send nothing.
  const reviewActionRepo = new PrismaTourReviewActionRepository(prisma);
  const reviewEvents = publish ? new EventTourReviewPublisher({ publish }) : null;

  // --- application (use-cases) ---
  const useCases = {
    // UC09 — quản lý tour
    createTour: new CreateTour({ tourRepo }),
    listMyTours: new ListMyTours({ tourRepo, placeRepo }),
    getMyTour: new GetMyTour({ tourRepo }),
    updateTour: new UpdateTour({ tourRepo, moderation, catalog }),
    deleteTour: new DeleteTour({ tourRepo, catalog }),
    // UC09 / A3 — xuất bản thẳng (bỏ qua kiểm duyệt)
    getPublishReadiness: new GetPublishReadiness({ tourRepo, placeRepo, moderation }),
    publishTour: new PublishTour({ tourRepo, placeRepo, moderation, catalog, ...i18nRepos }),
    unpublishTour: new UnpublishTour({ tourRepo, catalog }),
  };
  const placeUseCases = {
    // UC10 — quản lý điểm dừng
    addPlace: new AddPlace({ tourRepo, placeRepo, zoneChecker, moderation, catalog, ...i18nRepos }),
    listPlaces: new ListPlaces({ tourRepo, placeRepo }),
    updatePlace: new UpdatePlace({ tourRepo, placeRepo, zoneChecker, moderation, catalog, ...i18nRepos }),
    deletePlace: new DeletePlace({ tourRepo, placeRepo, moderation, catalog, ...i18nRepos }),
    reorderPlaces: new ReorderPlaces({ tourRepo, placeRepo, moderation, catalog, ...i18nRepos }),
  };
  const routeConfigUseCases = {
    // UC11 — route & vùng kích hoạt
    getRouteConfig: new GetRouteConfig({ tourRepo, placeRepo, routeConfigRepo }),
    saveRouteConfig: new SaveRouteConfig({ tourRepo, placeRepo, routeConfigRepo }),
  };
  const publicUseCases = {
    // UC02 — tìm & xem tour công khai (ngôn ngữ/nhãn giọng lấy từ cấu hình UC12)
    searchTours: new SearchTours({ tourRepo, placeRepo }),
    getPublicTour: new GetPublicTour({
      tourRepo,
      placeRepo,
      routeConfigRepo,
      tourLanguageRepo,
      placeTranslationRepo,
    }),
  };
  const previewUseCases = {
    // UC13 — xem thử tour (tác giả, mọi trạng thái; tái dùng view chi tiết UC02)
    previewTour: new PreviewTour({
      tourRepo,
      placeRepo,
      routeConfigRepo,
      tourLanguageRepo,
      placeTranslationRepo,
    }),
  };
  const languageUseCases = {
    // UC12 — đa ngôn ngữ & TTS
    getLanguageConfig: new GetLanguageConfig({ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo }),
    setTourLanguages: new SetTourLanguages({ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, translator, ttsSynthesizer, catalog }),
    previewTts: new PreviewTts({ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, ttsSynthesizer }),
    updateTranslation: new UpdateTranslation({ tourRepo, placeRepo, tourLanguageRepo, placeTranslationRepo, ttsSynthesizer, catalog }),
  };

  const itineraryUseCases = {
    // UC07 — lịch trình cá nhân (gắn tài khoản)
    createItinerary: new CreateItinerary({ itineraryRepo }),
    listMyItineraries: new ListMyItineraries({ itineraryRepo }),
    getItinerary: new GetItinerary({ itineraryRepo }),
    renameItinerary: new RenameItinerary({ itineraryRepo }),
    deleteItinerary: new DeleteItinerary({ itineraryRepo }),
    addItineraryItem: new AddItineraryItem({ itineraryRepo, placeRepo, tourRepo, tourLanguageRepo, placeTranslationRepo }),
    removeItineraryItem: new RemoveItineraryItem({ itineraryRepo }),
    reorderItineraryItems: new ReorderItineraryItems({ itineraryRepo }),
    shareItinerary: new ShareItinerary({ itineraryRepo, generateToken: generateShareToken }),
  };
  const exploreUseCases = {
    // UC07 — khám phá địa điểm lẻ + xem lịch trình chia sẻ (công khai)
    explorePlaces: new ExplorePlaces({ placeRepo }),
    getSharedItinerary: new GetSharedItinerary({ itineraryRepo }),
  };

  const reviewDeps = { tourRepo, placeRepo, reviewEvents, catalog, ...i18nRepos };
  const adminReviewUseCases = {
    // UC19 — admin review queue and decisions
    listReviewQueue: new ListReviewQueue({ tourRepo }),
    getReviewDossier: new GetReviewDossier({ tourRepo, placeRepo, reviewActionRepo, routeConfigRepo }),
    approveTour: new ApproveTour(reviewDeps),
    rejectTour: new RejectTour(reviewDeps),
    requestTourChanges: new RequestTourChanges(reviewDeps),
  };

  // --- interfaces (controller + router) ---
  const tourController = new TourController(useCases);
  const tourRouter = buildTourRouter({ tourController });
  const placeController = new PlaceController(placeUseCases);
  const placeRouter = buildPlaceRouter({ placeController });
  const routeConfigController = new RouteConfigController(routeConfigUseCases);
  const routeConfigRouter = buildRouteConfigRouter({ routeConfigController });
  const publicTourController = new PublicTourController(publicUseCases);
  const publicTourRouter = buildPublicTourRouter({ publicTourController });
  const languageController = new LanguageController(languageUseCases);
  const languageRouter = buildLanguageRouter({ languageController });
  const previewController = new PreviewController(previewUseCases);
  const previewRouter = buildPreviewRouter({ previewController });
  const itineraryController = new ItineraryController(itineraryUseCases);
  const itineraryRouter = buildItineraryRouter({ itineraryController });
  const exploreController = new ExploreController(exploreUseCases);
  const exploreRouter = buildExploreRouter({ exploreController });
  const publicItineraryRouter = buildPublicItineraryRouter({ exploreController });
  const adminReviewRouter = verifyJwt
    ? buildAdminReviewRouter({
        adminReviewController: new AdminReviewController(adminReviewUseCases),
        requireAdmin: verifyJwt(['admin']),
      })
    : null;

  // UC15 — AI result handler (queue tour.moderation-results), only when the flag is on.
  const moderationResultHandler = moderation
    ? buildModerationResultHandler({
        applyModerationResult: new ApplyModerationResult({ tourRepo, placeRepo, catalog, ...i18nRepos }),
        validateEvent,
      })
    : null;

  return {
    tourRouter,
    placeRouter,
    routeConfigRouter,
    publicTourRouter,
    languageRouter,
    previewRouter,
    itineraryRouter,
    exploreRouter,
    publicItineraryRouter,
    adminReviewRouter,
    moderationResultHandler,
    prisma,
  };
}
