-- AlterTable
ALTER TABLE "tour_ratings"
ADD COLUMN IF NOT EXISTS "is_flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "is_hidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "tour_rating_reports" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "rating_id" TEXT NOT NULL,
    "rating_user_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reporter_role" TEXT NOT NULL,
    "reason_type" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "admin_note" TEXT,
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_rating_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tour_rating_reports_tour_id_rating_user_id_reporter_id_key" ON "tour_rating_reports"("tour_id", "rating_user_id", "reporter_id");
CREATE INDEX IF NOT EXISTS "tour_rating_reports_status_created_at_idx" ON "tour_rating_reports"("status", "created_at");
CREATE INDEX IF NOT EXISTS "tour_rating_reports_rating_id_idx" ON "tour_rating_reports"("rating_id");

-- AddForeignKey
ALTER TABLE "tour_rating_reports"
ADD CONSTRAINT "tour_rating_reports_rating_id_fkey"
FOREIGN KEY ("rating_id") REFERENCES "tour_ratings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
