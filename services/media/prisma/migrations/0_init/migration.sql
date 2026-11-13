-- CreateTable
CREATE TABLE "audio_assets" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'tts',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_assets_pkey" PRIMARY KEY ("id")
);

