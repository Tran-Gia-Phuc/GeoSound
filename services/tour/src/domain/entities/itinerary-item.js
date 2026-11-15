// =========================================================
// Entity: ItineraryItem (UC07) — một điểm trong lịch trình cá nhân.
// Là SNAPSHOT dữ liệu hiển thị/phát của địa điểm lúc thêm vào (toạ độ, ảnh,
// audio đa ngữ, bán kính kích hoạt). Nhờ snapshot, lịch trình chia sẻ (A4) và
// phát lại (UC08) không phụ thuộc việc tác giả sửa/xoá tour gốc.
// Thuần domain: không biết Prisma/HTTP.
// =========================================================

export const DEFAULT_RADIUS_METERS = 50; // vùng kích hoạt mặc định cho UC08

export class ItineraryItem {
  /**
   * @param {{
   *   id?: string, itineraryId?: string, placeId: string, tourId: string,
   *   name: string, type?: string, lat: number, lng: number,
   *   images?: Array<{url: string, caption?: string}>,
   *   radiusMeters?: number, sourceLanguage: string,
   *   availableLanguages?: string[],
   *   audioByLang?: Record<string, { text: string, audioUrl: string|null, audioSource: string }>,
   *   sequence?: number, createdAt?: Date,
   * }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.itineraryId = props.itineraryId ?? null;
    this.placeId = props.placeId;
    this.tourId = props.tourId;
    this.name = props.name;
    this.type = props.type ?? 'other';
    this.lat = props.lat;
    this.lng = props.lng;
    this.images = props.images ?? [];
    this.radiusMeters = props.radiusMeters ?? DEFAULT_RADIUS_METERS;
    this.sourceLanguage = props.sourceLanguage;
    this.availableLanguages = props.availableLanguages ?? [props.sourceLanguage];
    this.audioByLang = props.audioByLang ?? {};
    this.sequence = props.sequence ?? 0;
    this.createdAt = props.createdAt ?? null;
  }

  /** Nội dung đã bản địa hoá theo ngôn ngữ chọn (fallback về ngôn ngữ gốc). */
  localized(lang) {
    const code = this.audioByLang[lang] ? lang : this.sourceLanguage;
    const a = this.audioByLang[code] ?? { text: '', audioUrl: null, audioSource: 'tts' };
    return { language: code, ...a };
  }

  toPublic() {
    return {
      id: this.id,
      placeId: this.placeId,
      tourId: this.tourId,
      name: this.name,
      type: this.type,
      lat: this.lat,
      lng: this.lng,
      images: this.images,
      radiusMeters: this.radiusMeters,
      sourceLanguage: this.sourceLanguage,
      availableLanguages: this.availableLanguages,
      audioByLang: this.audioByLang,
      sequence: this.sequence,
    };
  }
}
