// =========================================================
// PurchaseGate (UC25, #446) — tour detail: the offline download of a paid tour.
//   - free tour, restricted test version: the download as before (children)
//   - paid tour, not signed in: price + "Đăng nhập để mua" (/login?next=)
//   - paid tour, signed in: GET purchase/mine; author or buyer -> children,
//     else price + "Mua với MoMo" (POST purchase -> the browser goes to MoMo payUrl)
// Listening online stays free: only this block is gated.
// =========================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatVnd, getMyPurchase, startPurchase } from '../../lib/payment.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const errorMessage = (e, fallback) => (e?.offline ? OFFLINE_MESSAGE : e?.message || fallback);

/** @param {{ tour: { id: string, price?: number }, restricted?: boolean, children: React.ReactNode }} props */
export default function PurchaseGate({ tour, restricted = false, children }) {
  const { authenticated } = useAuth();
  const location = useLocation();
  const paid = !restricted && (tour.price ?? 0) > 0;
  const [state, setState] = useState(null); // null = loading, { purchased, owner }
  const [loadError, setLoadError] = useState('');
  const [buyError, setBuyError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    setState(null);
    try {
      setState(await getMyPurchase(tour.id));
    } catch (e) {
      setLoadError(errorMessage(e, 'Chưa kiểm tra được trạng thái mua tour'));
    }
  }, [tour.id]);

  useEffect(() => {
    if (paid && authenticated) load();
  }, [paid, authenticated, load]);

  if (!paid) return children;
  if (authenticated && state?.purchased) {
    return (
      <>
        <p className="muted small purchase__owned">
          <Icon name="check-circle" size={14} /> {state.owner ? 'Tour của bạn' : 'Bạn đã mua tour này'}
        </p>
        {children}
      </>
    );
  }

  async function onBuy() {
    setBusy(true);
    setBuyError('');
    try {
      const { payUrl } = await startPurchase(tour.id);
      window.location.assign(payUrl);
    } catch (e) {
      setBuyError(errorMessage(e, 'Chưa tạo được thanh toán, vui lòng thử lại'));
      if (e?.status === 409) load();
      setBusy(false);
    }
  }

  const next = encodeURIComponent(location.pathname + location.search);
  return (
    <section className="detail__section purchase" aria-labelledby="purchase-h">
      <h2 className="detail__h2" id="purchase-h">
        <Icon name="download" size={16} /> Mua tour để tải về
      </h2>
      <p>
        Tour có phí tải về: <strong className="purchase__price">{formatVnd(tour.price)}</strong>
      </p>
      <p className="muted small">Nghe trực tuyến vẫn miễn phí. Mua một lần để tải tour về máy và nghe khi không có mạng.</p>

      {!authenticated ? (
        <Link className="btn btn--primary" to={`/login?next=${next}`}>
          <Icon name="user" size={16} /> Đăng nhập để mua
        </Link>
      ) : loadError ? (
        <div className="alert alert--warn" role="alert">
          <Icon name={loadError === OFFLINE_MESSAGE ? 'wifi-off' : 'alert-triangle'} size={18} className="alert__icon" />
          <div>{loadError}</div>
          <button className="btn btn--sm" onClick={load}>Thử lại</button>
        </div>
      ) : state === null ? (
        <p className="muted small"><Icon name="loader" size={16} className="spin" /> Đang kiểm tra…</p>
      ) : (
        <>
          {buyError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{buyError}</div>
            </div>
          ) : null}
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onBuy}>
            {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="download" size={16} />} Mua với MoMo
          </button>
        </>
      )}
    </section>
  );
}
