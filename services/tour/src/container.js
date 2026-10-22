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
// =========================================================

export function buildContainer(/* { prisma, redis, env, publish } */) {
  // --- infrastructure ---
  // const tourRepo = new PrismaTourRepository(prisma);  // chứa query PostGIS
  // const cache    = new RedisTourCache(redis);

  // --- application (use-cases) ---
  // const searchTours = new SearchTours({ tourRepo, cache });
  // const createTour  = new CreateTour({ tourRepo });

  // --- interfaces ---
  // const tourController = new TourController({ searchTours, createTour });

  // return { tourController };
  return {};
}
