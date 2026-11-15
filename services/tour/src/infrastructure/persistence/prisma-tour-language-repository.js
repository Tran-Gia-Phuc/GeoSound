// =========================================================
// Impl port TourLanguageRepository bằng Prisma (UC12). Map row <-> entity.
// =========================================================
import { TourLanguage } from '../../domain/entities/tour-language.js';

/** @implements {import('../../domain/ports/index.js').TourLanguageRepository} */
export class PrismaTourLanguageRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  static toEntity(row) {
    if (!row) return null;
    return new TourLanguage({
      id: row.id,
      tourId: row.tourId,
      languageCode: row.languageCode,
      isSource: row.isSource,
      gender: row.ttsVoiceGender,
      region: row.ttsVoiceRegion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async listByTour(tourId) {
    const rows = await this.prisma.tourLanguage.findMany({
      where: { tourId },
      orderBy: [{ isSource: 'desc' }, { languageCode: 'asc' }],
    });
    return rows.map(PrismaTourLanguageRepository.toEntity);
  }

  async upsertMany(tourId, langs) {
    await this.prisma.$transaction(
      langs.map((l) =>
        this.prisma.tourLanguage.upsert({
          where: { tourId_languageCode: { tourId, languageCode: l.languageCode } },
          create: {
            tourId,
            languageCode: l.languageCode,
            isSource: l.isSource,
            ttsVoiceGender: l.gender,
            ttsVoiceRegion: l.region,
          },
          update: { isSource: l.isSource, ttsVoiceGender: l.gender, ttsVoiceRegion: l.region },
        })
      )
    );
  }

  async deleteLanguages(tourId, codes) {
    if (!codes.length) return;
    await this.prisma.tourLanguage.deleteMany({
      where: { tourId, languageCode: { in: codes } },
    });
  }
}
