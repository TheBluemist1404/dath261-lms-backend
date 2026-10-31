-- CreateEnum
CREATE TYPE "QuizAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED');

-- CreateEnum
CREATE TYPE "AssignmentSubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ACCOUNT_STATUS_CHANGED', 'COURSE_STATUS_CHANGED', 'COURSE_CREATED', 'COURSE_UPDATED', 'GRADE_RELEASED', 'REPORT_REVIEWED', 'SECURITY_EVENT');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('USER', 'COURSE', 'COURSE_BLOCK', 'ENROLLMENT', 'QUIZ_ATTEMPT', 'ASSIGNMENT_SUBMISSION', 'WORKSPACE', 'PAGE', 'REPORT');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('MODULE', 'TEXT', 'FILE', 'VIDEO', 'QUIZ', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'LEFT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'COURSE', 'COURSE_BLOCK', 'PAGE', 'MESSAGE', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'DISMISSED', 'ACTION_TAKEN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_CONTENT', 'ASSESSMENT_DUE', 'RESULT_RELEASED', 'COLLABORATION_INVITE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'LECTURER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('PERSONAL', 'COLLABORATIVE');

-- CreateEnum
CREATE TYPE "WorkspaceMemberRole" AS ENUM ('OWNER', 'CO_OWNER', 'MEMBER');

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "course_block_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "QuizAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "answers" JSONB,
    "score" DECIMAL(5,2),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "graded_at" TIMESTAMP(3),

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "course_block_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "text_content" TEXT,
    "file_metadata" JSONB,
    "status" "AssignmentSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "score" DECIMAL(5,2),
    "feedback" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graded_at" TIMESTAMP(3),

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entries" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity_type" "AuditEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "prerequisites" TEXT,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "lecturer_id" TEXT NOT NULL,
    "enrollment_start_at" TIMESTAMP(3),
    "enrollment_end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_blocks" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "type" "BlockType" NOT NULL,
    "title" TEXT NOT NULL,
    "parent_module_id" TEXT,
    "position" INTEGER NOT NULL,
    "content" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_progress" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "course_block_id" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "last_visited_at" TIMESTAMP(3),
    "resume_data" JSONB,

    CONSTRAINT "block_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_references" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "course_block_id" TEXT NOT NULL,
    "timestamp_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "default_workspace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WorkspaceType" NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_memberships" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WorkspaceMemberRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parent_page_id" TEXT,
    "content" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quiz_attempts_enrollment_id_idx" ON "quiz_attempts"("enrollment_id");

-- CreateIndex
CREATE INDEX "quiz_attempts_course_block_id_idx" ON "quiz_attempts"("course_block_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_enrollment_id_course_block_id_attempt_number_key" ON "quiz_attempts"("enrollment_id", "course_block_id", "attempt_number");

-- CreateIndex
CREATE INDEX "assignment_submissions_course_block_id_idx" ON "assignment_submissions"("course_block_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_enrollment_id_course_block_id_attemp_key" ON "assignment_submissions"("enrollment_id", "course_block_id", "attempt_number");

-- CreateIndex
CREATE INDEX "audit_entries_actor_id_idx" ON "audit_entries"("actor_id");

-- CreateIndex
CREATE INDEX "audit_entries_entity_type_entity_id_idx" ON "audit_entries"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_entries_created_at_idx" ON "audit_entries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "messages_page_id_idx" ON "messages"("page_id");

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "courses_lecturer_id_idx" ON "courses"("lecturer_id");

-- CreateIndex
CREATE INDEX "courses_status_idx" ON "courses"("status");

-- CreateIndex
CREATE INDEX "course_blocks_course_id_idx" ON "course_blocks"("course_id");

-- CreateIndex
CREATE INDEX "course_blocks_parent_module_id_idx" ON "course_blocks"("parent_module_id");

-- CreateIndex
CREATE INDEX "course_blocks_course_id_parent_module_id_position_idx" ON "course_blocks"("course_id", "parent_module_id", "position");

-- CreateIndex
CREATE INDEX "enrollments_user_id_status_idx" ON "enrollments"("user_id", "status");

-- CreateIndex
CREATE INDEX "enrollments_course_id_status_idx" ON "enrollments"("course_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_user_id_course_id_key" ON "enrollments"("user_id", "course_id");

-- CreateIndex
CREATE INDEX "block_progress_course_block_id_idx" ON "block_progress"("course_block_id");

-- CreateIndex
CREATE UNIQUE INDEX "block_progress_enrollment_id_course_block_id_key" ON "block_progress"("enrollment_id", "course_block_id");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "resource_references_page_id_idx" ON "resource_references"("page_id");

-- CreateIndex
CREATE INDEX "resource_references_course_block_id_idx" ON "resource_references"("course_block_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_default_workspace_id_key" ON "users"("default_workspace_id");

-- CreateIndex
CREATE INDEX "workspaces_created_by_id_idx" ON "workspaces"("created_by_id");

-- CreateIndex
CREATE INDEX "workspace_memberships_user_id_idx" ON "workspace_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_memberships_workspace_id_user_id_key" ON "workspace_memberships"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "pages_workspace_id_idx" ON "pages"("workspace_id");

-- CreateIndex
CREATE INDEX "pages_parent_page_id_idx" ON "pages"("parent_page_id");

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_course_block_id_fkey" FOREIGN KEY ("course_block_id") REFERENCES "course_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_course_block_id_fkey" FOREIGN KEY ("course_block_id") REFERENCES "course_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_lecturer_id_fkey" FOREIGN KEY ("lecturer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_blocks" ADD CONSTRAINT "course_blocks_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_blocks" ADD CONSTRAINT "course_blocks_parent_module_id_fkey" FOREIGN KEY ("parent_module_id") REFERENCES "course_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_progress" ADD CONSTRAINT "block_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_progress" ADD CONSTRAINT "block_progress_course_block_id_fkey" FOREIGN KEY ("course_block_id") REFERENCES "course_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_references" ADD CONSTRAINT "resource_references_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_references" ADD CONSTRAINT "resource_references_course_block_id_fkey" FOREIGN KEY ("course_block_id") REFERENCES "course_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_workspace_id_fkey" FOREIGN KEY ("default_workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_page_id_fkey" FOREIGN KEY ("parent_page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
