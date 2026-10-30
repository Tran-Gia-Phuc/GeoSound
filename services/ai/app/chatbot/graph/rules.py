"""Rule-based parts of the chat graph (task #AI-46, chatbot-architecture.md section 3.2).

`classify`, `plan` and `cite` use no LLM: keyword lists in Vietnamese and
English (also matched without diacritics, since many users type Vietnamese
without accents). All functions are pure, so they are easy to unit test and
cost no quota.

Prompt-injection markers in the user text ("ignore previous instructions")
are not keywords of any intent, so they never change the intent.
"""

import re
import unicodedata
from typing import Any, Literal

from app.moderation.validator import clip, sanitize_text

Intent = Literal["search", "detail", "nearby", "smalltalk", "out_of_scope"]
DATA_INTENTS = frozenset({"search", "detail", "nearby"})

MESSAGE_MAX = 1000
QUERY_MAX = 200
ITEM_TEXT_MAX = 600
TOP_K = 5
NEARBY_RADIUS_M = 500

# Closed topic vocabulary of the index (section 4, layer 3).
TOPICS = (
    "history", "food", "architecture", "nature", "religion",
    "art", "culture", "shopping", "nightlife", "family",
)


def fold(text: str) -> str:
    """Lowercase, strip Vietnamese diacritics (đ -> d) and collapse spaces."""
    text = unicodedata.normalize("NFD", text.lower()).replace("đ", "d")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = unicodedata.normalize("NFC", text).replace("đ", "d")
    return re.sub(r"\s+", " ", text).strip()


def _pattern(words) -> re.Pattern:
    words = sorted(set(words), key=len, reverse=True)
    if not words:
        return re.compile(r"(?!)")  # matches nothing
    return re.compile(r"(?<!\w)(" + "|".join(re.escape(w) for w in words) + r")(?!\w)")


def _lower(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text.lower())).strip()


# Characters that only appear in Vietnamese text.
_VI_CHARS = re.compile(
    r"[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]",
    re.IGNORECASE,
)


class Keywords:
    """Keyword list matched on whole words, with or without Vietnamese accents.

    A message typed with accents is matched against the accented keywords, so
    "cho mình" never matches "chợ". A message typed without accents is matched
    against folded keywords, except single accented words, which are ambiguous
    once folded ("chua" = "chùa" or "chưa", "cho" = "chợ" or "cho").
    """

    def __init__(self, words: list[str]) -> None:
        lowered = {_lower(w) for w in words}
        self._accented = _pattern(lowered)
        self._folded = _pattern(
            fold(w) for w in lowered if not (_VI_CHARS.search(w) and " " not in w)
        )

    def search(self, text: str) -> bool:
        if _VI_CHARS.search(text):
            return bool(self._accented.search(_lower(text)))
        return bool(self._folded.search(fold(text)))


_VI_FUNCTION_WORDS = _pattern(fold(w) for w in [
    "toi", "minh", "ban", "khong", "nhung", "o dau", "di dau", "cho minh",
    "co gi", "nao", "duoc", "voi", "cua", "va", "la gi", "gan day", "xin chao",
    "cam on",
])

_SMALLTALK = Keywords([
    "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
    "thanks", "thank you", "bye", "goodbye", "how are you", "who are you",
    "what can you do",
    "xin chào", "chào", "chào bạn", "cảm ơn", "cám ơn", "tạm biệt",
    "bạn là ai", "bạn làm được gì", "bạn có thể làm gì", "khỏe không",
])

_OUT_OF_SCOPE = Keywords([
    # weather
    "weather", "forecast", "temperature", "thời tiết", "dự báo", "nhiệt độ",
    # coding, maths, homework
    "code", "coding", "program", "programming", "python", "javascript", "java",
    "sql", "algorithm", "debug", "math", "equation", "homework",
    "lập trình", "viết code", "thuật toán", "toán học", "bài tập",
    # finance, politics, news
    "stock", "stocks", "bitcoin", "crypto", "politics", "election", "news",
    "chứng khoán", "cổ phiếu", "tiền ảo", "chính trị", "bầu cử", "tin tức",
    # booking, payment, prices, personal data (section 1, out of scope)
    "booking", "book a", "reserve", "reservation", "price", "prices", "ticket",
    "payment", "refund", "password", "phone number",
    "đặt vé", "đặt chỗ", "giá vé", "bao nhiêu tiền", "thanh toán",
    "hoàn tiền", "mật khẩu", "số điện thoại",
])

_NEARBY = Keywords([
    "near", "nearby", "near me", "around", "close to", "next to",
    "walking distance", "around here",
    "gần", "gần đây", "gần nhất", "xung quanh", "quanh đây", "lân cận", "kế bên",
])

_DETAIL = Keywords([
    "tell me about", "what is", "what's", "describe", "explain", "details",
    "which stops", "stops of", "history of",
    "giới thiệu", "là gì", "kể về", "chi tiết", "những điểm dừng", "điểm dừng",
])

_DOMAIN = Keywords([
    "tour", "tours", "place", "places", "visit", "sightseeing", "attraction",
    "attractions", "landmark", "museum", "temple", "pagoda", "church", "market",
    "food", "street food", "walking", "cycling", "itinerary", "trip", "travel",
    "stop", "stops", "geosound",
    "địa điểm", "tham quan", "du lịch", "đi chơi", "bảo tàng", "chùa", "đền",
    "nhà thờ", "ẩm thực", "món ăn", "ăn uống", "đi bộ", "xe đạp", "lịch sử",
    "kiến trúc", "di tích", "cảnh đẹp", "chỗ chơi",
])

_HERE = Keywords(["here", "đây", "mình đang ở"])

# Known cities: alias -> canonical name. #AI-45 may pass names from City nodes.
CITY_ALIASES: dict[str, str] = {
    "hà nội": "Hanoi", "hanoi": "Hanoi",
    "hồ chí minh": "Ho Chi Minh City", "ho chi minh city": "Ho Chi Minh City",
    "sài gòn": "Ho Chi Minh City", "saigon": "Ho Chi Minh City", "hcm": "Ho Chi Minh City",
    "tphcm": "Ho Chi Minh City", "hcmc": "Ho Chi Minh City",
    "hội an": "Hoi An", "hoian": "Hoi An",
    "huế": "Hue", "đà nẵng": "Da Nang", "danang": "Da Nang",
    "nha trang": "Nha Trang", "đà lạt": "Da Lat", "dalat": "Da Lat",
    "hạ long": "Ha Long", "halong": "Ha Long", "cần thơ": "Can Tho",
    "phú quốc": "Phu Quoc", "sa pa": "Sa Pa", "sapa": "Sa Pa",
    "vũng tàu": "Vung Tau", "ninh bình": "Ninh Binh",
}

_TOUR_TYPES = {
    "walking": ["walking", "walk", "on foot", "đi bộ"],
    "cycling": ["cycling", "bike", "bicycle", "xe đạp"],
    "driving": ["driving", "drive", "by car", "motorbike", "ô tô", "xe máy", "lái xe"],
    "indoor": ["indoor", "inside", "trong nhà"],
}
_TYPE_PATTERNS = {t: Keywords(words) for t, words in _TOUR_TYPES.items()}

_TOPIC_WORDS = {
    "food": ["food", "eat", "eating", "cuisine", "street food", "ẩm thực", "món ăn", "ăn uống", "đồ ăn"],
    "history": ["history", "historic", "historical", "heritage", "lịch sử", "di tích", "di sản"],
    "architecture": ["architecture", "building", "buildings", "kiến trúc"],
    "nature": ["nature", "park", "garden", "lake", "beach", "thiên nhiên", "công viên", "hồ nước", "biển"],
    "religion": ["temple", "pagoda", "church", "religion", "religious", "chùa", "đền", "nhà thờ", "tôn giáo"],
    "art": ["art", "gallery", "painting", "nghệ thuật", "tranh"],
    "culture": ["culture", "cultural", "museum", "tradition", "văn hóa", "văn hoá", "bảo tàng", "truyền thống"],
    "shopping": ["shopping", "shop", "market", "mua sắm", "chợ"],
    "nightlife": ["nightlife", "night", "bar", "bars", "về đêm", "buổi tối"],
    "family": ["family", "kids", "children", "gia đình", "trẻ em"],
}
_TOPIC_PATTERNS = {t: Keywords(words) for t, words in _TOPIC_WORDS.items()}

_WORD_NUMBERS = {"one": 1, "an": 1, "a": 1, "two": 2, "three": 3, "four": 4, "half": 0.5}
_HOURS = re.compile(r"(?<!\w)(\d+(?:[.,]\d+)?|one|an|a|two|three|four|half)\s*(?:-\s*)?(h|hr|hrs|hour|hours|gio|tieng)(?!\w)")
_MINUTES = re.compile(r"(?<!\w)(\d+)\s*(min|mins|minute|minutes|phut)(?!\w)")
_HALF_DAY = Keywords(["half day", "half a day", "nửa ngày"])

_MARKER = re.compile(r"\[(tour|place):([^\[\]\s]{1,100})\]")
# Unfinished marker at the very end: "[", "[pla", "[tour:", "[place:p-1".
_DANGLING_MARKER = re.compile(
    r"\[(?:(?:tour|place):[^\[\]\s]{0,100}|t(?:o(?:ur?)?)?|p(?:l(?:a(?:ce?)?)?)?)?$")


# ---------- classify ----------

def detect_language(text: str) -> Literal["vi", "en"]:
    if _VI_CHARS.search(text):
        return "vi"
    return "vi" if len(_VI_FUNCTION_WORDS.findall(fold(text))) >= 2 else "en"


def find_city(text: str, aliases: dict[str, str] | None = None) -> str | None:
    folded = fold(text)
    table = aliases or CITY_ALIASES
    for alias in sorted(table, key=len, reverse=True):
        if re.search(r"(?<!\w)" + re.escape(fold(alias)) + r"(?!\w)", folded):
            return table[alias]
    return None


def classify(message: str, *, has_location: bool = False) -> Intent:
    """Pick the intent of one user message (no LLM)."""
    text = message
    domain = _DOMAIN.search(text)
    nearby = _NEARBY.search(text)
    smalltalk = _SMALLTALK.search(text)

    if _OUT_OF_SCOPE.search(text) and not domain:
        return "out_of_scope"
    if nearby or (has_location and domain and _HERE.search(text)):
        return "nearby"
    if smalltalk and not domain and len(text.split()) <= 8:
        return "smalltalk"
    if _DETAIL.search(text):
        return "detail"
    # Default: try the index; an empty result gives the polite "no data" answer.
    return "search"


# ---------- plan ----------

def _max_duration(message: str) -> int | None:
    if _HALF_DAY.search(message):
        return 240
    text = fold(message)
    match = _HOURS.search(text)
    if match:
        raw = match.group(1)
        value = _WORD_NUMBERS.get(raw)
        if value is None:
            value = float(raw.replace(",", "."))
        return int(round(value * 60))
    match = _MINUTES.search(text)
    return int(match.group(1)) if match else None


def build_filters(message: str, *, location: dict | None = None,
                  city_aliases: dict[str, str] | None = None) -> dict[str, Any]:
    """Filters of section 3.1: city, type, max_duration, topics, near, ref_ids."""
    text = message
    filters: dict[str, Any] = {"topics": [], "ref_ids": []}
    city = find_city(message, city_aliases)
    if city:
        filters["city"] = city
    for tour_type, pattern in _TYPE_PATTERNS.items():
        if pattern.search(text):
            filters["type"] = tour_type
            break
    duration = _max_duration(text)
    if duration is not None:
        filters["max_duration"] = duration
    filters["topics"] = [t for t, p in _TOPIC_PATTERNS.items() if p.search(text)][:5]
    if location:
        filters["near"] = {
            "lat": float(location["lat"]),
            "lng": float(location["lng"]),
            "radius_m": NEARBY_RADIUS_M,
        }
    return filters


def plan_tool_calls(intent: Intent, query: str, filters: dict, lang: str) -> list[dict]:
    """Deterministic tool plan: a list of {name, args, role?} run in order by `retrieve`."""
    if intent not in DATA_INTENTS:
        return []
    common = {"language": lang}
    if filters.get("city"):
        common["city"] = filters["city"]
    if filters.get("topics"):
        common["topics"] = list(filters["topics"])

    if intent == "nearby":
        near = filters.get("near")
        if near:
            # Coordinates are filled in by `retrieve` from the request, so the
            # stored plan never holds the user's location.
            return [{"name": "nearby_places", "role": "from_location",
                     "args": {"radius_m": near["radius_m"], "k": TOP_K}}]
        # No coordinate: find the anchor place by text, then its neighbours.
        return [
            {"name": "search_places", "role": "anchor",
             "args": {"query": query, "k": 1, "language": lang,
                      **({"city": filters["city"]} if filters.get("city") else {})}},
            {"name": "nearby_places", "role": "from_anchor",
             "args": {"radius_m": NEARBY_RADIUS_M, "k": TOP_K}},
        ]

    tour_args = {"query": query, "k": TOP_K, **common}
    if filters.get("type"):
        tour_args["type"] = filters["type"]
    if filters.get("max_duration") is not None:
        tour_args["max_duration_minutes"] = filters["max_duration"]
    return [
        {"name": "search_tours", "args": tour_args},
        {"name": "search_places", "args": {"query": query, "k": TOP_K, **common}},
    ]


def make_query(message: str) -> str:
    return clip(sanitize_text(message), QUERY_MAX) or "tour"


# ---------- retrieve helpers ----------

def to_item(tool: str, row: dict) -> dict:
    """Normalise a tool row into a retrieved item {kind, id, title, text, score, hops}."""
    if tool == "search_tours":
        facts = []
        if row.get("city"):
            facts.append(f"city: {row['city']}")
        if row.get("type"):
            facts.append(f"type: {row['type']}")
        if row.get("duration_minutes") is not None:
            facts.append(f"duration: {row['duration_minutes']} min")
        text = "; ".join(facts) + (". " if facts else "") + (row.get("snippet") or "")
        return {"kind": "tour", "id": str(row["tour_id"]), "title": row.get("title") or "",
                "text": clip(text, ITEM_TEXT_MAX), "score": float(row.get("score") or 0.0),
                "hops": int(row.get("hops") or 0)}
    facts = []
    if row.get("type"):
        facts.append(f"type: {row['type']}")
    if row.get("distance_m") is not None:
        facts.append(f"distance: {round(row['distance_m'])} m")
    text = "; ".join(facts) + (". " if facts else "") + (row.get("snippet") or "")
    item = {"kind": "place", "id": str(row["place_id"]), "title": row.get("name") or "",
            "text": clip(text, ITEM_TEXT_MAX), "score": float(row.get("score") or 0.0),
            "hops": int(row.get("hops") or 0)}
    if row.get("tour_id"):
        item["tour_id"] = str(row["tour_id"])
    if row.get("distance_m") is not None:
        item["distance_m"] = float(row["distance_m"])
    return item


def merge_items(items: list[dict], k: int = TOP_K) -> list[dict]:
    """Deduplicate by (kind, id) keeping the best score; keep tool order for ties; top k."""
    best: dict[tuple[str, str], dict] = {}
    order: list[tuple[str, str]] = []
    for item in items:
        key = (item["kind"], item["id"])
        if key not in best:
            order.append(key)
            best[key] = item
        elif item["score"] > best[key]["score"]:
            best[key] = item
    ranked = sorted(order, key=lambda key: -best[key]["score"])
    return [best[key] for key in ranked[:k]]


# ---------- cite ----------

def cite(answer: str, retrieved: list[dict]) -> tuple[str, list[dict]]:
    """Return (answer without invented markers, citations).

    Citations are retrieved items mentioned in the answer, as a `[kind:id]`
    marker or as the bare id, in order of first mention. Markers whose id was
    not retrieved are removed from the text.
    """
    known = {(item["kind"], item["id"]): item for item in retrieved}

    def _keep(match: re.Match) -> str:
        return match.group(0) if (match.group(1), match.group(2)) in known else ""

    cleaned = _MARKER.sub(_keep, answer)
    # An answer cut by the token limit can end inside a marker ("[tour:abc-"): drop it.
    cleaned = _DANGLING_MARKER.sub("", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).replace(" .", ".").strip()

    positions: list[tuple[int, dict]] = []
    for (kind, item_id), item in known.items():
        marker = cleaned.find(f"[{kind}:{item_id}]")
        bare = re.search(r"(?<![\w-])" + re.escape(item_id) + r"(?![\w-])", cleaned)
        hits = [p for p in (marker, bare.start() if bare else -1) if p >= 0]
        if hits:
            positions.append((min(hits), item))
    positions.sort(key=lambda pair: pair[0])
    citations = [{"kind": item["kind"], "id": item["id"], "title": item["title"]}
                 for _, item in positions]
    return cleaned, citations
