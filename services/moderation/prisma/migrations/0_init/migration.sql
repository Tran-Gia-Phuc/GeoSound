-- CreateTable
CREATE TABLE "moderation_cases" (
    "id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "tour_id" TEXT,
    "revision" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verdict" TEXT,
    "severity" DOUBLE PRECISION,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "images_checked" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "payload" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_cases_status_updated_at_idx" ON "moderation_cases"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_cases_subject_type_subject_id_revision_key" ON "moderation_cases"("subject_type", "subject_id", "revision");

