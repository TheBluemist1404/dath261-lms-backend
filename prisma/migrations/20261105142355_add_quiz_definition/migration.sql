-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_IN_BLANK');

-- CreateEnum
CREATE TYPE "QuizScoringMode" AS ENUM ('HIGHEST', 'LATEST', 'AVERAGE');

-- AlterTable
ALTER TABLE "quiz_attempts" ADD COLUMN     "is_late" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "quiz_configs" (
    "id" TEXT NOT NULL,
    "course_block_id" TEXT NOT NULL,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "scoring_mode" "QuizScoringMode" NOT NULL DEFAULT 'HIGHEST',
    "available_from" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "allow_late" BOOLEAN NOT NULL DEFAULT false,
    "results_released_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" TEXT NOT NULL,
    "course_block_id" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "points" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL,
    "accepted_answers" JSONB,
    "correct_boolean" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_options" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "quiz_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quiz_configs_course_block_id_key" ON "quiz_configs"("course_block_id");

-- CreateIndex
CREATE INDEX "quiz_questions_course_block_id_position_idx" ON "quiz_questions"("course_block_id", "position");

-- CreateIndex
CREATE INDEX "quiz_options_question_id_position_idx" ON "quiz_options"("question_id", "position");

-- AddForeignKey
ALTER TABLE "quiz_configs" ADD CONSTRAINT "quiz_configs_course_block_id_fkey" FOREIGN KEY ("course_block_id") REFERENCES "course_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_course_block_id_fkey" FOREIGN KEY ("course_block_id") REFERENCES "course_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_options" ADD CONSTRAINT "quiz_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
