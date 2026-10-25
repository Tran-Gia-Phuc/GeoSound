// =========================================================
// Impl port ItineraryRepository bằng Prisma (UC07). Nạp/ghi CẢ cụm (items).
// save() đồng bộ items: xoá item không còn, tạo item mới (id=null), cập nhật
// thứ tự item giữ lại — snapshot nội dung bất biến nên chỉ sequence đổi.
// =========================================================
import { Itinerary } from '../../domain/entities/itinerary.js';
import { ItineraryItem } from '../../domain/entities/itinerary-item.js';

/** @implements {import('../../domain/ports/index.js').ItineraryRepository} */
export class PrismaItineraryRepository {
  /** @param {import('@prisma/client').PrismaClient} prisma */
  constructor(prisma) {
    this.prisma = prisma;
  }

  static itemToEntity(r) {
    return new ItineraryItem({
      id: r.id,
      itineraryId: r.itineraryId,
      placeId: r.placeId,
      tourId: r.tourId,
      name: r.name,
      type: r.type,
      lat: r.lat,
      lng: r.lng,
      images: Array.isArray(r.images) ? r.images : [],
      radiusMeters: r.radiusMeters,
      sourceLanguage: r.sourceLanguage,
      availableLanguages: Array.isArray(r.availableLanguages) ? r.availableLanguages : [],
      audioByLang: r.audioByLang && typeof r.audioByLang === 'object' ? r.audioByLang : {},
      sequence: r.sequence,
      createdAt: r.createdAt,
    });
  }

  static toEntity(row) {
    if (!row) return null;
    return new Itinerary({
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      shareToken: row.shareToken,
      items: (row.items ?? []).map(PrismaItineraryRepository.itemToEntity),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static itemData(it) {
    return {
      placeId: it.placeId,
      tourId: it.tourId,
      name: it.name,
      type: it.type,
      lat: it.lat,
      lng: it.lng,
      images: it.images,
      radiusMeters: it.radiusMeters,
      sourceLanguage: it.sourceLanguage,
      availableLanguages: it.availableLanguages,
      audioByLang: it.audioByLang,
      sequence: it.sequence,
    };
  }

  static withItems = { items: { orderBy: { sequence: 'asc' } } };

  async create(itinerary) {
    const row = await this.prisma.itinerary.create({
      data: {
        ownerId: itinerary.ownerId,
        name: itinerary.name,
        shareToken: itinerary.shareToken,
        items: { create: itinerary.items.map(PrismaItineraryRepository.itemData) },
      },
      include: PrismaItineraryRepository.withItems,
    });
    return PrismaItineraryRepository.toEntity(row);
  }

  async findById(id) {
    const row = await this.prisma.itinerary.findUnique({
      where: { id },
      include: PrismaItineraryRepository.withItems,
    });
    return PrismaItineraryRepository.toEntity(row);
  }

  async findByShareToken(token) {
    const row = await this.prisma.itinerary.findUnique({
      where: { shareToken: token },
      include: PrismaItineraryRepository.withItems,
    });
    return PrismaItineraryRepository.toEntity(row);
  }

  async listByOwner(ownerId) {
    const rows = await this.prisma.itinerary.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      include: PrismaItineraryRepository.withItems,
    });
    return rows.map(PrismaItineraryRepository.toEntity);
  }

  async save(itinerary) {
    const keptIds = itinerary.items.filter((it) => it.id).map((it) => it.id);

    const ops = [
      this.prisma.itinerary.update({
        where: { id: itinerary.id },
        data: { name: itinerary.name, shareToken: itinerary.shareToken },
      }),
      // Xoá item đã bị gỡ khỏi aggregate.
      this.prisma.itineraryItem.deleteMany({
        where: { itineraryId: itinerary.id, id: { notIn: keptIds } },
      }),
    ];
    for (const it of itinerary.items) {
      if (it.id) {
        ops.push(
          this.prisma.itineraryItem.update({ where: { id: it.id }, data: { sequence: it.sequence } }),
        );
      } else {
        ops.push(
          this.prisma.itineraryItem.create({
            data: { itineraryId: itinerary.id, ...PrismaItineraryRepository.itemData(it) },
          }),
        );
      }
    }
    await this.prisma.$transaction(ops);
    return this.findById(itinerary.id);
  }

  async delete(id) {
    await this.prisma.itinerary.delete({ where: { id } });
  }
}
