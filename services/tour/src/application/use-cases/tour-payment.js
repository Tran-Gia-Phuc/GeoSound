// =========================================================
// UC25 (#446) — buy a paid tour to download it offline (MoMo sandbox).
//   Author:  GetTourPrice / SetTourPrice (owner only, any status, updated_at kept)
//   Buyer:   StartTourPurchase -> MoMo payUrl; GetMyPurchase -> { purchased }
//   Result:  HandleMomoIpn (signed notification) and GetPaymentStatus (asks MoMo while pending,
//            because the IPN cannot reach a localhost stack); both go through applyResult()
//   Package: assertPackageAccess() is used by GetTourPackage (UC03)
// Listening online stays free; only the offline package of a paid tour is protected.
// =========================================================
import {
  TourNotFoundError,
  NotTourOwnerError,
  LoginRequiredError,
  PaymentRequiredError,
  TourFreeError,
  OwnTourPurchaseError,
  AlreadyPurchasedError,
  PaymentUnavailableError,
  OrderNotFoundError,
  InvalidPaymentNotificationError,
} from '../../domain/errors/index.js';
import { normalizePrice, isPaidTour, momoResultStatus, PURCHASE_STATUS } from '../../domain/tour/tour-price.js';

const { PENDING, PAID, FAILED } = PURCHASE_STATUS;

async function loadOwned(tourRepo, { authorId, tourId }) {
  const tour = await tourRepo.findById(tourId);
  if (!tour) throw new TourNotFoundError();
  if (!tour.isOwnedBy(authorId)) throw new NotTourOwnerError();
  return tour;
}

/** UC03 guard: free tour, or the author, or a buyer. userId null = not signed in. */
export async function assertPackageAccess(purchaseRepo, tour, userId) {
  if (!isPaidTour(tour)) return;
  if (!userId) throw new LoginRequiredError();
  if (tour.isOwnedBy(userId)) return;
  if (!purchaseRepo || !(await purchaseRepo.hasPaid(tour.id, userId))) throw new PaymentRequiredError();
}

/** Writes a MoMo result on a purchase (conditional). Returns the resulting status. */
async function applyResult(purchaseRepo, purchase, { resultCode, transId }, clock) {
  const next = momoResultStatus(resultCode);
  if (next === PAID) {
    await purchaseRepo.markPaidIf(purchase.id, { transId: transId != null ? String(transId) : null, resultCode: Number(resultCode), paidAt: clock() });
  } else if (next === FAILED) {
    await purchaseRepo.markFailedIf(purchase.id, { resultCode: Number(resultCode) });
  }
  return (await purchaseRepo.findById(purchase.id))?.status ?? purchase.status;
}

const view = (p, status = p.status) => ({ orderId: p.id, tourId: p.tourId, status, amount: p.amount });

export const HISTORY_LIMIT = 50;

export class GetTourPrice {
  constructor({ tourRepo, purchaseRepo }) {
    Object.assign(this, { tourRepo, purchaseRepo });
  }

  async execute({ authorId, tourId }) {
    const tour = await loadOwned(this.tourRepo, { authorId, tourId });
    return { price: tour.price ?? 0, ...(await this.purchaseRepo.salesOf(tour.id)) };
  }
}

export class SetTourPrice {
  constructor({ tourRepo, purchaseRepo }) {
    Object.assign(this, { tourRepo, purchaseRepo });
  }

  async execute({ authorId, tourId, price }) {
    const value = normalizePrice(price);
    const tour = await loadOwned(this.tourRepo, { authorId, tourId });
    const saved = value === tour.price ? tour : await this.tourRepo.setPrice(tour, value);
    return { price: saved.price ?? 0, ...(await this.purchaseRepo.salesOf(tour.id)) };
  }
}

export class StartTourPurchase {
  /** @param {{ tourRepo, purchaseRepo, momo: import('../../infrastructure/payment/momo-client.js').MomoClient|null }} deps */
  constructor({ tourRepo, purchaseRepo, momo }) {
    Object.assign(this, { tourRepo, purchaseRepo, momo });
  }

  async execute({ tourId, userId }) {
    const tour = await this.tourRepo.findPublicById(tourId);
    if (!tour) throw new TourNotFoundError('Tour không còn khả dụng');
    if (!isPaidTour(tour)) throw new TourFreeError();
    if (tour.isOwnedBy(userId)) throw new OwnTourPurchaseError();
    if (await this.purchaseRepo.hasPaid(tour.id, userId)) throw new AlreadyPurchasedError();
    if (!this.momo) throw new PaymentUnavailableError();

    const purchase = await this.purchaseRepo.create({ tourId: tour.id, userId, amount: tour.price });
    try {
      const { payUrl } = await this.momo.createPayment({
        orderId: purchase.id,
        amount: purchase.amount,
        orderInfo: `GeoSound - ${tour.title}`.slice(0, 200),
      });
      return { orderId: purchase.id, payUrl };
    } catch (err) {
      console.warn(`[tour] momo create ${purchase.id}: ${err.message}`);
      await this.purchaseRepo.markFailedIf(purchase.id, { resultCode: null });
      throw new PaymentUnavailableError();
    }
  }
}

export class GetMyPurchase {
  constructor({ tourRepo, purchaseRepo }) {
    Object.assign(this, { tourRepo, purchaseRepo });
  }

  async execute({ tourId, userId }) {
    const tour = await this.tourRepo.findPublicById(tourId);
    if (!tour) throw new TourNotFoundError('Tour không còn khả dụng');
    const owner = tour.isOwnedBy(userId);
    const purchased = !isPaidTour(tour) || owner || (await this.purchaseRepo.hasPaid(tour.id, userId));
    return { price: tour.price ?? 0, purchased, owner };
  }
}

export class GetPaymentStatus {
  constructor({ purchaseRepo, momo, clock = () => new Date() }) {
    Object.assign(this, { purchaseRepo, momo, clock });
  }

  async execute({ orderId }) {
    const purchase = await this.purchaseRepo.findById(orderId);
    if (!purchase) throw new OrderNotFoundError();
    if (purchase.status !== PENDING || !this.momo) return view(purchase);
    try {
      const r = await this.momo.queryPayment(purchase.id);
      if (r.amount != null && Number(r.amount) !== purchase.amount) return view(purchase);
      return view(purchase, await applyResult(this.purchaseRepo, purchase, r, this.clock));
    } catch (err) {
      // MoMo unreachable: stay pending, the client asks again.
      console.warn(`[tour] momo query ${purchase.id}: ${err.message}`);
      return view(purchase);
    }
  }
}

export class HandleMomoIpn {
  constructor({ purchaseRepo, momo, clock = () => new Date() }) {
    Object.assign(this, { purchaseRepo, momo, clock });
  }

  async execute(body) {
    if (!this.momo || !this.momo.verifyIpn(body)) throw new InvalidPaymentNotificationError();
    const purchase = await this.purchaseRepo.findById(String(body.orderId));
    if (!purchase) throw new OrderNotFoundError();
    if (Number(body.amount) !== purchase.amount) throw new InvalidPaymentNotificationError();
    const status = await applyResult(this.purchaseRepo, purchase, body, this.clock);
    return view(purchase, status);
  }
}

/** Buyer: own purchase history (every attempt, newest first). */
export class ListMyPurchases {
  constructor({ purchaseRepo }) {
    Object.assign(this, { purchaseRepo });
  }

  async execute({ userId }) {
    const rows = await this.purchaseRepo.listByUser(userId, HISTORY_LIMIT);
    return {
      items: rows.map((p) => ({
        ...view(p),
        tourTitle: p.tourTitle ?? null,
        transId: p.transId ?? null,
        createdAt: p.createdAt,
        paidAt: p.paidAt ?? null,
      })),
    };
  }
}

/** Author: paid orders of an own tour. The buyer is shown as a short id only (no email or name). */
export class ListTourSales {
  constructor({ tourRepo, purchaseRepo }) {
    Object.assign(this, { tourRepo, purchaseRepo });
  }

  async execute({ authorId, tourId }) {
    const tour = await loadOwned(this.tourRepo, { authorId, tourId });
    const rows = await this.purchaseRepo.paidOfTour(tour.id, HISTORY_LIMIT);
    return {
      items: rows.map((p) => ({ orderId: p.id, amount: p.amount, paidAt: p.paidAt, buyer: String(p.userId).slice(-6) })),
    };
  }
}
