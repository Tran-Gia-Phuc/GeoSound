// =========================================================
// Dev seed — vài vùng cấm mẫu (UC10 / E2). KHÔNG chạy ở production.
// Chạy: node prisma/seed-forbidden-zones.js  (hoặc: npm run seed:zones)
// geometry = GeoJSON Polygon, tọa độ [lng, lat].
// =========================================================
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const zones = [
  {
    name: 'Khu quân sự (mẫu)',
    type: 'military',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [108.2, 16.05],
          [108.25, 16.05],
          [108.25, 16.1],
          [108.2, 16.1],
          [108.2, 16.05],
        ],
      ],
    },
  },
  {
    name: 'Bệnh viện (mẫu)',
    type: 'hospital',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [106.69, 10.77],
          [106.7, 10.77],
          [106.7, 10.78],
          [106.69, 10.78],
          [106.69, 10.77],
        ],
      ],
    },
  },
];

async function main() {
  for (const zone of zones) {
    await prisma.forbiddenZone.create({ data: zone });
    console.log(`[seed] forbidden zone: ${zone.name}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
