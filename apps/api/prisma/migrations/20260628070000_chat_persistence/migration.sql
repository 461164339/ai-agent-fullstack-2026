CREATE TABLE "ChatSession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "model" TEXT,
  "error" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatAttachment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT,
  "content" TEXT,
  "dataUrl" TEXT,
  "storageUri" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "userMessageId" UUID NOT NULL,
  "assistantMessageId" UUID,
  "provider" TEXT NOT NULL DEFAULT 'ollama',
  "model" TEXT,
  "status" TEXT NOT NULL DEFAULT 'running',
  "topK" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "latencyMs" INTEGER,
  "error" TEXT,
  "metadata" JSONB,

  CONSTRAINT "ChatRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatSource" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "messageId" UUID NOT NULL,
  "documentId" UUID,
  "chunkId" UUID,
  "title" TEXT,
  "source" TEXT,
  "chunkIndex" INTEGER NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatSession_createdAt_idx" ON "ChatSession"("createdAt");
CREATE INDEX "ChatSession_updatedAt_idx" ON "ChatSession"("updatedAt");
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");
CREATE INDEX "ChatMessage_role_idx" ON "ChatMessage"("role");
CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment"("messageId");
CREATE INDEX "ChatAttachment_kind_idx" ON "ChatAttachment"("kind");
CREATE INDEX "ChatAttachment_sha256_idx" ON "ChatAttachment"("sha256");
CREATE INDEX "ChatRun_sessionId_startedAt_idx" ON "ChatRun"("sessionId", "startedAt");
CREATE INDEX "ChatRun_userMessageId_idx" ON "ChatRun"("userMessageId");
CREATE INDEX "ChatRun_assistantMessageId_idx" ON "ChatRun"("assistantMessageId");
CREATE INDEX "ChatRun_status_idx" ON "ChatRun"("status");
CREATE INDEX "ChatSource_messageId_idx" ON "ChatSource"("messageId");
CREATE INDEX "ChatSource_documentId_idx" ON "ChatSource"("documentId");
CREATE INDEX "ChatSource_chunkId_idx" ON "ChatSource"("chunkId");

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_sessionId_fkey"
  FOREIGN KEY ("sessionId")
  REFERENCES "ChatSession"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ChatAttachment"
  ADD CONSTRAINT "ChatAttachment_messageId_fkey"
  FOREIGN KEY ("messageId")
  REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ChatRun"
  ADD CONSTRAINT "ChatRun_sessionId_fkey"
  FOREIGN KEY ("sessionId")
  REFERENCES "ChatSession"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ChatRun"
  ADD CONSTRAINT "ChatRun_userMessageId_fkey"
  FOREIGN KEY ("userMessageId")
  REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ChatRun"
  ADD CONSTRAINT "ChatRun_assistantMessageId_fkey"
  FOREIGN KEY ("assistantMessageId")
  REFERENCES "ChatMessage"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "ChatSource"
  ADD CONSTRAINT "ChatSource_messageId_fkey"
  FOREIGN KEY ("messageId")
  REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
