# UC25: buy a paid tour to download it offline (design)

Issue #446. Use case: `docs/use case/lam-sau/UC25-mua-tour-thanh-toan.md`. Decision L17 in `AI_PLAN.md`.
Payment provider: MoMo developer sandbox (`https://test-payment.momo.vn`, API v2, no real money).

## 1. Goal

An author can set a download price on a tour. Listening online stays free for everyone; the offline
package (UC03) of a paid tour is served only to the author and to accounts that paid once with MoMo.

## 2. Rules

| # | Rule |
| --- | --- |
| R1 | `tours.price` is an integer in VND: 0 (free, default) or 1 000 to 50 000 000 (MoMo limits). Anything else: 400 `validation_error` |
| R2 | Only the author sets the price (`GET/PUT /mine/:tourId/price`, 403 `not_tour_owner`). The write touches `price` only: no `updated_at` bump, no status change, no new moderation |
| R3 | Buying needs a signed-in account (any role) and a `public` tour with a price. Free: 400 `tour_free`; own tour: 400 `own_tour`; already paid: 409 `already_purchased` |
| R4 | One `tour_purchases` row per attempt; its `id` is the MoMo `orderId`/`requestId`, `amount` is the price at that moment |
| R5 | Create, query and IPN use the MoMo v2 HMAC SHA256 signatures with the secret key. An IPN with a bad signature, another `partnerCode` or another amount is 400 `invalid_signature` and changes nothing |
| R6 | `resultCode` 0 = paid; 1000, 7000, 7002, 9000 = still pending; any other code = failed |
| R7 | Status moves `pending → paid`, `pending → failed`, `failed → paid` (late success). `paid` is final. Writes are conditional (`updateMany where status in ...`) so a duplicate IPN is harmless |
| R8 | MoMo cannot reach `localhost`, so `GET /payments/:orderId` asks MoMo (`/v2/gateway/api/query`) while the order is pending. The return page polls it every 2 s for at most 1 minute |
| R9 | `GET /:id/package` of a paid tour: anonymous 401 `login_required`, signed in without purchase 402 `payment_required`; the author and buyers pass |
| R10 | The itinerary package (UC07/UC08) answers 402 while it holds places of paid tours the owner has not bought |
| R11 | The UC14 restricted package is not charged: testers of a restricted tour never pay |
| R12 | No MoMo keys: `MomoClient.fromEnv()` returns `null`, buying answers 503 `payment_unavailable`; every other flow keeps working. A MoMo error on create marks the new order `failed` and answers 503 |

## 3. Data (Tour schema, migration `20261118000000_tour_purchases`)

- `tours.price int not null default 0`.
- `tour_purchases`: `id uuid` (orderId), `tour_id` (FK, cascade), `user_id`, `amount`, `status`
  (`pending | paid | failed`), `provider` (`momo`), `trans_id`, `result_code`, `created_at`, `paid_at`.
  Indexes `(tour_id, user_id, status)` and `(user_id)`.

## 4. API (gateway prefix `/api/tours`)

| Who | Route | Answer |
| --- | --- | --- |
| Author | `GET /mine/:tourId/price`, `PUT /mine/:tourId/price {price}` | `{price, paidCount, revenue}` |
| Buyer | `POST /:id/purchase` | 201 `{orderId, payUrl}` |
| Buyer | `GET /:id/purchase/mine` | `{price, purchased, owner}` |
| Public | `GET /payments/:orderId` | `{orderId, tourId, status, amount}` |
| MoMo | `POST /payments/momo/ipn` | 204, 400, 404 |
| Any | `GET /:id/package?lang=` (optional auth) | package, 401, 402 |

The return URL and IPN URL come from `PAYMENT_RETURN_URL` (client `/payment/momo`) and `MOMO_IPN_URL`.
Keys in `.env` only: `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`, `MOMO_ENDPOINT`.

## 5. Code

- Domain: `domain/tour/tour-price.js` (`normalizePrice`, `momoResultStatus`, `PURCHASE_STATUS`).
- Use cases: `application/use-cases/tour-payment.js` (`GetTourPrice`, `SetTourPrice`, `StartTourPurchase`,
  `GetMyPurchase`, `GetPaymentStatus`, `HandleMomoIpn`, `assertPackageAccess`); guards in
  `get-tour-package.js` and `get-itinerary-package.js`.
- Infrastructure: `infrastructure/payment/momo-client.js` (injected `fetch`, 10 s timeout),
  `persistence/prisma-tour-purchase-repository.js`, `PrismaTourRepository.setPrice()`.
- HTTP: `payment-schemas.js`, `tour-payment-controller.js`, `tour-payment-routes.js` (mounted after the
  access routes; public routes match UUIDs only, so `/payments/...` and `/mine/...` are not captured).
- Client: `lib/payment.js`, `features/payment/PurchaseGate.jsx`, `features/payment/PaymentReturnPage.jsx`
  (route `/payment/momo`), `features/studio/TourPricePanel.jsx`; `fetchTourPackage()` sends the token when
  signed in.

## 6. Tests

- `services/tour/test/tour-payment.test.js`: price rules, signatures (create, query, IPN), purchase
  flow, status transitions, package and itinerary guards, routes. MoMo is a fake `fetch`; nothing calls
  the network.
- `client/test/ui/payment.spec.js`: anonymous gate, buy redirect, 503, buyer, free tour, return page
  (pending → paid, failed), Studio price.

## 7. Out of scope

Refunds, payout to authors, a price badge on tour cards, sale events or notifications, limiting the
number of pending orders per account.
