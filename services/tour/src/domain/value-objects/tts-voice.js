// =========================================================
// Value Object: TtsVoice (giọng đọc TTS của tour — UC12 bước 5).
// Giới tính (nam/nữ) + vùng miền (tùy chọn). Thuần domain.
// =========================================================
import { ValidationError } from '../errors/index.js';

export const TTS_GENDERS = Object.freeze(['male', 'female']);

export class TtsVoice {
  /** @param {{ gender: string, region?: string|null }} props */
  constructor({ gender, region } = {}) {
    if (!TTS_GENDERS.includes(gender)) {
      throw new ValidationError('Giọng đọc TTS không hợp lệ (nam/nữ)');
    }
    this.gender = gender;
    this.region = region?.trim() || null;
  }

  toPublic() {
    return { gender: this.gender, region: this.region };
  }
}
