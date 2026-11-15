"""Multi-layer knowledge graph of one public tour (task #AI-44).

Layers (docs/02-design/chatbot-architecture.md section 4):

1. Structure: City -has-> Tour, Tour -has_stop{sequence}-> Place, Place -is_a-> PlaceType
2. Space: Place -near{meters}-> Place when meters < 1000, both directions, at most
   10 nearest per new place, against the tour's own places and places of other
   already indexed tours (passed in by the caller)
3. Meaning: Tour/Place -about-> Topic, from a TopicExtractor (optional)

`build_graph` is pure: no I/O, no LLM. Every text stored in a node is sanitised.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Protocol

from app.chatbot.rag.models import (
    MAX_PLACE_TOPICS,
    MAX_TOUR_TOPICS,
    TOPICS,
    Edge,
    Node,
    PlaceLocation,
    TopicAssignment,
    TourDoc,
    place_node_id,
    tour_node_id,
)
from app.moderation.validator import clip, sanitize_text

NEAR_METERS = 1000.0
MAX_NEAR_PER_PLACE = 10
EARTH_RADIUS_M = 6_371_000.0
_METERS_PER_DEG_LAT = 111_320.0


class TopicExtractor(Protocol):
    """Finds topics of a tour and its places (one LLM call per tour, later).

    Returns None when extraction was skipped (quota, busy queue): the tour is
    then indexed with `topics_pending = True`. Must not raise for a skip.
    """

    async def extract(self, doc: TourDoc) -> TopicAssignment | None: ...


@dataclass(frozen=True)
class BBox:
    min_lat: float
    max_lat: float
    min_lng: float
    max_lng: float

    def contains(self, lat: float, lng: float) -> bool:
        return self.min_lat <= lat <= self.max_lat and self.min_lng <= lng <= self.max_lng


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def near_bbox(points: Iterable[tuple[float, float]], meters: float = NEAR_METERS) -> BBox | None:
    """Bounding box around `points`, padded by `meters` (prefilter for near edges)."""
    pts = list(points)
    if not pts:
        return None
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    pad_lat = meters / _METERS_PER_DEG_LAT
    widest = max(abs(min(lats)), abs(max(lats)))
    cos_lat = max(math.cos(math.radians(min(widest + pad_lat, 89.9))), 0.01)
    pad_lng = meters / (_METERS_PER_DEG_LAT * cos_lat)
    return BBox(
        min_lat=max(-90.0, min(lats) - pad_lat),
        max_lat=min(90.0, max(lats) + pad_lat),
        min_lng=max(-180.0, min(lngs) - pad_lng),
        max_lng=min(180.0, max(lngs) + pad_lng),
    )


def slugify(value: str) -> str:
    """Normalised key for shared nodes: 'Hồ Chí Minh' -> 'ho-chi-minh'."""
    value = unicodedata.normalize("NFKD", value.replace("đ", "d").replace("Đ", "D"))
    value = "".join(c for c in value if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")[:100]


def clean_topics(topics: Iterable[str], cap: int) -> tuple[str, ...]:
    """Keep known topics only, in order, without duplicates, at most `cap`."""
    out: list[str] = []
    for t in topics:
        key = (t or "").strip().lower()
        if key in TOPICS and key not in out:
            out.append(key)
        if len(out) >= cap:
            break
    return tuple(out)


def _text(value: str, limit: int) -> str:
    return clip(sanitize_text(value), limit)


def build_graph(
    doc: TourDoc,
    neighbours: Iterable[PlaceLocation] = (),
    topics: TopicAssignment | None = None,
    topics_pending: bool | None = None,
) -> tuple[list[Node], list[Edge]]:
    """Nodes and edges of one tour.

    `neighbours`: places of OTHER indexed tours (any place of `doc` itself is
    ignored there). `topics`: None = no topics (pending unless told otherwise).
    """
    pending = topics is None if topics_pending is None else topics_pending
    nodes: dict[str, Node] = {}
    edges: dict[tuple[str, str, str], Edge] = {}

    def add_edge(edge: Edge) -> None:
        if edge.src != edge.dst:
            edges.setdefault(edge.key, edge)

    tour_id = tour_node_id(doc.tour_id)
    nodes[tour_id] = Node(
        id=tour_id,
        kind="tour",
        name=_text(doc.title, 200),
        props={
            "type": doc.type,
            "language": doc.language,
            "languages": list(doc.languages),
            "city": _text(doc.city, 100) if doc.city else None,
            "duration_minutes": doc.duration_minutes,
        },
        tour_id=doc.tour_id,
        revision=doc.revision,
        topics_pending=pending,
    )

    # Layer 1: structure.
    if doc.city and slugify(doc.city):
        city_id = f"city:{slugify(doc.city)}"
        nodes[city_id] = Node(id=city_id, kind="city", name=_text(doc.city, 100))
        add_edge(Edge(city_id, tour_id, "has"))

    own_ids: set[str] = set()
    for place in doc.places:
        pid = place_node_id(place.place_id)
        own_ids.add(place.place_id)
        nodes[pid] = Node(
            id=pid,
            kind="place",
            name=_text(place.name, 200),
            props={"lat": place.lat, "lng": place.lng, "type": place.type},
            tour_id=doc.tour_id,
            revision=doc.revision,
            topics_pending=pending,
        )
        add_edge(Edge(tour_id, pid, "has_stop", {"sequence": place.sequence}))
        if place.type and slugify(place.type):
            type_id = f"type:{slugify(place.type)}"
            nodes.setdefault(type_id, Node(id=type_id, kind="type", name=_text(place.type, 100)))
            add_edge(Edge(pid, type_id, "is_a"))

    # Layer 2: space.
    others = [n for n in neighbours if n.tour_id != doc.tour_id and n.place_id not in own_ids]
    candidates = [PlaceLocation(p.place_id, doc.tour_id, p.lat, p.lng) for p in doc.places] + others
    for place in doc.places:
        box = near_bbox([(place.lat, place.lng)])
        found: list[tuple[float, str]] = []
        for other in candidates:
            if other.place_id == place.place_id or not box.contains(other.lat, other.lng):
                continue
            meters = haversine_m(place.lat, place.lng, other.lat, other.lng)
            if meters < NEAR_METERS:
                found.append((meters, other.place_id))
        found.sort()
        for meters, other_id in found[:MAX_NEAR_PER_PLACE]:
            src, dst = place_node_id(place.place_id), place_node_id(other_id)
            props = {"meters": round(meters)}
            add_edge(Edge(src, dst, "near", props))
            add_edge(Edge(dst, src, "near", props))

    # Layer 3: meaning.
    if topics is not None:
        for topic in clean_topics(topics.tour, MAX_TOUR_TOPICS):
            _about(nodes, add_edge, tour_id, topic)
        for place in doc.places:
            for topic in clean_topics(topics.places.get(place.place_id, ()), MAX_PLACE_TOPICS):
                _about(nodes, add_edge, place_node_id(place.place_id), topic)

    return list(nodes.values()), list(edges.values())


def _about(nodes: dict[str, Node], add_edge, src: str, topic: str) -> None:
    topic_id = f"topic:{topic}"
    nodes.setdefault(topic_id, Node(id=topic_id, kind="topic", name=topic))
    add_edge(Edge(src, topic_id, "about"))
