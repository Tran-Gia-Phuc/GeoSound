// =========================================================
// UC07/UC08 — Dựng VIEW của lịch trình cho client.
// Trả payload TƯƠNG THÍCH buildTourDetailView (places + route{path,triggers,
// navAudios}) để UC08 TÁI DÙNG nguyên trình phát/bản đồ của UC04. Vì lịch trình
// không có cấu hình route (UC11), ta SINH vùng kích hoạt hình tròn quanh mỗi
// điểm theo bán kính snapshot, path = nối toạ độ các điểm theo thứ tự.
// Kèm khoảng cách & thời gian ước tính (UC07 bước 7).
// =========================================================
import { itineraryMetrics } from '../../domain/geo/itinerary-metrics.js';

/**
 * @param {{ itinerary: import('../../domain/entities/itinerary.js').Itinerary, lang?: string }} input
 */
export function buildItineraryView({ itinerary, lang }) {
  const items = [...itinerary.items].sort((a, b) => a.sequence - b.sequence);

  // Ngôn ngữ khả dụng = hợp của tất cả các điểm.
  const langSet = new Set();
  for (const it of items) for (const l of it.availableLanguages) langSet.add(l);
  const availableLanguages = langSet.size ? [...langSet] : ['vi'];
  const selectedLanguage = availableLanguages.includes(lang) ? lang : availableLanguages[0];

  const places = items.map((it) => {
    const loc = it.localized(selectedLanguage);
    return {
      id: it.id, // khớp trigger.placeId bên dưới (engine phát theo id này)
      placeId: it.placeId,
      name: it.name,
      type: it.type,
      lat: it.lat,
      lng: it.lng,
      sequence: it.sequence,
      images: it.images,
      text: loc.text,
      audioUrl: loc.audioUrl,
      audioSource: loc.audioSource,
    };
  });

  // Vùng kích hoạt tròn quanh mỗi điểm (ưu tiên 0 — không chồng lấn như UC11).
  const triggers = items.map((it) => ({
    placeId: it.id,
    zone: { shape: 'circle', center: { lat: it.lat, lng: it.lng }, radiusMeters: it.radiusMeters },
    priority: 0,
    nextHint: null,
  }));

  const path = items.map((it) => ({ lat: it.lat, lng: it.lng }));
  const metrics = itineraryMetrics(path);

  return {
    id: itinerary.id,
    name: itinerary.name,
    title: itinerary.name, // để trình phát (UC04) dùng chung khoá 'title'
    ownerId: itinerary.ownerId,
    shareToken: itinerary.shareToken,
    placeCount: places.length,
    selectedLanguage,
    availableLanguages,
    distanceMeters: metrics.distanceMeters,
    walkingMinutes: metrics.walkingMinutes,
    legMeters: metrics.legs,
    places,
    route: { path, triggers, navAudios: [] },
    reviews: [],
    isItinerary: true,
  };
}

/** Tóm tắt lịch trình cho danh sách "Lịch trình của tôi" (nhẹ, không localize). */
export function summarizeItinerary(itinerary) {
  const items = [...itinerary.items].sort((a, b) => a.sequence - b.sequence);
  const metrics = itineraryMetrics(items.map((it) => ({ lat: it.lat, lng: it.lng })));
  const cover = items.find((it) => it.images?.length)?.images?.[0]?.url ?? null;
  return {
    id: itinerary.id,
    name: itinerary.name,
    placeCount: items.length,
    distanceMeters: metrics.distanceMeters,
    walkingMinutes: metrics.walkingMinutes,
    shareToken: itinerary.shareToken,
    coverImageUrl: cover,
    previewPlaces: items.slice(0, 3).map((it) => it.name),
    createdAt: itinerary.createdAt,
    updatedAt: itinerary.updatedAt,
  };
}
