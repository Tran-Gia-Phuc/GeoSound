"""Image fetching and validation (task #AI-41). httpx.MockTransport only, no real network."""

import asyncio
import logging

import httpx
import pytest

from app.config import Settings
from app.moderation.images import (
    FetchedImage,
    ImageProblem,
    check_url,
    fetch_images,
    make_image_fetcher,
    sniff_mime_type,
)
from tests.conftest import JPEG_BYTES, PNG_BYTES, WEBP_BYTES

HOST = "abc.supabase.co"
HOSTS = frozenset({HOST})
BASE = f"https://{HOST}/storage/v1/object/public/places"
MAX = 1000


def fetch(urls, handler, *, hosts=HOSTS, max_bytes=MAX, timeout=5.0):
    seen = []

    def recording(request):
        seen.append(request)
        return handler(request)

    async def go():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(recording), follow_redirects=False
        ) as client:
            return await fetch_images(
                urls, client=client, allowed_hosts=hosts, max_bytes=max_bytes, timeout=timeout
            )

    return asyncio.run(go()), seen


def image(body, mime):
    return lambda request: httpx.Response(200, headers={"content-type": mime}, content=body)


def single(url, handler, **kwargs):
    results, seen = fetch([url], handler, **kwargs)
    assert len(results) == 1
    return results[0], seen


def assert_problem(result, kind):
    assert isinstance(result, ImageProblem), result
    assert result.kind == kind
    assert result.index == 0


# ---- ok -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "body,mime",
    [
        (JPEG_BYTES, "image/jpeg"),
        (PNG_BYTES, "image/png"),
        (WEBP_BYTES, "image/webp"),
        (JPEG_BYTES, "image/jpeg; charset=binary"),
        (PNG_BYTES, "IMAGE/PNG"),
    ],
)
def test_allowed_images_are_fetched(body, mime):
    result, seen = single(f"{BASE}/a", image(body, mime))
    assert isinstance(result, FetchedImage)
    assert result.index == 0
    assert result.data == body
    assert result.mime_type == mime.split(";")[0].lower()
    assert len(seen) == 1


def test_results_keep_input_order_and_indexes():
    def handler(request):
        if request.url.path.endswith("/1"):
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": "image/png"}, content=PNG_BYTES)

    results, seen = fetch([f"{BASE}/0", f"{BASE}/1", f"{BASE}/2"], handler)
    assert [r.index for r in results] == [0, 1, 2]
    assert [type(r) for r in results] == [FetchedImage, ImageProblem, FetchedImage]
    assert len(seen) == 3


def test_host_match_is_case_insensitive():
    result, _ = single("https://ABC.Supabase.CO/x", image(JPEG_BYTES, "image/jpeg"))
    assert isinstance(result, FetchedImage)


def test_explicit_port_443_is_allowed():
    result, _ = single(f"https://{HOST}:443/x", image(JPEG_BYTES, "image/jpeg"))
    assert isinstance(result, FetchedImage)


# ---- permanent: URL rules (no request is made) -------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        f"http://{HOST}/a.jpg",  # not https
        "ftp://abc.supabase.co/a.jpg",
        "https://evil.example.com/a.jpg",  # host not allowed
        "https://abc.supabase.co.evil.com/a.jpg",  # suffix trick
        "https://evil.com/abc.supabase.co/a.jpg",
        f"https://user:pw@{HOST}/a.jpg",  # userinfo
        f"https://{HOST}@evil.com/a.jpg",
        f"https://{HOST}:8443/a.jpg",  # other port
        f"https://{HOST}:99999/a.jpg",  # invalid port
        "not a url",
        "https:///a.jpg",
    ],
)
def test_url_rules_are_permanent_and_make_no_request(url):
    result, seen = single(url, image(JPEG_BYTES, "image/jpeg"))
    assert_problem(result, "permanent")
    assert seen == []


def test_empty_allowlist_refuses_everything():
    result, seen = single(f"{BASE}/a", image(JPEG_BYTES, "image/jpeg"), hosts=frozenset())
    assert_problem(result, "permanent")
    assert seen == []


def test_check_url_accepts_allowed_https_url():
    assert check_url(f"{BASE}/a.jpg?token=x", HOSTS) is None


# ---- permanent / temporary: HTTP status ---------------------------------------


@pytest.mark.parametrize("status", [301, 302, 307, 308])
def test_redirect_is_permanent_and_not_followed(status):
    handler = lambda request: httpx.Response(status, headers={"location": f"{BASE}/other"})
    result, seen = single(f"{BASE}/a", handler)
    assert_problem(result, "permanent")
    assert len(seen) == 1  # the redirect target is never requested


@pytest.mark.parametrize("status", [400, 403, 404, 410])
def test_client_errors_are_permanent(status):
    result, _ = single(f"{BASE}/a", lambda request: httpx.Response(status))
    assert_problem(result, "permanent")


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_rate_limit_and_server_errors_are_temporary(status):
    result, _ = single(f"{BASE}/a", lambda request: httpx.Response(status))
    assert_problem(result, "temporary")


@pytest.mark.parametrize(
    "error", [httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError, httpx.ReadError]
)
def test_timeout_and_network_errors_are_temporary(error):
    def handler(request):
        raise error("boom", request=request)

    result, _ = single(f"{BASE}/a", handler)
    assert_problem(result, "temporary")


def test_total_timeout_per_image_is_temporary():
    async def slow():
        yield JPEG_BYTES[:4]
        await asyncio.sleep(5)
        yield JPEG_BYTES[4:]

    handler = lambda request: httpx.Response(
        200, headers={"content-type": "image/jpeg"}, content=slow()
    )
    result, _ = single(f"{BASE}/a", handler, timeout=0.05)
    assert_problem(result, "temporary")


# ---- permanent: content ---------------------------------------------------------


@pytest.mark.parametrize("mime", ["image/gif", "text/html", "image/svg+xml", ""])
def test_wrong_content_type_is_permanent(mime):
    headers = {"content-type": mime} if mime else {}
    result, _ = single(f"{BASE}/a", lambda r: httpx.Response(200, headers=headers, content=JPEG_BYTES))
    assert_problem(result, "permanent")


@pytest.mark.parametrize(
    "body,mime",
    [
        (PNG_BYTES, "image/jpeg"),  # declared jpeg, really png
        (b"<html>not an image</html>", "image/png"),
        (b"GIF89a" + b"\x00" * 20, "image/webp"),
        (b"", "image/jpeg"),
    ],
)
def test_magic_bytes_must_match_declared_type(body, mime):
    result, _ = single(f"{BASE}/a", image(body, mime))
    assert_problem(result, "permanent")


def test_too_large_by_content_length_is_permanent():
    result, _ = single(f"{BASE}/a", image(JPEG_BYTES + b"\x00" * MAX, "image/jpeg"))
    assert_problem(result, "permanent")


def test_too_large_stream_is_cut_without_reading_everything():
    produced = []

    async def endless():
        yield JPEG_BYTES
        for _ in range(1000):
            produced.append(1)
            yield b"\x00" * 400

    handler = lambda request: httpx.Response(
        200, headers={"content-type": "image/jpeg"}, content=endless()
    )
    result, _ = single(f"{BASE}/a", handler)
    assert_problem(result, "permanent")
    assert result.reason == "image too large"
    assert len(produced) < 10


def test_exactly_max_bytes_is_allowed():
    body = JPEG_BYTES + b"\x00" * (MAX - len(JPEG_BYTES))
    result, _ = single(f"{BASE}/a", image(body, "image/jpeg"))
    assert isinstance(result, FetchedImage)


def test_sniff_mime_type():
    assert sniff_mime_type(JPEG_BYTES) == "image/jpeg"
    assert sniff_mime_type(PNG_BYTES) == "image/png"
    assert sniff_mime_type(WEBP_BYTES) == "image/webp"
    assert sniff_mime_type(b"RIFF\x00\x00\x00\x00WAVE") is None
    assert sniff_mime_type(b"") is None


# ---- logging ---------------------------------------------------------------------


def test_logs_never_contain_the_full_url(caplog):
    caplog.set_level(logging.INFO, logger="app.moderation.images")
    secret = "token=very-secret-value"
    single(f"{BASE}/a.jpg?{secret}", lambda r: httpx.Response(404))
    single(f"{BASE}/b.jpg?{secret}", image(JPEG_BYTES, "image/jpeg"))
    text = caplog.text
    assert HOST in text
    assert secret not in text
    assert "/storage/v1/" not in text


# ---- settings: allowlist ---------------------------------------------------------


def settings(**values):
    return Settings(_env_file=None, **values)


def test_allowlist_parsing():
    s = settings(image_allowed_hosts=" A.example.com, b.example.com. ,, ")
    assert s.allowed_image_hosts() == frozenset({"a.example.com", "b.example.com"})


def test_allowlist_wins_over_supabase_url():
    s = settings(image_allowed_hosts="a.example.com", supabase_url="https://abc.supabase.co")
    assert s.allowed_image_hosts() == frozenset({"a.example.com"})


def test_host_is_derived_from_supabase_url_when_allowlist_empty():
    s = settings(image_allowed_hosts="", supabase_url="https://ABC.supabase.co/")
    assert s.allowed_image_hosts() == frozenset({"abc.supabase.co"})


@pytest.mark.parametrize("url", ["", "   ", "not a url"])
def test_no_hosts_when_nothing_is_configured(url):
    assert settings(image_allowed_hosts="", supabase_url=url).allowed_image_hosts() == frozenset()


def test_settings_defaults():
    s = settings()
    assert s.image_max_bytes == 3 * 1024 * 1024
    assert s.image_fetch_timeout_seconds == 10.0


def test_make_image_fetcher_uses_settings_and_transport(monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("IMAGE_ALLOWED_HOSTS", "")
    monkeypatch.setenv("SUPABASE_URL", f"https://{HOST}")
    get_settings.cache_clear()
    try:
        transport = httpx.MockTransport(image(JPEG_BYTES, "image/jpeg"))
        fetcher = make_image_fetcher(transport=transport)
        results = asyncio.run(fetcher([f"{BASE}/a", "https://other.example.com/b"]))
    finally:
        get_settings.cache_clear()
    assert isinstance(results[0], FetchedImage)
    assert isinstance(results[1], ImageProblem) and results[1].kind == "permanent"
