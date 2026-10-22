// =========================================================
// Entity: PlaceTranslation (bản dịch + TTS của MỘT điểm theo MỘT ngôn ngữ — UC12).
//   textSource: source  = text gốc (ngôn ngữ gốc, = mô tả điểm ở UC10)
//               machine = tự động dịch
//               edited  = tác giả đã chỉnh tay (A2) — giữ khi lưu lại
// ttsUrl/ttsPrerendered: bản TTS (pre-render & cache offline khi tải — UC03).
// Thuần domain.
// =========================================================

export const TEXT_SOURCE = Object.freeze({ SOURCE: 'source', MACHINE: 'machine', EDITED: 'edited' });

export class PlaceTranslation {
  /**
   * @param {{ id?: string, placeId: string, languageCode: string, text: string,
   *           textSource?: string, ttsUrl?: string|null, ttsPrerendered?: boolean,
   *           createdAt?: Date, updatedAt?: Date }} props
   */
  constructor(props) {
    this.id = props.id ?? null;
    this.placeId = props.placeId;
    this.languageCode = props.languageCode;
    this.text = props.text;
    this.textSource = props.textSource ?? TEXT_SOURCE.MACHINE;
    this.ttsUrl = props.ttsUrl ?? null;
    this.ttsPrerendered = props.ttsPrerendered ?? false;
    this.createdAt = props.createdAt ?? null;
    this.updatedAt = props.updatedAt ?? null;
  }

  /** A2 — tác giả chỉnh bản dịch; TTS cũ không còn đúng → phải render lại. */
  applyEdit(text) {
    this.text = text;
    this.textSource = TEXT_SOURCE.EDITED;
    this.ttsUrl = null;
    this.ttsPrerendered = false;
  }

  toPublic() {
    return {
      placeId: this.placeId,
      languageCode: this.languageCode,
      text: this.text,
      textSource: this.textSource,
      ttsUrl: this.ttsUrl,
      ttsPrerendered: this.ttsPrerendered,
    };
  }
}
