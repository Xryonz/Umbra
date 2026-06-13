ALTER TABLE "User" ADD COLUMN "onboardedAt" timestamp(3);
UPDATE "User" SET "onboardedAt" = "createdAt";
