// =========================================================
// Translator (DEV) — trả lại text gốc, chưa dịch thật. Giữ hợp đồng port để
// luồng UC12 chạy/test được khi chưa có khóa dịch vụ (container chọn adapter
// này khi không có GEMINI_API_KEY; có khóa thì dùng AiTranslator).
// Bản "dịch" y nguyên văn bản gốc không được coi là bản dịch thật nên ngôn ngữ
// đó KHÔNG hiện cho khách (domain/i18n/translation-status).
// =========================================================

/** @implements {import('../../domain/ports/index.js').Translator} */
export class EchoTranslator {
  /** @param {{ text: string, from: string, to: string }} p */
  async translate({ text }) {
    return text;
  }
}
