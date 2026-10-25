import asyncio

import httpx
import pytest

from app.events.tour_client import (
    TourClient,
    TourContentError,
    TourNotFoundError,
    TourServiceError,
)

TOUR_ID = "11111111-1111-1111-1111-111111111111"

GOOD = {
    "tourId": TOUR_ID,
    "title": "Pho co Ha Noi",
    "description": "Dao pho co.",
    "language": "vi",
    "stops": [
        {"stopId": "s1", "description": "Cho Dong Xuan"},
        {"stopId": "s2", "description": "Ho Guom"},
    ],
}


def fetch(handler, tour_id=TOUR_ID):
    client = TourClient(
        base_url="http://tour:3002",
        token="secret",
        transport=httpx.MockTransport(handler),
    )
    return asyncio.run(client.fetch_for_moderation(tour_id))


def test_success_maps_fields_and_sends_token():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["token"] = request.headers.get("x-internal-token")
        return httpx.Response(200, json=GOOD)

    req = fetch(handler)
    assert seen["url"] == f"http://tour:3002/internal/tours/{TOUR_ID}/moderation-content"
    assert seen["token"] == "secret"
    assert req.tour_id == TOUR_ID
    assert req.title == "Pho co Ha Noi"
    assert req.language.value == "vi"
    assert [s.stop_id for s in req.stops] == ["s1", "s2"]


@pytest.mark.parametrize(
    "raw,expected", [("vi-VN", "vi"), ("EN", "en"), ("fr", "en"), (None, "en")]
)
def test_language_mapping(raw, expected):
    body = {**GOOD, "language": raw}
    req = fetch(lambda r: httpx.Response(200, json=body))
    assert req.language.value == expected


def test_not_found():
    with pytest.raises(TourNotFoundError):
        fetch(lambda r: httpx.Response(404, json={"error": "Not found"}))


def test_server_error_is_transient():
    with pytest.raises(TourServiceError):
        fetch(lambda r: httpx.Response(500))


def test_bad_token_is_a_service_error():
    with pytest.raises(TourServiceError):
        fetch(lambda r: httpx.Response(401, json={"error": "Invalid token"}))


def test_transport_error_is_transient():
    def handler(request):
        raise httpx.ConnectTimeout("timeout")

    with pytest.raises(TourServiceError):
        fetch(handler)


def test_invalid_content_is_permanent():
    body = {**GOOD, "title": ""}
    with pytest.raises(TourContentError):
        fetch(lambda r: httpx.Response(200, json=body))


def test_non_json_body_is_permanent():
    with pytest.raises(TourContentError):
        fetch(lambda r: httpx.Response(200, text="not json"))


def test_non_object_body_is_permanent():
    with pytest.raises(TourContentError):
        fetch(lambda r: httpx.Response(200, json=["x"]))


def test_tour_id_is_url_quoted():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(404)

    with pytest.raises(TourNotFoundError):
        fetch(handler, tour_id="a/b?x")
    assert "/internal/tours/a%2Fb%3Fx/moderation-content" in seen["url"]
