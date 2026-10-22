// =========================================================
// Impl mặc định của port ForbiddenZoneChecker — cho phép MỌI vị trí.
// Seam cho E2: use-case đã gọi assertAllowed(); logic vùng cấm thật
// (bảng vùng cấm + PostGIS ST_Contains / turf.js) sẽ được cắm vào ở
// feature/forbidden-zone-check mà không phải sửa use-case.
// =========================================================

/** @implements {import('../../domain/ports/index.js').ForbiddenZoneChecker} */
export class AllowAllZoneChecker {
  // eslint-disable-next-line no-unused-vars
  async assertAllowed(_coords) {
    // no-op: chưa có vùng cấm nào → luôn hợp lệ.
  }
}
