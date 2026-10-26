// =========================================================
// Value Object: MediaFile — file tác giả tải lên cho tour (ảnh bìa, ảnh điểm,
// audio thuyết minh người thật). Kiểm:
//   - loại (image | audio) và định dạng được phép
//   - dung lượng > 0 và ≤ giới hạn của loại
//   - NỘI DUNG khớp định dạng khai báo (magic bytes) — không tin Content-Type
// Thuần domain: chỉ nhận Buffer + chuỗi, không biết HTTP/lưu trữ.
// =========================================================
import { UnsupportedMediaError, MediaSizeError } from '../errors/index.js';

const MB = 1024 * 1024;

// Chữ ký đầu file (magic bytes) theo định dạng.
const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf, text, offset = 0) => startsWith(buf, [...Buffer.from(text, 'ascii')], offset);

const FORMATS = {
  'image/jpeg': { kind: 'image', ext: 'jpg', match: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  'image/png': { kind: 'image', ext: 'png', match: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  'image/webp': { kind: 'image', ext: 'webp', match: (b) => ascii(b, 'RIFF') && ascii(b, 'WEBP', 8) },
  'image/gif': { kind: 'image', ext: 'gif', match: (b) => ascii(b, 'GIF8') },
  // MP3: thẻ ID3 hoặc khung MPEG (11 bit đồng bộ).
  'audio/mpeg': { kind: 'audio', ext: 'mp3', match: (b) => ascii(b, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  // M4A/AAC trong MP4: hộp 'ftyp' ở byte 4.
  'audio/mp4': { kind: 'audio', ext: 'm4a', match: (b) => ascii(b, 'ftyp', 4) },
  'audio/x-m4a': { kind: 'audio', ext: 'm4a', match: (b) => ascii(b, 'ftyp', 4) },
  'audio/aac': { kind: 'audio', ext: 'aac', match: (b) => b[0] === 0xff && (b[1] & 0xf6) === 0xf0 },
  'audio/wav': { kind: 'audio', ext: 'wav', match: (b) => ascii(b, 'RIFF') && ascii(b, 'WAVE', 8) },
  'audio/x-wav': { kind: 'audio', ext: 'wav', match: (b) => ascii(b, 'RIFF') && ascii(b, 'WAVE', 8) },
  'audio/ogg': { kind: 'audio', ext: 'ogg', match: (b) => ascii(b, 'OggS') },
  // Ghi âm trực tiếp trên trình duyệt (MediaRecorder) thường ra webm/opus.
  'audio/webm': { kind: 'audio', ext: 'webm', match: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
};

export const MEDIA_KINDS = Object.freeze({
  image: { maxBytes: 8 * MB, label: 'Ảnh' },
  audio: { maxBytes: 25 * MB, label: 'Audio' },
});

/** Danh sách Content-Type được nhận cho một loại (dùng ở biên HTTP). */
export function contentTypesFor(kind) {
  return Object.entries(FORMATS)
    .filter(([, f]) => f.kind === kind)
    .map(([type]) => type);
}

export class MediaFile {
  /** @param {{ kind: string, contentType: string, data: Buffer }} props */
  constructor({ kind, contentType, data }) {
    const limits = MEDIA_KINDS[kind];
    if (!limits) throw new UnsupportedMediaError('Loại file phải là ảnh hoặc audio');

    const type = String(contentType || '').split(';')[0].trim().toLowerCase();
    const format = FORMATS[type];
    if (!format || format.kind !== kind) {
      throw new UnsupportedMediaError(
        kind === 'image' ? 'Chỉ nhận ảnh JPG, PNG, WebP hoặc GIF' : 'Chỉ nhận audio MP3, M4A, AAC, WAV, OGG hoặc WebM',
      );
    }

    const size = data?.length ?? 0;
    if (!size) throw new MediaSizeError('File rỗng');
    if (size > limits.maxBytes) {
      throw new MediaSizeError(`${limits.label} tối đa ${Math.round(limits.maxBytes / MB)} MB`);
    }
    if (!format.match(data)) throw new UnsupportedMediaError('Nội dung file không đúng định dạng đã khai báo');

    this.kind = kind;
    this.contentType = type;
    this.ext = format.ext;
    this.data = data;
    this.size = size;
  }
}
