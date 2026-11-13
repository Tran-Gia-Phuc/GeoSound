-- CreateTable
CREATE TABLE "tours" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "cover_image_url" TEXT,
    "original_language" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'walking',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "author_id" TEXT NOT NULL,
    "city" TEXT,
    "duration" INTEGER,
    "average_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "moderation_reasons" JSONB NOT NULL DEFAULT '[]',
    "moderation_revision" TEXT,
    "review_reason" TEXT,
    "report_flagged_at" TIMESTAMP(3),
    "open_report_count" INTEGER NOT NULL DEFAULT 0,
    "review_queued_at" TIMESTAMP(3),
    "passcode_hash" TEXT,
    "passcode_version" INTEGER NOT NULL DEFAULT 0,
    "passcode_set_at" TIMESTAMP(3),
    "auto_translate" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_review_actions" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "from_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_review_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "source_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_ratings" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_daily_stats" (
    "tour_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "language" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tour_daily_stats_pkey" PRIMARY KEY ("tour_id","day","language")
);

-- CreateTable
CREATE TABLE "tour_activity_marks" (
    "tour_id" TEXT NOT NULL,
    "actor_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_activity_marks_pkey" PRIMARY KEY ("tour_id","actor_key","action","language","day")
);

-- CreateTable
CREATE TABLE "tour_reports" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_access_grants" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "passcode_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_unlock_attempts" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_unlock_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "images" JSONB NOT NULL DEFAULT '[]',
    "audio_url" TEXT,
    "audio_source" TEXT NOT NULL DEFAULT 'tts',
    "moderation_status" TEXT NOT NULL DEFAULT 'approved',
    "moderation_reasons" JSONB NOT NULL DEFAULT '[]',
    "moderation_revision" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forbidden_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "geometry" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forbidden_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_configs" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "path" JSONB NOT NULL DEFAULT '[]',
    "triggers" JSONB NOT NULL DEFAULT '[]',
    "nav_audios" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_languages" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "language_code" TEXT NOT NULL,
    "is_source" BOOLEAN NOT NULL DEFAULT false,
    "tts_voice_gender" TEXT,
    "tts_voice_region" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itineraries" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "share_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itineraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_items" (
    "id" TEXT NOT NULL,
    "itinerary_id" TEXT NOT NULL,
    "place_id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "radius_meters" INTEGER NOT NULL DEFAULT 50,
    "source_language" TEXT NOT NULL,
    "available_languages" JSONB NOT NULL DEFAULT '[]',
    "audio_by_lang" JSONB NOT NULL DEFAULT '{}',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itinerary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_translations" (
    "id" TEXT NOT NULL,
    "place_id" TEXT NOT NULL,
    "language_code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "text_source" TEXT NOT NULL DEFAULT 'machine',
    "source_hash" TEXT,
    "tts_url" TEXT,
    "tts_prerendered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "place_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tours_author_id_idx" ON "tours"("author_id");

-- CreateIndex
CREATE INDEX "tours_status_idx" ON "tours"("status");

-- CreateIndex
CREATE INDEX "tours_status_city_idx" ON "tours"("status", "city");

-- CreateIndex
CREATE INDEX "tour_review_actions_tour_id_created_at_idx" ON "tour_review_actions"("tour_id", "created_at");

-- CreateIndex
CREATE INDEX "tour_review_actions_created_at_idx" ON "tour_review_actions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_actions_source_key_key" ON "admin_actions"("source_key");

-- CreateIndex
CREATE INDEX "admin_actions_target_type_target_id_created_at_idx" ON "admin_actions"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_actions_created_at_idx" ON "admin_actions"("created_at");

-- CreateIndex
CREATE INDEX "admin_actions_admin_id_created_at_idx" ON "admin_actions"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_actions_action_created_at_idx" ON "admin_actions"("action", "created_at");

-- CreateIndex
CREATE INDEX "tour_ratings_tour_id_created_at_idx" ON "tour_ratings"("tour_id", "created_at");

-- CreateIndex
CREATE INDEX "tour_ratings_user_id_idx" ON "tour_ratings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tour_ratings_tour_id_user_id_key" ON "tour_ratings"("tour_id", "user_id");

-- CreateIndex
CREATE INDEX "tour_activity_marks_actor_key_day_idx" ON "tour_activity_marks"("actor_key", "day");

-- CreateIndex
CREATE INDEX "tour_activity_marks_day_idx" ON "tour_activity_marks"("day");

-- CreateIndex
CREATE INDEX "tour_reports_tour_id_status_created_at_idx" ON "tour_reports"("tour_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "tour_reports_created_at_idx" ON "tour_reports"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tour_reports_tour_id_reporter_id_key" ON "tour_reports"("tour_id", "reporter_id");

-- CreateIndex
CREATE INDEX "tour_access_grants_user_id_idx" ON "tour_access_grants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tour_access_grants_tour_id_user_id_key" ON "tour_access_grants"("tour_id", "user_id");

-- CreateIndex
CREATE INDEX "tour_unlock_attempts_tour_id_user_id_created_at_idx" ON "tour_unlock_attempts"("tour_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "places_tour_id_sequence_idx" ON "places"("tour_id", "sequence");

-- CreateIndex
CREATE INDEX "forbidden_zones_active_idx" ON "forbidden_zones"("active");

-- CreateIndex
CREATE UNIQUE INDEX "route_configs_tour_id_key" ON "route_configs"("tour_id");

-- CreateIndex
CREATE UNIQUE INDEX "tour_languages_tour_id_language_code_key" ON "tour_languages"("tour_id", "language_code");

-- CreateIndex
CREATE UNIQUE INDEX "itineraries_share_token_key" ON "itineraries"("share_token");

-- CreateIndex
CREATE INDEX "itineraries_owner_id_idx" ON "itineraries"("owner_id");

-- CreateIndex
CREATE INDEX "itinerary_items_itinerary_id_sequence_idx" ON "itinerary_items"("itinerary_id", "sequence");

-- CreateIndex
CREATE INDEX "place_translations_language_code_idx" ON "place_translations"("language_code");

-- CreateIndex
CREATE UNIQUE INDEX "place_translations_place_id_language_code_key" ON "place_translations"("place_id", "language_code");

-- AddForeignKey
ALTER TABLE "tour_ratings" ADD CONSTRAINT "tour_ratings_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_daily_stats" ADD CONSTRAINT "tour_daily_stats_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_activity_marks" ADD CONSTRAINT "tour_activity_marks_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_reports" ADD CONSTRAINT "tour_reports_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_access_grants" ADD CONSTRAINT "tour_access_grants_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_unlock_attempts" ADD CONSTRAINT "tour_unlock_attempts_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_configs" ADD CONSTRAINT "route_configs_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_languages" ADD CONSTRAINT "tour_languages_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "itineraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_translations" ADD CONSTRAINT "place_translations_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

