// test/deadline.e2e-spec.ts
import {
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  QuizAttemptStatus,
  QuizScoringMode,
} from '../src/generated/prisma/enums.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { registerUser, type TestUser } from './support/users.js';

describe('Deadline (e2e)', () => {
  let testApp: TestApp;
  let lecturerA: TestUser;
  let student: TestUser;
  let otherStudent: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);

    lecturerA = await registerUser(testApp, 'LECTURER');
    student = await registerUser(testApp, 'STUDENT');
    otherStudent = await registerUser(testApp, 'STUDENT');
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function createCourse(overrides: {
    lecturerId: string;
    title?: string;
    status?: CourseStatus;
    isSuspended?: boolean;
  }) {
    return testApp.prisma.course.create({
      data: {
        title: overrides.title ?? 'Course',
        lecturerId: overrides.lecturerId,
        ...(overrides.status !== undefined && { status: overrides.status }),
        ...(overrides.isSuspended !== undefined && { isSuspended: overrides.isSuspended }),
      },
    });
  }

  function enroll(userId: string, courseId: string, status: EnrollmentStatus) {
    return testApp.prisma.enrollment.create({
      data: { userId, courseId, status },
    });
  }

  async function createQuizBlock(
    courseId: string,
    options: {
      title?: string;
      deadline?: Date | null;
      allowLate?: boolean;
      maxAttempts?: number;
    } = {},
  ) {
    return testApp.prisma.courseBlock.create({
      data: {
        courseId,
        type: BlockType.QUIZ,
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

  function daysFromNow(days: number) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  describe('auth', () => {
    it('should return 401 without token', async () => {
      await testApp.http().get('/api/users/me/deadlines').expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------
  describe('GET /api/users/me/deadlines', () => {
    it('should return upcoming deadlines for active enrollments, soonest first', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
        title: 'NestJS',
      });
      await enroll(student.id, course.id, EnrollmentStatus.ACTIVE);

      const later = await createQuizBlock(course.id, {
        title: 'Later',
        deadline: daysFromNow(10),
        maxAttempts: 3,
      });
      const soon = await createQuizBlock(course.id, {
        title: 'Soon',
        deadline: daysFromNow(2),
        allowLate: true,
        maxAttempts: 1,
      });

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body.map((d: { title: string }) => d.title)).toEqual(['Soon', 'Later']);
      expect(res.body[0]).toMatchObject({
        courseId: course.id,
        courseTitle: 'NestJS',
        blockId: soon.id,
        title: 'Soon',
        allowLate: true,
        attemptsUsed: 0,
        maxAttempts: 1,
      });
      expect(res.body[1].blockId).toBe(later.id);
      expect(res.body[1].maxAttempts).toBe(3);
    });

    it('should count attemptsUsed correctly', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      const enrollment = await enroll(student.id, course.id, EnrollmentStatus.ACTIVE);
      const quiz = await createQuizBlock(course.id, {
        deadline: daysFromNow(3),
        maxAttempts: 5,
      });

      await testApp.prisma.quizAttempt.createMany({
        data: [
          {
            enrollmentId: enrollment.id,
            courseBlockId: quiz.id,
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
            courseBlockId: quiz.id,
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

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].attemptsUsed).toBe(2);
      expect(res.body[0].maxAttempts).toBe(5);
    });

    it('should return [] when the student has no active enrollments', async () => {
      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Exclusions
  // ---------------------------------------------------------------------------
  describe('exclusions', () => {
    it('should exclude DRAFT courses', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });
      await enroll(student.id, course.id, EnrollmentStatus.ACTIVE);
      await createQuizBlock(course.id, { deadline: daysFromNow(1) });

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);
      expect(res.body).toEqual([]);
    });

    it('should exclude suspended courses', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });
      await enroll(student.id, course.id, EnrollmentStatus.ACTIVE);
      await createQuizBlock(course.id, { deadline: daysFromNow(1) });

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);
      expect(res.body).toEqual([]);
    });

    it('should exclude LEFT enrollments', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      await enroll(student.id, course.id, EnrollmentStatus.LEFT);
      await createQuizBlock(course.id, { deadline: daysFromNow(1) });

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);
      expect(res.body).toEqual([]);
    });

    it('should exclude quizzes whose deadline is in the past', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      await enroll(student.id, course.id, EnrollmentStatus.ACTIVE);
      await createQuizBlock(course.id, { deadline: daysFromNow(-1) });

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);
      expect(res.body).toEqual([]);
    });

    it('should exclude quizzes whose deadline is beyond the window', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      await enroll(student.id, course.id, EnrollmentStatus.ACTIVE);
      await createQuizBlock(course.id, { deadline: daysFromNow(60) });

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);
      expect(res.body).toEqual([]);
    });

    it('should exclude quizzes with no deadline', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      await enroll(student.id, course.id, EnrollmentStatus.ACTIVE);
      await createQuizBlock(course.id, { deadline: null });

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);
      expect(res.body).toEqual([]);
    });

    it('should not leak deadlines from another user\u2019s enrollments', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      await enroll(otherStudent.id, course.id, EnrollmentStatus.ACTIVE);
      await createQuizBlock(course.id, { deadline: daysFromNow(1) });

      const res = await testApp.http().get('/api/users/me/deadlines').set(student.auth).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // days param validation
  // ---------------------------------------------------------------------------
  describe('days param', () => {
    it('should respect ?days=3 and exclude quizzes beyond it', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      await enroll(student.id, course.id, EnrollmentStatus.ACTIVE);
      const inside = await createQuizBlock(course.id, { deadline: daysFromNow(2) });
      await createQuizBlock(course.id, { deadline: daysFromNow(10) });

      const res = await testApp
        .http()
        .get('/api/users/me/deadlines')
        .query({ days: 3 })
        .set(student.auth)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].blockId).toBe(inside.id);
    });

    it('should reject days=0 with 400', async () => {
      await testApp
        .http()
        .get('/api/users/me/deadlines')
        .query({ days: 0 })
        .set(student.auth)
        .expect(400);
    });

    it('should reject days > 90 with 400', async () => {
      await testApp
        .http()
        .get('/api/users/me/deadlines')
        .query({ days: 100 })
        .set(student.auth)
        .expect(400);
    });
  });
});
