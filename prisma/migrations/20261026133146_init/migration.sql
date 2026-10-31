-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "yjs_state" BYTEA;

-- CreateIndex
CREATE INDEX "pages_workspace_id_archived_at_idx" ON "pages"("workspace_id", "archived_at");
