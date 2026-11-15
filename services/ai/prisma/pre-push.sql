-- Kept for the pgvector integration test (tests/test_pgvector_store.py) on a disposable Postgres.
-- Supabase uses migrations/0_init, which contains this (task 0.6, #352).
-- Run before `prisma db push` of schema.prisma (idempotent).
-- schema.prisma uses the type extensions.vector, so pgvector must exist first.
-- On Supabase the database role can usually run this; if it fails with a permission error,
-- ask the project owner to enable `vector` on the dashboard (Database -> Extensions, schema "extensions").

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS ai;
