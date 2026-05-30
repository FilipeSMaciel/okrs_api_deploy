-- CreateEnum
CREATE TYPE "EventAction" AS ENUM ('LOGIN', 'PAGE_VIEW', 'META_EDIT');

-- CreateTable
CREATE TABLE "UserEvent" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "action"    "EventAction" NOT NULL,
    "payload"   JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "UserEvent_action_createdAt_idx" ON "UserEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "UserEvent_userId_createdAt_idx" ON "UserEvent"("userId", "createdAt");
