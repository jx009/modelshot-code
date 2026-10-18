CREATE TABLE "InviteCodeAlias" (
  "code" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "InviteCodeAlias_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "InviteCodeAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InviteCodeAlias_userId_idx" ON "InviteCodeAlias"("userId");
