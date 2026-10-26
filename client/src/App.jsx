// Định tuyến client. Màn thường nằm trong AppLayout (thanh tab dưới ở điện thoại,
// thanh trên ở desktop); màn chi tiết có thanh hành động riêng dùng AppLayout
// tabs={false}; trình phát / đăng nhập là toàn màn hình.
//   /account            — tài khoản + giao diện sáng/tối
//   /                   — Khám phá: tìm tour + địa điểm (UC02, UC07) — ?tab=&q=&city=…
//   /login, /register   — đăng nhập / đăng ký (chọn vai trò) (UC01)
//   /forgot-password    — quên mật khẩu (UC01 A2)
//   /tours, /explore    — chuyển hướng về / (giữ tham số)
//   /tour/:id           — chi tiết tour (UC02)
//   /tour/:id/play      — trình nghe tour (UC04)
//   /itineraries        — lịch trình của tôi (UC07, cần đăng nhập)
//   /itineraries/:id    — chỉnh sửa lịch trình (UC07, cần đăng nhập)
//   /shared/:token      — xem lịch trình được chia sẻ (UC07/A4, công khai)
//   /itinerary/:id/go   — đi theo lịch trình của tôi (UC08, cần đăng nhập)
//   /shared/:token/go   — đi theo lịch trình được chia sẻ (UC08, công khai)
//   /studio             — tour của tôi (UC09, chỉ người đóng góp)
//   /studio/tours/new   — tạo tour (UC09)
//   /studio/tours/:id   — chỉnh sửa tour (UC09)
//   /studio/tours/:id/places — quản lý điểm dừng (UC10)
//   /studio/tours/:id/route  — route & vùng kích hoạt (UC11)
//   /studio/tours/:id/languages — ngôn ngữ & TTS (UC12)
//   /studio/tours/:tourId/preview — xem thử tour (UC13)
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import DiscoverPage from './features/discover/DiscoverPage.jsx';
import TourDetailPage from './features/tours/TourDetailPage.jsx';
import TourPlayerPage from './features/player/TourPlayerPage.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import ForgotPasswordPage from './features/auth/ForgotPasswordPage.jsx';
import ItinerariesPage from './features/itineraries/ItinerariesPage.jsx';
import ItineraryEditorPage from './features/itineraries/ItineraryEditorPage.jsx';
import SharedItineraryPage from './features/itineraries/SharedItineraryPage.jsx';
import ItineraryPlayerPage from './features/itineraries/ItineraryPlayerPage.jsx';
import SharedItineraryPlayerPage from './features/itineraries/SharedItineraryPlayerPage.jsx';
import RequireAuth from './auth/RequireAuth.jsx';
import RequireContributor from './auth/RequireContributor.jsx';
import StudioToursPage from './features/studio/StudioToursPage.jsx';
import TourCreatePage from './features/studio/TourCreatePage.jsx';
import TourEditorPage from './features/studio/TourEditorPage.jsx';
import PlacesManagerPage from './features/studio/PlacesManagerPage.jsx';
import RouteConfigPage from './features/studio/RouteConfigPage.jsx';
import LanguagesPage from './features/studio/LanguagesPage.jsx';
import AccountPage from './features/account/AccountPage.jsx';
import AppLayout from './components/shell/AppLayout.jsx';
import { previewTour } from './lib/studio.js';

// /tours và /explore cũ → màn Khám phá (giữ tham số; /explore mở tab Địa điểm).
function RedirectToDiscover({ tab }) {
  const { search, state } = useLocation();
  const sp = new URLSearchParams(search);
  if (tab) sp.set('tab', tab);
  const qs = sp.toString();
  return <Navigate to={`/${qs ? `?${qs}` : ''}`} state={state} replace />;
}

// UC04 mở từ chi tiết tour (UC02) — thoát thì quay về chi tiết tour.
function PlayTourRoute() {
  const { tourId } = useParams();
  return <TourPlayerPage backTo={`/tour/${tourId}`} backLabel="Chi tiết tour" />;
}

// UC13 — xem thử tour của chính tác giả: tái dùng trình phát UC04 nhưng nguồn là
// endpoint preview (mọi trạng thái); thoát quay về trình chỉnh sửa tour.
// E1 (422 — chưa có điểm dừng; route đã tự sinh): dẫn thẳng tới bước thêm điểm.
function PreviewTourRoute() {
  const { tourId } = useParams();
  const base = `/studio/tours/${tourId}`;
  return (
    <TourPlayerPage
      loadDetail={(lang, opts) => previewTour(tourId, lang, opts)}
      progressKey={`studio-preview:${tourId}`}
      backTo={base}
      backLabel="Về trình chỉnh sửa"
      remember={false}
      allowSimulation
      modeLabels={{ gps: 'Xem thử (GPS)', remote: 'Xem thử từ xa' }}
      errorActions={(err) =>
        err.status === 422 ? (
          <Link className="btn btn--primary" to={`${base}/places`}>Thêm điểm dừng</Link>
        ) : null
      }
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Màn gốc của các tab */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<DiscoverPage />} />
          <Route path="/tours" element={<RedirectToDiscover />} />
          <Route path="/explore" element={<RedirectToDiscover tab="places" />} />
          <Route path="/itineraries" element={<RequireAuth><ItinerariesPage /></RequireAuth>} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/studio" element={<RequireContributor><StudioToursPage /></RequireContributor>} />
          <Route path="/studio/tours/new" element={<RequireContributor><TourCreatePage /></RequireContributor>} />
          <Route path="/studio/tours/:id" element={<RequireContributor><TourEditorPage /></RequireContributor>} />
          <Route path="/studio/tours/:id/places" element={<RequireContributor><PlacesManagerPage /></RequireContributor>} />
          <Route path="/studio/tours/:id/route" element={<RequireContributor><RouteConfigPage /></RequireContributor>} />
          <Route path="/studio/tours/:id/languages" element={<RequireContributor><LanguagesPage /></RequireContributor>} />
        </Route>

        {/* Màn chi tiết có thanh hành động riêng ở đáy: ẩn tab dưới */}
        <Route element={<AppLayout tabs={false} />}>
          <Route path="/tour/:tourId" element={<TourDetailPage />} />
          <Route path="/itineraries/:id" element={<RequireAuth><ItineraryEditorPage /></RequireAuth>} />
          <Route path="/shared/:token" element={<SharedItineraryPage />} />
        </Route>

        {/* Toàn màn hình */}
        <Route path="/login" element={<LoginPage key="login" initialTab="login" />} />
        <Route path="/register" element={<LoginPage key="register" initialTab="register" />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/tour/:tourId/play" element={<PlayTourRoute />} />
        <Route path="/itinerary/:id/go" element={<RequireAuth><ItineraryPlayerPage /></RequireAuth>} />
        <Route path="/shared/:token/go" element={<SharedItineraryPlayerPage />} />
        <Route path="/studio/tours/:tourId/preview" element={<RequireContributor><PreviewTourRoute /></RequireContributor>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
