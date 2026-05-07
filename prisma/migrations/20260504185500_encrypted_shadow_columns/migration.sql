-- Add encrypted shadow columns (AES-GCM envelopes) for sensitive logs/profile.
-- Use IF NOT EXISTS so this migration is safe on partially-upgraded databases.

ALTER TABLE "HealthProfile"
  ADD COLUMN IF NOT EXISTS "sensitiveSnapshotEnc" TEXT;

ALTER TABLE "WeightLog"
  ADD COLUMN IF NOT EXISTS "measurementEnc" TEXT;

ALTER TABLE "ActivityLog"
  ADD COLUMN IF NOT EXISTS "measurementEnc" TEXT;

ALTER TABLE "HabitLog"
  ADD COLUMN IF NOT EXISTS "measurementEnc" TEXT;

ALTER TABLE "MealLog"
  ADD COLUMN IF NOT EXISTS "measurementEnc" TEXT;

