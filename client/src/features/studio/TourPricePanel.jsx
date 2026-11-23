// =========================================================
// TourPricePanel (UC25, #446) — Studio, publish step: "Giá tải về offline".
// 0 = free (default). A price (1 000..50 000 000 VND) means a tourist buys the tour once
// with MoMo before downloading it; listening online stays free. Saving a price does not
// change the tour status or send it to moderation again. Shows copies sold, revenue and the
// paid orders (buyer as a short id only).
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatDateTime } from '../../lib/format.js';
import { formatVnd, getTourPrice, listTourSales, setTourPrice, validatePrice } from '../../lib/payment.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const errorMessage = (e, fallback) => (e?.offline ? OFFLINE_MESSAGE : e?.message || fallback);

/** @param {{ tourId: string }} props */
export default function TourPricePanel({ tourId }) {
  const toast = useToast();
  const [info, setInfo] = useState(null); // { price, paidCount, revenue }
  const [value, setValue] = useState('');
  const [loadError, setLoadError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sales, setSales] = useState([]);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const r = await getTourPrice(tourId);
      setInfo(r);
      setValue(String(r.price ?? 0));
      // The order list is extra: the panel still works if it fails.
      if (r.paidCount) listTourSales(tourId).then((s) => setSales(s?.items ?? []), () => setSales([]));
    } catch (e) {
      setLoadError(errorMessage(e, 'Chưa tải được giá của tour'));
    }
  }, [tourId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave(e) {
    e.preventDefault();
    const price = value.trim() === '' ? 0 : Number(value.replace(/[.\s]/g, ''));
    const invalid = validatePrice(price);
    setFieldError(invalid);
    if (invalid) return;
    setBusy(true);
    try {
      const r = await setTourPrice(tourId, price);
      setInfo(r);
      setValue(String(r.price));
      toast.show(r.price ? `Đã đặt giá ${formatVnd(r.price)}` : 'Tour đã chuyển về miễn phí');
    } catch (err) {
      if (err?.status === 400) setFieldError(err.message);
      else toast.show(errorMessage(err, 'Chưa lưu được giá'), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="publish" aria-labelledby="price-h">
      <div className="publish__head">
        <h2 className="studio__h2" id="price-h">Giá tải về offline</h2>
        {info ? <span className="chip">{info.price ? formatVnd(info.price) : 'Miễn phí'}</span> : null}
      </div>
      {loadError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={loadError === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{loadError}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : info === null ? (
        <p className="muted small"><Icon name="loader" size={16} className="spin" /> Đang tải…</p>
      ) : (
        <>
          <p className="muted small">
            Nghe trực tuyến luôn miễn phí. Đặt giá để khách mua một lần qua MoMo trước khi tải tour về máy. Đổi giá không
            làm tour về Nháp.
          </p>
          <form className="row" onSubmit={onSave} noValidate>
            <div className="field">
              <label className="field__label" htmlFor="tour-price">Giá (VND, 0 = miễn phí)</label>
              <input
                id="tour-price"
                className="input"
                inputMode="numeric"
                value={value}
                aria-invalid={!!fieldError}
                aria-describedby={fieldError ? 'tour-price-err' : undefined}
                onChange={(e) => {
                  setValue(e.target.value);
                  setFieldError('');
                }}
              />
              {fieldError ? <span id="tour-price-err" className="field__err" role="alert">{fieldError}</span> : null}
            </div>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <Icon name="loader" size={16} className="spin" /> : null} Lưu giá
            </button>
          </form>
          <p className="muted small">
            Đã bán {info.paidCount ?? 0} lượt · Doanh thu {formatVnd(info.revenue)}
          </p>
          {sales.length ? (
            <ul className="sales-list" aria-label="Đơn đã bán">
              {sales.map((s) => (
                <li key={s.orderId} className="sales-list__row small">
                  <span>Người mua …{s.buyer}</span>
                  <time className="muted" dateTime={s.paidAt}>{formatDateTime(s.paidAt)}</time>
                  <strong>{formatVnd(s.amount)}</strong>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
