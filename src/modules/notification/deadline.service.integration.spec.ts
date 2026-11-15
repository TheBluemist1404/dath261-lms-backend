// deadline.service.integration.spec.ts
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  QuizAttemptStatus,
  QuizScoringMode,
  UserRole,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { DeadlineService } from './deadline.service.js';

const PREFIX = 'deadline-integration-';

describe('DeadlineService - integration', () => {
  let service: DeadlineService;
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  let lecturer: { id: string };
  let student: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
      ],
      providers: [PrismaService, DeadlineService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(DeadlineService);

    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  async function cleanup() {
    const userEmailStartsWith = { email: { startsWith: PREFIX } };

    await prisma.quizAttempt.deleteMany({
      where: { enrollment: { user: userEmailStartsWith } },
    });
    await prisma.enrollment.deleteMany({
      where: {
        OR: [{ user: userEmailStartsWith }, { course: { lecturer: userEmailStartsWith } }],
      },
    });
    await prisma.courseBlock.deleteMany({
      where: { course: { lecturer: userEmailStartsWith } },
    });
    await prisma.course.deleteMany({ where: { lecturer: userEmailStartsWith } });
    await prisma.user.deleteMany({ where: userEmailStartsWith });
  }

  beforeEach(async () => {
    await cleanup();

    lecturer = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer@example.com`,
        passwordHash: 'hash',
        role: UserRole.LECTURER,
      },
    });
    student = await prisma.user.create({
      data: {
        email: `${PREFIX}student@example.com`,
        passwordHash: 'hash',
        role: UserRole.STUDENT,
      },
    });
  });

  async function createCourse(
    overrides: { status?: CourseStatus; isSuspended?: boolean; title?: string } = {},
  ) {
    return prisma.course.create({
      data: {
        title: overrides.title ?? 'Course',
        lecturerId: lecturer.id,
        ...(overrides.status !== undefined && { status: overrides.status }),
        ...(overrides.isSuspended !== undefined && { isSuspended: overrides.isSuspended }),
      },
    });
  }

  async function createQuizBlock(
    courseId: string,
    options: {
      deadline?: Date | null;
      allowLate?: boolean;
      maxAttempts?: number;
      title?: string;
      type?: BlockType;
    } = {},
  ) {
    return prisma.courseBlock.create({
      data: {
        courseId,
        type: options.type ?? BlockType.QUIZ,
        title: options.title ?? 'Quiz',
        position: 0,
        quizConfig: {
          create: {
            maxAttempts: options.maxAttempts ?? 1,
            scoringMode: QuizScoringMode.HIGHEST,
            deadline: options.deadline ?? null,
            allowLate: options.allowLate ?? false,
          },
        },
      },
    });
  }

  async function enroll(courseId: string, status: EnrollmentStatus = EnrollmentStatus.ACTIVE) {
    return prisma.enrollment.create({
      data: { userId: student.id, courseId, status },
    });
  }

  it('should return [] when the student has no active enrollments', async () => {
    const result = await service.listMyDeadlines(student.id, {});
    expect(result).toEqual([]);
  });

  it('should exclude DRAFT courses', async () => {
    const course = await createCourse({ status: CourseStatus.DRAFT });
    await enroll(course.id);
    await createQuizBlock(course.id, {
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const result = await service.listMyDeadlines(student.id, {});
    expect(result).toEqual([]);
  });

  it('should exclude suspended courses', async () => {
    const course = await createCourse({
      status: CourseStatus.PUBLISHED,
      isSuspended: true,
    });
    await enroll(course.id);
    await createQuizBlock(course.id, {
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const result = await service.listMyDeadlines(student.id, {});
    expect(result).toEqual([]);
  });

  it('should exclude quizzes whose deadline is outside the window', async () => {
    const course = await createCourse({ status: CourseStatus.PUBLISHED });
    await enroll(course.id);
    // Past deadline
    await createQuizBlock(course.id, {
      deadline: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    // Far future
    await createQuizBlock(course.id, {
      deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });
    // No deadline
    await createQuizBlock(course.id, { deadline: null });

    const result = await service.listMyDeadlines(student.id, { days: 14 });
    expect(result).toEqual([]);
  });

  it('should return quizzes inside the window sorted by deadline ascending', async () => {
    const course = await createCourse({ status: CourseStatus.PUBLISHED, title: 'NestJS' });
    await enroll(course.id);
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const later = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await createQuizBlock(course.id, { deadline: later, title: 'Later', maxAttempts: 3 });
    await createQuizBlock(course.id, {
      deadline: soon,
      title: 'Soon',
      maxAttempts: 1,
      allowLate: true,
    });

    const result = await service.listMyDeadlines(student.id, { days: 14 });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.title)).toEqual(['Soon', 'Later']);
    expect(result[0]).toMatchObject({
      courseId: course.id,
      courseTitle: 'NestJS',
      title: 'Soon',
      allowLate: true,
      attemptsUsed: 0,
      maxAttempts: 1,
    });
  });

  it('should count attemptsUsed per quiz', async () => {
    const course = await createCourse({ status: CourseStatus.PUBLISHED });
    const enrollment = await enroll(course.id);
    const block = await createQuizBlock(course.id, {
      deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      maxAttempts: 5,
    });

    await prisma.quizAttempt.createMany({
      data: [
        {
          enrollmentId: enrollment.id,
          courseBlockId: block.id,
          attemptNumber: 1,
          status: QuizAttemptStatus.SUBMITTED,
          answers: [],
          score: 5,
          startedAt: new Date(),
          submittedAt: new Date(),
          gradedAt: new Date(),
          isLate: false,
        },
        {
          enrollmentId: enrollment.id,
          courseBlockId: block.id,
          attemptNumber: 2,
          status: QuizAttemptStatus.SUBMITTED,
          answers: [],
          score: 7,
          startedAt: new Date(),
          submittedAt: new Date(),
          gradedAt: new Date(),
          isLate: false,
        },
      ],
    });

    const result = await service.listMyDeadlines(student.id, { days: 7 });
    expect(result).toHaveLength(1);
    expect(result[0].attemptsUsed).toBe(2);
    expect(result[0].maxAttempts).toBe(5);
  });

  it('should ignore enrollments with status LEFT', async () => {
    const course = await createCourse({ status: CourseStatus.PUBLISHED });
    await enroll(course.id, EnrollmentStatus.LEFT);
    await createQuizBlock(course.id, {
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const result = await service.listMyDeadlines(student.id, {});
    expect(result).toEqual([]);
  });
});
