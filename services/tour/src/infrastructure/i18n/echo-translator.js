// =========================================================
// Translator (DEV) — trả lại text gốc, chưa dịch thật. Giữ hợp đồng port để
// luồng UC12 chạy/test được khi chưa có khóa dịch vụ. SẢN XUẤT: thay bằng
// adapter gọi Gemini API (xem tech-stack.md), ném lỗi → use-case map E1.
// =========================================================

/** @implements {import('../../domain/ports/index.js').Translator} */
export class EchoTranslator {
  /** @param {{ text: string, from: string, to: string }} p */
  async translate({ text }) {
    return text;
  }
}
