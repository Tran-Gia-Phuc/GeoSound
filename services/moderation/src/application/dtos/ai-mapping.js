// Event payload (camelCase) <-> AI HTTP body (snake_case, same as /translate).
// AI wire: place_id, tour_id, places[{place_id,name,description}], images_checked.
// Task #AI-27. This is the ONLY place that converts naming.
export function toAiPlaceRequest(event) { throw new Error('not implemented: #AI-27'); }
export function toAiTourRequest(event) { throw new Error('not implemented: #AI-27'); }
export function fromAiResponse(body) { throw new Error('not implemented: #AI-27'); }
