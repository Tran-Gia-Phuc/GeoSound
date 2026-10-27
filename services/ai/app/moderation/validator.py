"""Input hardening for moderation text (task #AI-12).

- enforce length limits (title 200, tour description 5000, place name 200,
  place description 2000, at most 50 places, at most 5 images)
- neutralise delimiter break-out (e.g. "</content>") before building prompts
"""


def sanitize_text(text: str) -> str:
    raise NotImplementedError("#AI-12")


def clip(text: str, limit: int) -> str:
    raise NotImplementedError("#AI-12")
