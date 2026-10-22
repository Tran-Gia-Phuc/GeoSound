// =========================================================
// Impl port PlaceTranslationRepository bằng Prisma (UC12). Map row <-> entity.
// Lọc theo tour qua quan hệ place.tourId (không cần lưu tourId trùng lặp).
// =========================================================
import { PlaceTranslation } from '../../domain/entities/place-translation.js';

/** @implements {import('../../domain/ports/index.js').PlaceTranslationRepository} */
export class PrismaPlaceTranslationRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  static toEntity(row) {
    if (!row) return null;
    return new PlaceTranslation({
      id: row.id,
      placeId: row.placeId,
      languageCode: row.languageCode,
      text: row.text,
      textSource: row.textSource,
      ttsUrl: row.ttsUrl,
      ttsPrerendered: row.ttsPrerendered,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async listByTour(tourId) {
    const rows = await this.prisma.placeTranslation.findMany({
      where: { place: { tourId } },
      orderBy: [{ placeId: 'asc' }, { languageCode: 'asc' }],
    });
    return rows.map(PrismaPlaceTranslationRepository.toEntity);
  }

  async findByPlaceLang(placeId, languageCode) {
    const row = await this.prisma.placeTranslation.findUnique({
      where: { placeId_languageCode: { placeId, languageCode } },
    });
    return PrismaPlaceTranslationRepository.toEntity(row);
  }

  async upsert(tx) {
    const data = {
      text: tx.text,
      textSource: tx.textSource,
      ttsUrl: tx.ttsUrl,
      ttsPrerendered: tx.ttsPrerendered,
    };
    const row = await this.prisma.placeTranslation.upsert({
      where: { placeId_languageCode: { placeId: tx.placeId, languageCode: tx.languageCode } },
      create: { placeId: tx.placeId, languageCode: tx.languageCode, ...data },
      update: data,
    });
    return PrismaPlaceTranslationRepository.toEntity(row);
  }

  async deleteByLanguages(tourId, codes) {
    if (!codes.length) return;
    await this.prisma.placeTranslation.deleteMany({
      where: { languageCode: { in: codes }, place: { tourId } },
    });
  }
}
