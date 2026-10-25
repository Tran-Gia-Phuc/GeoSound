// Định tuyến client.
//   /                   — trang chủ
//   /login              — đăng nhập / đăng ký (UC01)
//   /tours              — tìm & duyệt tour (UC02)
//   /tour/:id           — chi tiết tour (UC02)
//   /tour/:id/play      — trình nghe tour (UC04)
//   /explore            — khám phá địa điểm lẻ (UC07)
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
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import HomePage from './features/home/HomePage.jsx';
import ToursPage from './features/tours/ToursPage.jsx';
import TourDetailPage from './features/tours/TourDetailPage.jsx';
import TourPlayerPage from './features/player/TourPlayerPage.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import ExplorePage from './features/explore/ExplorePage.jsx';
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

// UC04 mở từ chi tiết tour (UC02) — thoát thì quay về chi tiết tour.
function PlayTourRoute() {
  const { tourId } = useParams();
  return <TourPlayerPage backTo={`/tour/${tourId}`} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/tours" element={<ToursPage />} />
        <Route path="/tour/:tourId" element={<TourDetailPage />} />
        <Route path="/tour/:tourId/play" element={<PlayTourRoute />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/itineraries" element={<RequireAuth><ItinerariesPage /></RequireAuth>} />
        <Route path="/itineraries/:id" element={<RequireAuth><ItineraryEditorPage /></RequireAuth>} />
        <Route path="/itinerary/:id/go" element={<RequireAuth><ItineraryPlayerPage /></RequireAuth>} />
        <Route path="/shared/:token" element={<SharedItineraryPage />} />
        <Route path="/shared/:token/go" element={<SharedItineraryPlayerPage />} />
        <Route path="/studio" element={<RequireContributor><StudioToursPage /></RequireContributor>} />
        <Route path="/studio/tours/new" element={<RequireContributor><TourCreatePage /></RequireContributor>} />
        <Route path="/studio/tours/:id" element={<RequireContributor><TourEditorPage /></RequireContributor>} />
        <Route path="/studio/tours/:id/places" element={<RequireContributor><PlacesManagerPage /></RequireContributor>} />
        <Route path="/studio/tours/:id/route" element={<RequireContributor><RouteConfigPage /></RequireContributor>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
