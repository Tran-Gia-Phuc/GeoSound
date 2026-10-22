// =========================================================
// Entity: Place (điểm dừng trên tour — UC10). Lõi nghiệp vụ:
//   - mô tả text BẮT BUỘC (nguồn nội dung chính + đầu vào kiểm duyệt AI)
//   - audio người thật tùy chọn; không có → dùng TTS (audioSource)
//   - thứ tự hiển thị trong tour (sequence)
// Thuần domain: không biết Prisma/HTTP.
// =========================================================

export const PLACE_TYPES = Object.freeze([
  'landmark',
  'museum',
  'historical',
  'nature',
  'food',
  'shopping',
  'entertainment',
  'other',
]);

// Nguồn audio của điểm: người thật (upload) hoặc máy đọc text (TTS — UC12).
export const AUDIO_SOURCE = Object.freeze({ HUMAN: 'human', TTS: 'tts' });

// Trường contributor được sửa (A3).
export const EDITABLE_FIELDS = Object.freeze([
  'name',
  'type',
  'description',
  'lat',
  'lng',
  'images',
  'audioUrl',
]);

export class Place {
  /**
   * @param {{
   *   id?: string, tourId: string, name: string, type?: string, description: string,
   *   lat: number, lng: number, sequence?: number,
   *   images?: Array<{url: string, caption?: string}>,
   *   audioUrl?: string|null, audioSource?: string,
   *   createdAt?: Date, updatedAt?: Date,
   * }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.tourId = props.tourId;
    this.name = props.name;
    this.type = props.type ?? 'other';
    this.description = props.description;
    this.lat = props.lat;
    this.lng = props.lng;
    this.sequence = props.sequence ?? 0;
    this.images = props.images ?? [];
    this.audioUrl = props.audioUrl ?? null;
    // Suy ra nguồn audio theo có file người thật hay không (nếu không truyền sẵn).
    this.audioSource =
      props.audioSource ?? (props.audioUrl ? AUDIO_SOURCE.HUMAN : AUDIO_SOURCE.TTS);
    this.createdAt = props.createdAt ?? null;
    this.updatedAt = props.updatedAt ?? null;
  }

  /**
   * A3 — áp các thay đổi nội dung. Giá trị phải đã validate/chuẩn hóa ở use-case.
   * audioSource tự cập nhật theo audioUrl (gỡ audio người thật → về TTS).
   * @param {Record<string, any>} fields
   */
  applyEdits(fields) {
    for (const key of EDITABLE_FIELDS) {
      if (fields[key] !== undefined) this[key] = fields[key];
    }
    if (fields.audioUrl !== undefined) {
      this.audioSource = fields.audioUrl ? AUDIO_SOURCE.HUMAN : AUDIO_SOURCE.TTS;
    }
  }

  toPublic() {
    return {
      id: this.id,
      tourId: this.tourId,
      name: this.name,
      type: this.type,
      description: this.description,
      lat: this.lat,
      lng: this.lng,
      sequence: this.sequence,
      images: this.images,
      audioUrl: this.audioUrl,
      audioSource: this.audioSource,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
