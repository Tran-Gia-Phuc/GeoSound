-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tour_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_key" TEXT NOT NULL,

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "in_app_notifications_source_key_key" ON "in_app_notifications"("source_key");

-- CreateIndex
CREATE INDEX "in_app_notifications_user_id_created_at_idx" ON "in_app_notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "in_app_notifications_user_id_read_at_idx" ON "in_app_notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "in_app_notifications_user_id_tour_id_created_at_idx" ON "in_app_notifications"("user_id", "tour_id", "created_at");

