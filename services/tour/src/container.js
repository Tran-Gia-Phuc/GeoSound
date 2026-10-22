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

import { CreateTour } from './application/use-cases/create-tour.js';
import { ListMyTours } from './application/use-cases/list-my-tours.js';
import { GetMyTour } from './application/use-cases/get-my-tour.js';
import { UpdateTour } from './application/use-cases/update-tour.js';
import { DeleteTour } from './application/use-cases/delete-tour.js';

import { TourController } from './interfaces/http/controllers/tour-controller.js';
import { buildTourRouter } from './interfaces/http/routes/tour-routes.js';

export function buildContainer(/* env = process.env */) {
  // --- infrastructure (impl của domain/ports) ---
  const tourRepo = new PrismaTourRepository(prisma);

  // --- application (use-cases) — UC09 ---
  const useCases = {
    createTour: new CreateTour({ tourRepo }),
    listMyTours: new ListMyTours({ tourRepo }),
    getMyTour: new GetMyTour({ tourRepo }),
    updateTour: new UpdateTour({ tourRepo }),
    deleteTour: new DeleteTour({ tourRepo }),
  };

  // --- interfaces (controller + router) ---
  const tourController = new TourController(useCases);
  const tourRouter = buildTourRouter({ tourController });

  return { tourRouter, prisma };
}
