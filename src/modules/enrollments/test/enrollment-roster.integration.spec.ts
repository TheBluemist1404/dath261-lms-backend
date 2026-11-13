// enrollment-roster.integration.spec.ts

import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { ProgressService } from '../../progress/progress.service.js';
import { EnrollmentService } from '../enrollment.service.js';

const PREFIX = 'enrollment-roster-integration-';

describe('EnrollmentService - course roster - integration', () => {
  let service: EnrollmentService;
  let progressService: ProgressService;
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  let lecturer: { id: string };
  let otherLecturer: { id: string };
  let studentAn: { id: string; email: string };
  let studentBinh: { id: string; email: string };
  let studentChi: { id: string; email: string };
  let courseId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
      ],
      providers: [PrismaService, EnrollmentService, ProgressService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(EnrollmentService);
    progressService = moduleRef.get(ProgressService);

    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  async function cleanup() {
    await prisma.quizAttempt.deleteMany({
      where: { enrollment: { course: { lecturer: { email: { startsWith: PREFIX } } } } },
    });

    await prisma.blockProgress.deleteMany({
      where: { enrollment: { course: { lecturer: { email: { startsWith: PREFIX } } } } },
    });

    await prisma.quizOption.deleteMany({
      where: {
        question: { courseBlock: { course: { lecturer: { email: { startsWith: PREFIX } } } } },
      },
    });

    await prisma.quizQuestion.deleteMany({
      where: { courseBlock: { course: { lecturer: { email: { startsWith: PREFIX } } } } },
    });

    await prisma.quizConfig.deleteMany({
      where: { courseBlock: { course: { lecturer: { email: { startsWith: PREFIX } } } } },
    });

    await prisma.courseBlock.deleteMany({
      where: { course: { lecturer: { email: { startsWith: PREFIX } } } },
    });

    await prisma.enrollment.deleteMany({
      where: {
        OR: [
          { course: { lecturer: { email: { startsWith: PREFIX } } } },
          { user: { email: { startsWith: PREFIX } } },
        ],
      },
    });

    await prisma.course.deleteMany({
      where: { lecturer: { email: { startsWith: PREFIX } } },
    });

    await prisma.user.deleteMany({
      where: { email: { startsWith: PREFIX } },
    });
  }

  beforeEach(async () => {
    await cleanup();

    lecturer = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer@example.com`,
        passwordHash: 'hash',
        firstName: 'Lec',
        lastName: 'Owner',
        role: UserRole.LECTURER,
      },
    });

    otherLecturer = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer-other@example.com`,
        passwordHash: 'hash',
        firstName: 'Lec',
        lastName: 'Other',
        role: UserRole.LECTURER,
      },
    });

    studentAn = await prisma.user.create({
      data: {
        email: `${PREFIX}an@example.com`,
        passwordHash: 'hash',
        firstName: 'An',
        lastName: 'Nguyen',
        role: UserRole.STUDENT,
      },
    });

    studentBinh = await prisma.user.create({
      data: {
        email: `${PREFIX}binh@example.com`,
        passwordHash: 'hash',
        firstName: 'Binh',
        lastName: 'Tran',
        role: UserRole.STUDENT,
      },
    });

    studentChi = await prisma.user.create({
      data: {
        email: `${PREFIX}chi@example.com`,
        passwordHash: 'hash',
        firstName: 'Chi',
        lastName: 'Le',
        role: UserRole.STUDENT,
      },
    });

    const course = await prisma.course.create({
      data: {
        title: 'Roster Course',
        lecturerId: lecturer.id,
        status: CourseStatus.PUBLISHED,
      },
    });
    courseId = course.id;
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function enroll(userId: string, status: EnrollmentStatus = EnrollmentStatus.ACTIVE) {
    return prisma.enrollment.create({
      data: {
        userId,
        courseId,
        status,
        ...(status === EnrollmentStatus.COMPLETED ? { completedAt: new Date() } : {}),
        ...(status === EnrollmentStatus.LEFT ? { leftAt: new Date() } : {}),
      },
    });
  }

  async function createBlock(type: BlockType, position: number, title = type) {
    return prisma.courseBlock.create({
      data: {
        courseId,
        type,
        title,
        position,
      },
    });
  }

  async function completeBlock(enrollmentId: string, courseBlockId: string) {
    return prisma.blockProgress.create({
      data: {
        enrollmentId,
        courseBlockId,
        completed: true,
        completedAt: new Date(),
      },
    });
  }

  async function createQuizWithConfig(
    position: number,
    scoringMode: QuizScoringMode,
    title = 'Quiz',
  ) {
    return prisma.courseBlock.create({
      data: {
        courseId,
        type: BlockType.QUIZ,
        title,
        position,
        quizConfig: {
          create: {
            maxAttempts: 10,
            scoringMode,
          },
        },
      },
    });
  }

  async function addAttempt(
    enrollmentId: string,
    courseBlockId: string,
    score: number,
    attemptNumber: number,
    status: QuizAttemptStatus = QuizAttemptStatus.SUBMITTED,
  ) {
    const now = new Date();
    return prisma.quizAttempt.create({
      data: {
        enrollmentId,
        courseBlockId,
        attemptNumber,
        status,
        answers: [],
        score,
        startedAt: now,
        submittedAt: now,
        gradedAt: now,
      },
    });
  }

  // ===========================================================================
  // Authorization
  // ===========================================================================
  describe('authorization', () => {
    it('rejects a lecturer who does not own the course', async () => {
      await expect(service.listCourseRoster(otherLecturer.id, courseId, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects an unknown course', async () => {
      await expect(service.listCourseRoster(lecturer.id, 'nonexistent', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ===========================================================================
  // Default filter
  // ===========================================================================
  describe('default status filter', () => {
    it('returns ACTIVE + COMPLETED and excludes LEFT by default', async () => {
      await enroll(studentAn.id, EnrollmentStatus.ACTIVE);
      await enroll(studentBinh.id, EnrollmentStatus.COMPLETED);
      await enroll(studentChi.id, EnrollmentStatus.LEFT);

      const result = await service.listCourseRoster(lecturer.id, courseId, {});

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      const emails = result.data.map((r) => r.student.email).sort();
      expect(emails).toEqual([studentAn.email, studentBinh.email].sort());
    });

    it('returns only LEFT when status=LEFT', async () => {
      await enroll(studentAn.id, EnrollmentStatus.ACTIVE);
      await enroll(studentChi.id, EnrollmentStatus.LEFT);

      const result = await service.listCourseRoster(lecturer.id, courseId, {
        status: EnrollmentStatus.LEFT,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].student.email).toBe(studentChi.email);
    });
  });

  // ===========================================================================
  // Search
  // ===========================================================================
  describe('search', () => {
    beforeEach(async () => {
      await enroll(studentAn.id);
      await enroll(studentBinh.id);
      await enroll(studentChi.id);
    });

    it('matches by first name (case-insensitive)', async () => {
      const result = await service.listCourseRoster(lecturer.id, courseId, { search: 'binh' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].student.email).toBe(studentBinh.email);
    });

    it('matches by last name (case-insensitive)', async () => {
      const result = await service.listCourseRoster(lecturer.id, courseId, { search: 'TRAN' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].student.email).toBe(studentBinh.email);
    });

    it('matches by email', async () => {
      const result = await service.listCourseRoster(lecturer.id, courseId, { search: 'chi@' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].student.email).toBe(studentChi.email);
    });

    it('returns empty when nothing matches', async () => {
      const result = await service.listCourseRoster(lecturer.id, courseId, { search: 'zzz-nope' });
      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  // ===========================================================================
  // Pagination
  // ===========================================================================
  describe('pagination', () => {
    beforeEach(async () => {
      await enroll(studentAn.id);
      await enroll(studentBinh.id);
      await enroll(studentChi.id);
    });

    it('paginates with correct meta (limit=1)', async () => {
      const page1 = await service.listCourseRoster(lecturer.id, courseId, { limit: 1, page: 1 });
      expect(page1.data).toHaveLength(1);
      expect(page1.meta).toEqual({
        total: 3,
        page: 1,
        limit: 1,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: false,
      });

      const page2 = await service.listCourseRoster(lecturer.id, courseId, { limit: 1, page: 2 });
      expect(page2.data).toHaveLength(1);
      expect(page2.meta.hasPrevPage).toBe(true);
      expect(page2.meta.hasNextPage).toBe(true);

      const page3 = await service.listCourseRoster(lecturer.id, courseId, { limit: 1, page: 3 });
      expect(page3.meta.hasNextPage).toBe(false);
      expect(page3.meta.hasPrevPage).toBe(true);
    });

    it('returns empty data for a page beyond the last', async () => {
      const result = await service.listCourseRoster(lecturer.id, courseId, { limit: 10, page: 5 });
      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(3);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPrevPage).toBe(true);
    });
  });

  // ===========================================================================
  // Progress — must match the student progress endpoint
  // ===========================================================================
  describe('progress', () => {
    it('matches what the student sees from getStudentProgress', async () => {
      const enrollment = await enroll(studentAn.id);

      const b1 = await createBlock(BlockType.TEXT, 0);
      const b2 = await createBlock(BlockType.VIDEO, 1);
      const b3 = await createBlock(BlockType.QUIZ, 2);
      await createBlock(BlockType.FILE, 3); // not completed

      await completeBlock(enrollment.id, b1.id);
      await completeBlock(enrollment.id, b2.id);

      const studentProgress = await progressService.getStudentProgress(studentAn.id, courseId);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      const row = roster.data.find((r) => r.enrollmentId === enrollment.id);

      expect(row).toBeDefined();
      expect(row!.progress.completedBlocks).toBe(studentProgress.progress.completedItems);
      expect(row!.progress.totalBlocks).toBe(studentProgress.progress.totalItems);
      expect(row!.progress.percent).toBe(studentProgress.progress.learningProgressPercentage);

      // sanity check values
      expect(row!.progress).toEqual({
        completedBlocks: 2,
        totalBlocks: 4,
        percent: 50,
      });
      // silence unused
      void b3;
    });

    it('reports 0/0/0 for a course with no tracked blocks', async () => {
      const enrollment = await enroll(studentAn.id);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      const row = roster.data.find((r) => r.enrollmentId === enrollment.id);

      expect(row!.progress).toEqual({ completedBlocks: 0, totalBlocks: 0, percent: 0 });
    });
  });

  // ===========================================================================
  // Quiz score aggregation
  // ===========================================================================
  describe('quizScore', () => {
    it('is null when there are no quizzes at all', async () => {
      await enroll(studentAn.id);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      expect(roster.data[0].quizScore).toBeNull();
    });

    it('is null when quizzes exist but the student has no attempt', async () => {
      const enrollment = await enroll(studentAn.id);
      await createQuizWithConfig(0, QuizScoringMode.HIGHEST);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      const row = roster.data.find((r) => r.enrollmentId === enrollment.id);
      expect(row!.quizScore).toBeNull();
    });

    it('uses HIGHEST across attempts', async () => {
      const enrollment = await enroll(studentAn.id);
      const quiz = await createQuizWithConfig(0, QuizScoringMode.HIGHEST);

      await addAttempt(enrollment.id, quiz.id, 50, 1);
      await addAttempt(enrollment.id, quiz.id, 100, 2);
      await addAttempt(enrollment.id, quiz.id, 50, 3);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      expect(roster.data[0].quizScore).toBe(100);
    });

    it('uses LATEST across attempts (highest attemptNumber)', async () => {
      const enrollment = await enroll(studentAn.id);
      const quiz = await createQuizWithConfig(0, QuizScoringMode.LATEST);

      await addAttempt(enrollment.id, quiz.id, 50, 1);
      await addAttempt(enrollment.id, quiz.id, 100, 2);
      await addAttempt(enrollment.id, quiz.id, 50, 3);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      expect(roster.data[0].quizScore).toBe(50);
    });

    it('uses AVERAGE across attempts, rounded to 2 decimals', async () => {
      const enrollment = await enroll(studentAn.id);
      const quiz = await createQuizWithConfig(0, QuizScoringMode.AVERAGE);

      await addAttempt(enrollment.id, quiz.id, 50, 1);
      await addAttempt(enrollment.id, quiz.id, 100, 2);
      await addAttempt(enrollment.id, quiz.id, 50, 3);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      // (50 + 100 + 50) / 3 = 66.666... -> 66.67
      expect(roster.data[0].quizScore).toBe(66.67);
    });

    it('averages the per-quiz final scores across multiple quizzes', async () => {
      const enrollment = await enroll(studentAn.id);
      const q1 = await createQuizWithConfig(0, QuizScoringMode.HIGHEST, 'Q1');
      const q2 = await createQuizWithConfig(1, QuizScoringMode.AVERAGE, 'Q2');

      // Q1 HIGHEST -> 100
      await addAttempt(enrollment.id, q1.id, 50, 1);
      await addAttempt(enrollment.id, q1.id, 100, 2);

      // Q2 AVERAGE -> 50
      await addAttempt(enrollment.id, q2.id, 50, 1);
      await addAttempt(enrollment.id, q2.id, 50, 2);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      // mean(100, 50) = 75
      expect(roster.data[0].quizScore).toBe(75);
    });

    it('ignores IN_PROGRESS attempts and quizzes without attempts', async () => {
      const enrollment = await enroll(studentAn.id);
      const q1 = await createQuizWithConfig(0, QuizScoringMode.HIGHEST, 'Q1');
      await createQuizWithConfig(1, QuizScoringMode.HIGHEST, 'Q2-no-attempt');

      await addAttempt(enrollment.id, q1.id, 30, 1, QuizAttemptStatus.IN_PROGRESS);
      await addAttempt(enrollment.id, q1.id, 80, 2, QuizAttemptStatus.SUBMITTED);

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      // Only the SUBMITTED attempt counts -> Q1 final = 80. Q2 has no attempt -> ignored.
      expect(roster.data[0].quizScore).toBe(80);
    });

    it('does not leak one student quiz score into another', async () => {
      const enrollmentAn = await enroll(studentAn.id);
      const enrollmentBinh = await enroll(studentBinh.id);
      const quiz = await createQuizWithConfig(0, QuizScoringMode.HIGHEST);

      await addAttempt(enrollmentAn.id, quiz.id, 100, 1);
      // Binh has no attempt

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      const rowAn = roster.data.find((r) => r.enrollmentId === enrollmentAn.id);
      const rowBinh = roster.data.find((r) => r.enrollmentId === enrollmentBinh.id);

      expect(rowAn!.quizScore).toBe(100);
      expect(rowBinh!.quizScore).toBeNull();
    });
  });

  // ===========================================================================
  // FR-EN-07 — DRAFT course is still visible to the owner
  // ===========================================================================
  describe('FR-EN-07', () => {
    it('still returns the roster when the course is DRAFT', async () => {
      await enroll(studentAn.id);
      await prisma.course.update({
        where: { id: courseId },
        data: { status: CourseStatus.DRAFT },
      });

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      expect(roster.data).toHaveLength(1);
      expect(roster.data[0].student.email).toBe(studentAn.email);
    });

    it('still returns the roster when the course is suspended', async () => {
      await enroll(studentAn.id);
      await prisma.course.update({
        where: { id: courseId },
        data: { isSuspended: true },
      });

      const roster = await service.listCourseRoster(lecturer.id, courseId, {});
      expect(roster.data).toHaveLength(1);
    });
  });
});
