"""Input hardening for moderation text (task #AI-28).

- length limits of the contract; the place (#AI-29) and tour (#AI-31) schemas
  in schema.py import them; 422 is raised by Pydantic
- neutralise delimiter break-out (e.g. "</content>") before building prompts

All functions are pure.
"""

import re
import unicodedata

TITLE_MAX = 200
TOUR_DESCRIPTION_MAX = 5000
PLACE_NAME_MAX = 200
PLACE_DESCRIPTION_MAX = 2000
MAX_PLACES = 50
MAX_IMAGES = 5
# Each place description is cut to this length inside a tour scan.
TOUR_PLACE_SNIPPET = 300

# C0/C1 control characters except \t (0x09) and \n (0x0a).
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")

# Angle brackets are replaced so user text can never open or close a prompt tag.
_BRACKETS = str.maketrans({"<": "‹", ">": "›"})


def clip(text: str, limit: int) -> str:
    """Strip and cut text to at most `limit` characters. Never raises."""
    if not text or limit <= 0:
        return ""
    return text.strip()[:limit]


def sanitize_text(text: str) -> str:
    """Normalise user text so it is safe to embed inside prompt delimiters.

    NFKC folds look-alikes (e.g. fullwidth "＜") into ASCII first, then control
    characters are removed and every "<" / ">" becomes "‹" / "›".
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_CHARS.sub("", text)
    return text.translate(_BRACKETS)


def wrap(tag: str, text: str) -> str:
    """Wrap sanitised user text in <tag>...</tag> for a prompt."""
    return f"<{tag}>\n{sanitize_text(text)}\n</{tag}>"
