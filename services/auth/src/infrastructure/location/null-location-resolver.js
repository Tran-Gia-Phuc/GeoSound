// =========================================================
// UC23 / R12 — LocationResolver without a paid IP database: the location stays unknown
// (the client shows "Không xác định"). A real resolver can replace it later without
// touching the use cases.
// =========================================================

/** @implements {import('../../domain/ports/index.js').LocationResolver} */
export class NullLocationResolver {
  async resolve(_ip) {
    return null;
  }
}
