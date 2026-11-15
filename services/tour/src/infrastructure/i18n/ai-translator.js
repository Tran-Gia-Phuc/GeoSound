// =========================================================
// Translator THẬT — gọi AI service (POST /translate: Gemini, dự phòng Groq).
// Hợp đồng port Translator + translateMany (dịch theo lô: một ngôn ngữ / lần,
// chia nhỏ thành lô ≤ batchSize đoạn để vừa giới hạn token của model).
// Lỗi mạng / timeout / 5xx / sai số lượng → ném lỗi; use-case map sang E1 (503).
// =========================================================

/** @implements {import('../../domain/ports/index.js').Translator} */
export class AiTranslator {
  /**
   * @param {{ baseUrl: string, timeoutMs?: number, batchSize?: number, fetchImpl?: typeof fetch }} opts
   */
  constructor({ baseUrl, timeoutMs = 60000, batchSize = 20, fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.batchSize = batchSize;
    this.fetch = fetchImpl;
  }

  /** @param {{ text: string, from: string, to: string, context?: string }} p */
  async translate({ text, from, to, context }) {
    const [out] = await this.translateMany({ texts: [text], from, to, context });
    return out;
  }

  /** @param {{ texts: string[], from: string, to: string, context?: string }} p */
  async translateMany({ texts, from, to, context }) {
    const out = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const chunk = texts.slice(i, i + this.batchSize);
      out.push(...(await this.#post({ source_lang: from, target_lang: to, texts: chunk, context })));
    }
    return out;
  }

  async #post({ context, ...body }) {
    const payload = context ? { ...body, context: context.slice(0, 300) } : body;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`AI translate HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.translations) || data.translations.length !== body.texts.length) {
        throw new Error('AI translate trả sai số lượng bản dịch');
      }
      return data.translations;
    } finally {
      clearTimeout(timer);
    }
  }
}
