-- Run after `prisma db push` of schema.prisma (idempotent). Adds what Prisma cannot express.
-- All names are schema-qualified (ai.*, extensions.*); pgvector lives in schema "extensions".

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'index_meta_single_row') THEN
    ALTER TABLE ai.index_meta ADD CONSTRAINT index_meta_single_row CHECK (id = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'index_meta_dimension_positive') THEN
    ALTER TABLE ai.index_meta ADD CONSTRAINT index_meta_dimension_positive CHECK (dimension > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tour_index_state_check') THEN
    ALTER TABLE ai.tour_index ADD CONSTRAINT tour_index_state_check CHECK (state IN ('indexed', 'deleted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nodes_kind_check') THEN
    ALTER TABLE ai.nodes ADD CONSTRAINT nodes_kind_check CHECK (kind IN ('city', 'tour', 'place', 'type', 'topic'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edges_kind_check') THEN
    ALTER TABLE ai.edges ADD CONSTRAINT edges_kind_check CHECK (kind IN ('has', 'has_stop', 'is_a', 'near', 'about'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chunks_source_check') THEN
    ALTER TABLE ai.chunks ADD CONSTRAINT chunks_source_check CHECK (source IN ('description', 'translation'));
  END IF;
END $$;

-- Bounding-box prefilter for near edges and nearby_places.
CREATE INDEX IF NOT EXISTS nodes_place_geo_idx ON ai.nodes (lat, lng) WHERE kind = 'place';

-- Vector search (cosine).
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON ai.chunks USING hnsw (embedding extensions.vector_cosine_ops);
