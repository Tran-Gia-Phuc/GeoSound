import { ApiError } from './api.js';

// A malformed success response is an error, not an empty search result.
export function requireDiscoveryPage(body, field) {
  const id = field === 'tours' ? 'id' : 'placeId';
  const label = field === 'tours' ? 'title' : 'name';
  if (!body || !Array.isArray(body[field]) ||
      !Number.isInteger(body.page) || body.page < 1 ||
      !Number.isInteger(body.total) || body.total < 0 ||
      !body[field].every((item) => item && typeof item[id] === 'string' &&
        typeof item[label] === 'string')) {
    throw new ApiError('Dữ liệu tìm kiếm không hợp lệ. Vui lòng thử lại.', { code: 'invalid_response' });
  }
  return body;
}
