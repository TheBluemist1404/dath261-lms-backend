// progress.util.ts
import { BlockType } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { TRACKED_BLOCK_TYPES } from './progress.constants.js';

export interface ProgressMetrics {
  totalItems: number;
  completedItems: number;
  learningProgressPercentage: number;
  totalQuizzes: number;
  completedQuizzes: number;
  quizCompletionPercentage: number;
}

export interface RosterProgressSummary {
  completedBlocks: number;
  totalBlocks: number;
  percent: number;
}

/**
 * Percentage rounded to 2 decimals (0..100).
 * Shared by the student progress endpoint and the lecturer roster so both
 * surfaces always report the same number.
 */
export function percentage(completed: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.round((completed / total) * 10_000) / 100;
}

/**
 * Single source of truth for the course progress formula.
 * Both `ProgressService.getProgressSnapshot` and the roster batch loader
 * call this so the numbers can never drift apart.
 */
export function computeProgressMetrics(
  items: Array<{ type: BlockType; completed: boolean }>,
): ProgressMetrics {
  const totalItems = items.length;
  const completedItems = items.filter((item) => item.completed).length;

  const quizzes = items.filter((item) => item.type === BlockType.QUIZ);
  const completedQuizzes = quizzes.filter((item) => item.completed).length;

  return {
    totalItems,
    completedItems,
    learningProgressPercentage: percentage(completedItems, totalItems),
    totalQuizzes: quizzes.length,
    completedQuizzes,
    quizCompletionPercentage: percentage(completedQuizzes, quizzes.length),
  };
}

/**
 * Round HALF_UP to `decimals` places.
 * Same implementation as QuizGradingService.roundHalfUp; kept here as a small
 * local copy so the progress/enrollment modules do not depend on the quiz
 * module. `Number.EPSILON` guards against binary floating-point drift.
 */
export function roundHalfUp(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** decimals;
  const shifted = value * factor;
  const rounded = Math.round(shifted + Number.EPSILON);

  return rounded / factor;
}

/**
 * Load progress for many enrollments at once (one query, no N+1).
 *
 * Uses the exact same `computeProgressMetrics` formula as the single-student
 * endpoint, so a lecturer's roster row matches what the student sees in the
 * reader.
 */
export async function loadProgressForEnrollments(
  db: Pick<PrismaService, 'courseBlock'>,
  courseId: string,
  enrollmentIds: string[],
): Promise<Map<string, RosterProgressSummary>> {
  const result = new Map<string, RosterProgressSummary>();

  if (enrollmentIds.length === 0) {
    return result;
  }

  const blocks = await db.courseBlock.findMany({
    where: {
      courseId,
      type: {
        in: TRACKED_BLOCK_TYPES,
      },
    },
    select: {
      id: true,
      type: true,
      progressEntries: {
        where: {
          enrollmentId: {
            in: enrollmentIds,
          },
        },
        select: {
          enrollmentId: true,
          completed: true,
        },
      },
    },
  });

  const completedByEnrollment = new Map<string, Set<string>>();
  for (const enrollmentId of enrollmentIds) {
    completedByEnrollment.set(enrollmentId, new Set<string>());
  }

  for (const block of blocks) {
    for (const entry of block.progressEntries) {
      if (entry.completed) {
        completedByEnrollment.get(entry.enrollmentId)?.add(block.id);
      }
    }
  }

  for (const enrollmentId of enrollmentIds) {
    const completedBlockIds = completedByEnrollment.get(enrollmentId) ?? new Set<string>();

    const items = blocks.map((block) => ({
      type: block.type,
      completed: completedBlockIds.has(block.id),
    }));

    const metrics = computeProgressMetrics(items);

    result.set(enrollmentId, {
      completedBlocks: metrics.completedItems,
      totalBlocks: metrics.totalItems,
      percent: metrics.learningProgressPercentage,
    });
  }

  return result;
}
