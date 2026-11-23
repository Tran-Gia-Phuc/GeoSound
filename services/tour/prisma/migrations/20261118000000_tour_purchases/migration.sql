-- AlterTable
ALTER TABLE "tours" ADD COLUMN     "price" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tour_purchases" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'momo',
    "trans_id" TEXT,
    "result_code" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "tour_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tour_purchases_tour_id_user_id_status_idx" ON "tour_purchases"("tour_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "tour_purchases_user_id_idx" ON "tour_purchases"("user_id");

