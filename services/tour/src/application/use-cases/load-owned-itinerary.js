// UC07 — Nạp lịch trình + kiểm quyền sở hữu (dùng chung cho các use-case sửa/đọc
// của chủ sở hữu). 404 nếu không có; 403 nếu không phải của mình.
import { ItineraryNotFoundError, NotItineraryOwnerError } from '../../domain/errors/index.js';

export async function loadOwnedItinerary(itineraryRepo, { ownerId, itineraryId }) {
  const itinerary = await itineraryRepo.findById(itineraryId);
  if (!itinerary) throw new ItineraryNotFoundError();
  if (!itinerary.isOwnedBy(ownerId)) throw new NotItineraryOwnerError();
  return itinerary;
}
