-- Add encrypted shadow columns used by the app for at-rest protection.
-- These columns are nullable and safe to add to existing databases.

-- AlterTable
ALTER TABLE "HealthProfile" ADD COLUMN IF NOT EXISTS "sensitiveSnapshotEnc" TEXT;

-- AlterTable
ALTER TABLE "WeightLog" ADD COLUMN IF NOT EXISTS "measurementEnc" TEXT;

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN IF NOT EXISTS "measurementEnc" TEXT;

-- AlterTable
ALTER TABLE "HabitLog" ADD COLUMN IF NOT EXISTS "measurementEnc" TEXT;

-- AlterTable
ALTER TABLE "MealLog" ADD COLUMN IF NOT EXISTS "measurementEnc" TEXT;

