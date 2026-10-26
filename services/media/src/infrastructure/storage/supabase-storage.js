// =========================================================
// MediaStorage → Supabase Storage (quyết định D3: DB đã ở Supabase, không phải
// dựng S3). Gọi REST API bằng fetch (Node 20) — không thêm thư viện.
//   PUT  {url}/storage/v1/object/{bucket}/{key}
//   URL công khai: {url}/storage/v1/object/public/{bucket}/{key}  (bucket public)
// Dùng service role key — CHỈ ở server, không bao giờ gửi xuống client.
// =========================================================

/** @implements {import('../../domain/ports/index.js').MediaStorage} */
export class SupabaseStorage {
  /** @param {{ url: string, serviceKey: string, bucket: string, fetchImpl?: typeof fetch }} opts */
  constructor({ url, serviceKey, bucket, fetchImpl = globalThis.fetch }) {
    this.base = url.replace(/\/+$/, '');
    this.key = serviceKey;
    this.bucket = bucket;
    this.fetch = fetchImpl;
  }

  async put({ key, data, contentType }) {
    const path = `${encodeURIComponent(this.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const res = await this.fetch(`${this.base}/storage/v1/object/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.key}`,
        apikey: this.key,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'x-upsert': 'false',
      },
      body: data,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase Storage ${res.status}: ${text.slice(0, 200)}`);
    }
    return { url: `${this.base}/storage/v1/object/public/${path}` };
  }
}
