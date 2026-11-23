-- CreateTable
CREATE TABLE "pending_emails" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT,
    "text" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_emails_next_attempt_at_idx" ON "pending_emails"("next_attempt_at");

