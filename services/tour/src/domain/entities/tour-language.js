// =========================================================
// Entity: TourLanguage (một ngôn ngữ của tour — UC12). Gốc (isSource) hoặc phụ.
// Mang giọng TTS áp dụng cho ngôn ngữ đó. Thuần domain.
// =========================================================

export class TourLanguage {
  /**
   * @param {{ id?: string, tourId: string, languageCode: string, isSource?: boolean,
   *           gender?: string|null, region?: string|null,
   *           createdAt?: Date, updatedAt?: Date }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.tourId = props.tourId;
    this.languageCode = props.languageCode;
    this.isSource = props.isSource ?? false;
    this.gender = props.gender ?? null;
    this.region = props.region ?? null;
    this.createdAt = props.createdAt ?? null;
    this.updatedAt = props.updatedAt ?? null;
  }

  toPublic() {
    return {
      languageCode: this.languageCode,
      isSource: this.isSource,
      voice: this.gender ? { gender: this.gender, region: this.region } : null,
    };
  }
}
