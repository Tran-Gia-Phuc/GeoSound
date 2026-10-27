import pytest

pytestmark = pytest.mark.skip(reason="#AI-24 (phase 2) not implemented yet")


def test_placeholder():
    """Use httpx.MockTransport for downloads; no real network."""
