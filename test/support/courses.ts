import {
  type BlockType,
  type CourseStatus,
  type EnrollmentStatus,
  Prisma,
} from '../../src/generated/prisma/client.js';
import type { TestApp } from './test-app.js';

export interface TestBlockInput {
  type: BlockType;
  title: string;
  content?: Prisma.InputJsonValue;
}

/** Inserts a course with top-level blocks; the course module is not part of this repo yet. */
export async function createCourse(
  testApp: TestApp,
  input: {
    lecturerId: string;
    title?: string;
    status?: CourseStatus;
    isSuspended?: boolean;
    blocks?: TestBlockInput[];
  },
) {
  return testApp.prisma.course.create({
    data: {
      title: input.title ?? 'Test course',
      status: input.status ?? 'PUBLISHED',
      isSuspended: input.isSuspended ?? false,
      lecturerId: input.lecturerId,
      blocks: {
        create: (input.blocks ?? []).map((block, position) => ({
          type: block.type,
          title: block.title,
          position,
          content: block.content ?? Prisma.JsonNull,
        })),
      },
    },
    include: { blocks: { orderBy: { position: 'asc' } } },
  });
}

export async function enroll(
  testApp: TestApp,
  userId: string,
  courseId: string,
  status: EnrollmentStatus = 'ACTIVE',
) {
  return testApp.prisma.enrollment.create({ data: { userId, courseId, status } });
}
