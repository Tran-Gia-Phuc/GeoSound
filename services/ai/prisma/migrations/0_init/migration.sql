-- Baseline of schema "ai" (deployment plan task 0.6, issue #352).
-- Same result as pre-push.sql + `prisma db push` + post-push.sql. Table names are not qualified:
-- they go to the schema of DATABASE_URL (?schema=ai). pgvector lives in schema "extensions"; on
-- Supabase it is usually enabled already (see docs/04-guides/supabase-access.md section 4).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- CreateTable
CREATE TABLE "index_meta" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "embedding_model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_index" (
    "tour_id" TEXT NOT NULL,
    "revision" TIMESTAMPTZ(6),
    "state" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_index_pkey" PRIMARY KEY ("tour_id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "props" JSONB NOT NULL DEFAULT '{}',
    "tour_id" TEXT,
    "revision" TIMESTAMPTZ(6),
    "topics_pending" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edges" (
    "src" TEXT NOT NULL,
    "dst" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "props" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "edges_pkey" PRIMARY KEY ("src","dst","kind")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" extensions.vector(384) NOT NULL,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nodes_tour_id_idx" ON "nodes"("tour_id");

-- CreateIndex
CREATE INDEX "edges_dst_idx" ON "edges"("dst", "kind");

-- CreateIndex
CREATE INDEX "chunks_tour_id_idx" ON "chunks"("tour_id");

-- AddForeignKey
ALTER TABLE "edges" ADD CONSTRAINT "edges_src_fkey" FOREIGN KEY ("src") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edges" ADD CONSTRAINT "edges_dst_fkey" FOREIGN KEY ("dst") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What Prisma cannot express (was post-push.sql).
ALTER TABLE "index_meta" ADD CONSTRAINT "index_meta_single_row" CHECK (id = 1);
ALTER TABLE "index_meta" ADD CONSTRAINT "index_meta_dimension_positive" CHECK (dimension > 0);
ALTER TABLE "tour_index" ADD CONSTRAINT "tour_index_state_check" CHECK (state IN ('indexed', 'deleted'));
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_kind_check" CHECK (kind IN ('city', 'tour', 'place', 'type', 'topic'));
ALTER TABLE "edges" ADD CONSTRAINT "edges_kind_check" CHECK (kind IN ('has', 'has_stop', 'is_a', 'near', 'about'));
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_source_check" CHECK (source IN ('description', 'translation'));

-- Bounding-box prefilter for near edges and nearby_places.
CREATE INDEX "nodes_place_geo_idx" ON "nodes" (lat, lng) WHERE kind = 'place';

-- Vector search (cosine).
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw (embedding extensions.vector_cosine_ops);
