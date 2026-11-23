// =========================================================
// PaymentReturnPage (UC25, #446) — /payment/momo, where MoMo sends the buyer back
// (?orderId=...&resultCode=...). The query string is not trusted: the page asks
// the server (GET /api/tours/payments/:orderId, which asks MoMo while pending) and
// polls every 2 s for up to 1 minute while the order is pending.
// =========================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import { formatVnd, getPaymentStatus } from '../../lib/payment.js';

const POLL_MS = 2000;
const POLL_MAX = 30;

export default function PaymentReturnPage() {
  const [params] = useSearchParams();
  const orderId = params.get('orderId') || '';
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [gaveUp, setGaveUp] = useState(false);
  const tries = useRef(0);

  const check = useCallback(async () => {
    setError('');
    try {
      const o = await getPaymentStatus(orderId);
      setOrder(o);
      return o.status;
    } catch (e) {
      setError(e?.offline ? 'Không thể kết nối, vui lòng thử lại' : e?.message || 'Chưa kiểm tra được thanh toán');
      return 'error';
    }
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return undefined;
    let timer;
    let stop = false;
    tries.current = 0;
    setGaveUp(false);
    const tick = async () => {
      const status = await check();
      if (stop || status !== 'pending') return;
      tries.current += 1;
      if (tries.current >= POLL_MAX) setGaveUp(true);
      else timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [orderId, check]);

  const tourLink = order ? `/tour/${encodeURIComponent(order.tourId)}` : '/';
  let body;
  if (!orderId) {
    body = <p>Không tìm thấy mã đơn thanh toán.</p>;
  } else if (error) {
    body = (
      <div className="alert alert--warn" role="alert">
        <Icon name="alert-triangle" size={18} className="alert__icon" />
        <div>{error}</div>
        <button className="btn btn--sm" onClick={check}>Thử lại</button>
      </div>
    );
  } else if (!order || (order.status === 'pending' && !gaveUp)) {
    body = <p className="muted"><Icon name="loader" size={16} className="spin" /> Đang chờ MoMo xác nhận thanh toán…</p>;
  } else if (order.status === 'paid') {
    body = (
      <>
        <div className="alert" role="status">
          <Icon name="check-circle" size={18} className="alert__icon" />
          <div>Thanh toán thành công {formatVnd(order.amount)}. Bạn đã có thể tải tour về nghe offline.</div>
        </div>
        <Link className="btn btn--primary" to={tourLink}><Icon name="download" size={16} /> Về trang tour để tải</Link>
      </>
    );
  } else if (order.status === 'pending') {
    body = (
      <>
        <p>MoMo chưa xác nhận thanh toán. Nếu bạn đã trả tiền, hãy kiểm tra lại sau ít phút.</p>
        <button className="btn" onClick={check}>Kiểm tra lại</button>
      </>
    );
  } else {
    body = (
      <>
        <div className="alert alert--warn" role="alert">
          <Icon name="alert-triangle" size={18} className="alert__icon" />
          <div>Thanh toán chưa thành công hoặc đã bị huỷ. Bạn chưa bị trừ tiền cho đơn này.</div>
        </div>
        <Link className="btn" to={tourLink}>Quay lại tour</Link>
      </>
    );
  }

  return (
    <div className="page page--narrow" aria-labelledby="pay-h">
      <h1 id="pay-h">Thanh toán MoMo</h1>
      {body}
    </div>
  );
}
