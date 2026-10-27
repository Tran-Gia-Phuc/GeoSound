-- Chatbot index, schema `ai` (task #AI-44, issue #185).
-- See docs/02-design/chatbot-architecture.md sections 4 and 6a.
-- Needs the pgvector Postgres image (docs/02-design/ai-integration-requests.md section 3).
-- Only public tour and place content is stored: no contributor id, email or user field.
-- The dimension (384) matches intfloat/multilingual-e5-small; a model change means a full re-embed.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS ai;

-- Embedding model of the whole index (one row).
CREATE TABLE IF NOT EXISTS ai.index_meta (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  embedding_model text        NOT NULL,
  dimension       integer     NOT NULL CHECK (dimension > 0),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Last revision seen per tour. state = 'deleted' is a tombstone written on
-- unpublish, so a late older tour.published cannot index the tour again.
CREATE TABLE IF NOT EXISTS ai.tour_index (
  tour_id    text        PRIMARY KEY,
  revision   timestamptz,
  state      text        NOT NULL CHECK (state IN ('indexed', 'deleted')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Graph nodes. tour_id is NULL for shared nodes (city, type, topic).
CREATE TABLE IF NOT EXISTS ai.nodes (
  id             text PRIMARY KEY,  -- tour:<id>, place:<id>, city:<slug>, type:<slug>, topic:<slug>
  kind           text NOT NULL CHECK (kind IN ('city', 'tour', 'place', 'type', 'topic')),
  name           text NOT NULL,
  props          jsonb NOT NULL DEFAULT '{}'::jsonb,
  tour_id        text,
  revision       timestamptz,
  topics_pending boolean NOT NULL DEFAULT false,
  lat            double precision,  -- places only (near edges, bounding-box prefilter)
  lng            double precision
);
CREATE INDEX IF NOT EXISTS nodes_tour_id_idx ON ai.nodes (tour_id);
CREATE INDEX IF NOT EXISTS nodes_place_geo_idx ON ai.nodes (lat, lng) WHERE kind = 'place';

-- Graph edges: has, has_stop{sequence}, is_a, near{meters}, about.
CREATE TABLE IF NOT EXISTS ai.edges (
  src   text NOT NULL REFERENCES ai.nodes (id) ON DELETE CASCADE,
  dst   text NOT NULL REFERENCES ai.nodes (id) ON DELETE CASCADE,
  kind  text NOT NULL CHECK (kind IN ('has', 'has_stop', 'is_a', 'near', 'about')),
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (src, dst, kind)
);
CREATE INDEX IF NOT EXISTS edges_dst_idx ON ai.edges (dst, kind);

-- Text chunks and their vectors.
CREATE TABLE IF NOT EXISTS ai.chunks (
  id        text PRIMARY KEY,
  node_id   text NOT NULL REFERENCES ai.nodes (id) ON DELETE CASCADE,
  tour_id   text NOT NULL,
  lang      text NOT NULL,
  source    text NOT NULL CHECK (source IN ('description', 'translation')),
  text      text NOT NULL,
  embedding vector(384) NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_tour_id_idx ON ai.chunks (tour_id);
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx ON ai.chunks USING hnsw (embedding vector_cosine_ops);
