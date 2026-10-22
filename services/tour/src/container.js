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
import { prisma } from './infrastructure/persistence/prisma-client.js';
import { PrismaTourRepository } from './infrastructure/persistence/prisma-tour-repository.js';
import { PrismaPlaceRepository } from './infrastructure/persistence/prisma-place-repository.js';
import { PrismaForbiddenZoneRepository } from './infrastructure/persistence/prisma-forbidden-zone-repository.js';
import { PrismaRouteConfigRepository } from './infrastructure/persistence/prisma-route-config-repository.js';
import { PolygonZoneChecker } from './infrastructure/zone/polygon-zone-checker.js';

import { CreateTour } from './application/use-cases/create-tour.js';
import { ListMyTours } from './application/use-cases/list-my-tours.js';
import { GetMyTour } from './application/use-cases/get-my-tour.js';
import { UpdateTour } from './application/use-cases/update-tour.js';
import { DeleteTour } from './application/use-cases/delete-tour.js';

import { AddPlace } from './application/use-cases/add-place.js';
import { ListPlaces } from './application/use-cases/list-places.js';
import { UpdatePlace } from './application/use-cases/update-place.js';
import { DeletePlace } from './application/use-cases/delete-place.js';
import { ReorderPlaces } from './application/use-cases/reorder-places.js';

import { GetRouteConfig } from './application/use-cases/get-route-config.js';
import { SaveRouteConfig } from './application/use-cases/save-route-config.js';

import { SearchTours } from './application/use-cases/search-tours.js';
import { GetPublicTour } from './application/use-cases/get-public-tour.js';

import { TourController } from './interfaces/http/controllers/tour-controller.js';
import { buildTourRouter } from './interfaces/http/routes/tour-routes.js';
import { PlaceController } from './interfaces/http/controllers/place-controller.js';
import { buildPlaceRouter } from './interfaces/http/routes/place-routes.js';
import { RouteConfigController } from './interfaces/http/controllers/route-config-controller.js';
import { buildRouteConfigRouter } from './interfaces/http/routes/route-config-routes.js';
import { PublicTourController } from './interfaces/http/controllers/public-tour-controller.js';
import { buildPublicTourRouter } from './interfaces/http/routes/public-tour-routes.js';

export function buildContainer(/* env = process.env */) {
  // --- infrastructure (impl của domain/ports) ---
  const tourRepo = new PrismaTourRepository(prisma);
  const placeRepo = new PrismaPlaceRepository(prisma);
  // Vùng cấm (E2): kiểm điểm trong polygon vùng cấm đang bật.
  const zoneRepo = new PrismaForbiddenZoneRepository(prisma);
  const zoneChecker = new PolygonZoneChecker({ zoneRepo });
  // Cấu hình route & kích hoạt (UC11).
  const routeConfigRepo = new PrismaRouteConfigRepository(prisma);

  // --- application (use-cases) ---
  const useCases = {
    // UC09 — quản lý tour
    createTour: new CreateTour({ tourRepo }),
    listMyTours: new ListMyTours({ tourRepo }),
    getMyTour: new GetMyTour({ tourRepo }),
    updateTour: new UpdateTour({ tourRepo }),
    deleteTour: new DeleteTour({ tourRepo }),
  };
  const placeUseCases = {
    // UC10 — quản lý điểm dừng
    addPlace: new AddPlace({ tourRepo, placeRepo, zoneChecker }),
    listPlaces: new ListPlaces({ tourRepo, placeRepo }),
    updatePlace: new UpdatePlace({ tourRepo, placeRepo, zoneChecker }),
    deletePlace: new DeletePlace({ tourRepo, placeRepo }),
    reorderPlaces: new ReorderPlaces({ tourRepo, placeRepo }),
  };
  const routeConfigUseCases = {
    // UC11 — route & vùng kích hoạt
    getRouteConfig: new GetRouteConfig({ tourRepo, routeConfigRepo }),
    saveRouteConfig: new SaveRouteConfig({ tourRepo, placeRepo, routeConfigRepo }),
  };
  const publicUseCases = {
    // UC02 — tìm & xem tour công khai
    searchTours: new SearchTours({ tourRepo, placeRepo }),
    getPublicTour: new GetPublicTour({ tourRepo, placeRepo, routeConfigRepo }),
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

  return { tourRouter, placeRouter, routeConfigRouter, publicTourRouter, prisma };
}
