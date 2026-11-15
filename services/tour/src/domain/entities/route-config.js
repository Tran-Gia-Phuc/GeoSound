// =========================================================
// Entity: RouteConfig (cấu hình route & kích hoạt của MỘT tour — UC11).
// Aggregate gom toàn bộ thứ được lưu cùng lúc ở bước "Lưu cấu hình":
//   - path      : đường route nối các điểm theo thứ tự ([{lat,lng}, ...])
//   - triggers  : vùng kích hoạt + độ ưu tiên + gợi ý "đi tiếp" cho từng điểm
//   - navAudios : audio chỉ đường (ngã rẽ) với vùng kích hoạt riêng
// Mỗi điểm/audio chỉ đường mang một ActivationZone (value object) đã chuẩn hóa.
// Thuần domain: không biết Prisma/HTTP. Dữ liệu đã validate ở use-case.
// =========================================================

export class RouteConfig {
  /**
   * @param {{
   *   tourId: string,
   *   path?: Array<{lat:number,lng:number}>,
   *   triggers?: Array<{ placeId:string, zone:object, priority:number,
   *                      nextHint?: { text?:string|null, audioUrl?:string|null }|null }>,
   *   navAudios?: Array<{ id:string, label:string, audioUrl:string, zone:object }>,
   *   createdAt?: Date|null, updatedAt?: Date|null,
   * }} props
   */
  constructor(props) {
    this.tourId = props.tourId;
    this.path = props.path ?? [];
    this.triggers = props.triggers ?? [];
    this.navAudios = props.navAudios ?? [];
    this.createdAt = props.createdAt ?? null;
    this.updatedAt = props.updatedAt ?? null;
  }

  /** Cấu hình rỗng cho tour chưa từng lưu (GET lần đầu). */
  static empty(tourId) {
    return new RouteConfig({ tourId });
  }

  toPublic() {
    return {
      tourId: this.tourId,
      path: this.path,
      triggers: this.triggers,
      navAudios: this.navAudios,
      updatedAt: this.updatedAt,
    };
  }
}
