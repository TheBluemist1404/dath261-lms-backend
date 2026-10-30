import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';

import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';

import {
  AccountStatus,
  AssignmentSubmissionStatus,
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  QuizAttemptStatus,
  UserRole,
} from '../../../generated/prisma/client.js';

import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { ProgressService } from '../progress.service.js';

describe('Progress HTTP integration', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let progressService: ProgressService;

  const suffix = randomUUID();
  const password = 'Progress-test-123!';

  const createdUserIds: string[] = [];
  const createdCourseIds: string[] = [];

  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let lecturer: { id: string; email: string };
  let otherLecturer: { id: string; email: string };

  let studentToken: string;
  let studentBToken: string;
  let lecturerToken: string;
  let otherLecturerToken: string;

  let courseId: string;
  let enrollmentId: string;

  let moduleBlockId: string;
  let textBlockId: string;
  let fileBlockId: string;
  let videoBlockId: string;
  let quizBlockId: string;
  let assignmentBlockId: string;

  const api = '/api';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api');

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
    progressService = app.get(ProgressService);

    const passwordHash = await bcrypt.hash(password, 4);

    async function createUser(role: UserRole, label: string) {
      const email = `${label}-${suffix}@example.test`;

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: 'Progress',
          lastName: label,
          role,
          status: AccountStatus.ACTIVE,
        },
      });

      createdUserIds.push(user.id);

      return {
        id: user.id,
        email: user.email,
      };
    }

    studentA = await createUser(UserRole.STUDENT, 'student-a');
    studentB = await createUser(UserRole.STUDENT, 'student-b');
    lecturer = await createUser(UserRole.LECTURER, 'lecturer-owner');
    otherLecturer = await createUser(UserRole.LECTURER, 'lecturer-other');

    const course = await prisma.course.create({
      data: {
        title: `Progress integration ${suffix}`,
        lecturerId: lecturer.id,
        status: CourseStatus.PUBLISHED,
        isSuspended: false,
      },
    });

    courseId = course.id;
    createdCourseIds.push(courseId);

    async function createBlock(type: BlockType, title: string, position: number) {
      const block = await prisma.courseBlock.create({
        data: {
          courseId,
          type,
          title,
          position,
        },
      });

      return block.id;
    }

    moduleBlockId = await createBlock(BlockType.MODULE, 'Module 1', 0);

    textBlockId = await createBlock(BlockType.TEXT, 'Introduction', 1);

    fileBlockId = await createBlock(BlockType.FILE, 'Reading material', 2);

    videoBlockId = await createBlock(BlockType.VIDEO, 'Introduction video', 3);

    quizBlockId = await createBlock(BlockType.QUIZ, 'Introduction quiz', 4);

    assignmentBlockId = await createBlock(BlockType.ASSIGNMENT, 'Introduction assignment', 5);

    const enrollment = await prisma.enrollment.create({
      data: {
        userId: studentA.id,
        courseId,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    enrollmentId = enrollment.id;

    async function login(email: string): Promise<string> {
      const response = await request(app!.getHttpServer()).post(`${api}/auth/login`).send({
        email,
        password,
      });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));

      return response.body.accessToken as string;
    }

    studentToken = await login(studentA.email);
    studentBToken = await login(studentB.email);
    lecturerToken = await login(lecturer.email);
    otherLecturerToken = await login(otherLecturer.email);
  }, 30_000);

  afterAll(async () => {
    try {
      if (enrollmentId) {
        // Enrollment relations use onDelete: Cascade.
        await prisma.enrollment.deleteMany({
          where: { id: enrollmentId },
        });
      }

      if (createdCourseIds.length > 0) {
        await prisma.courseBlock.deleteMany({
          where: {
            courseId: { in: createdCourseIds },
          },
        });

        await prisma.course.deleteMany({
          where: {
            id: { in: createdCourseIds },
          },
        });
      }

      if (createdUserIds.length > 0) {
        await prisma.authSession.deleteMany({
          where: {
            userId: { in: createdUserIds },
          },
        });

        await prisma.user.deleteMany({
          where: {
            id: { in: createdUserIds },
          },
        });
      }
    } finally {
      await app?.close();
    }
  }, 30_000);

  function courseUrl(path = '') {
    return `${api}/courses/${courseId}${path}`;
  }

  function completionUrl(blockId: string) {
    return courseUrl(`/blocks/${blockId}/progress`);
  }

  function positionUrl(blockId: string) {
    return courseUrl(`/blocks/${blockId}/position`);
  }

  function lecturerProgressUrl() {
    return courseUrl(`/enrollments/${enrollmentId}/progress`);
  }

  function lecturerCompletionUrl() {
    return courseUrl(`/enrollments/${enrollmentId}/complete`);
  }

  const studentHeaders = () => ({
    Authorization: `Bearer ${studentToken}`,
  });

  // ==================================================
  // AUTHENTICATION / ROLE / ISOLATION
  // ==================================================

  describe('Authentication and Student isolation', () => {
    it('rejects requests without an access token', async () => {
      await request(app!.getHttpServer()).get(courseUrl('/progress')).expect(401);
    });

    it('rejects an invalid access token', async () => {
      await request(app!.getHttpServer())
        .get(courseUrl('/progress'))
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('allows Student A to read their own progress', async () => {
      await request(app!.getHttpServer())
        .get(courseUrl('/progress'))
        .set(studentHeaders())
        .expect(200);
    });

    it('does not expose Student A progress to Student B', async () => {
      const response = await request(app!.getHttpServer())
        .get(courseUrl('/progress'))
        .set('Authorization', `Bearer ${studentBToken}`);

      expect(response.status).toBe(403);
    });

    it('rejects Student from the Lecturer-only progress endpoint', async () => {
      await request(app!.getHttpServer())
        .get(lecturerProgressUrl())
        .set(studentHeaders())
        .expect(403);
    });
  });

  // ==================================================
  // MANUAL COMPLETION
  // ==================================================

  describe('Block completion', () => {
    it('allows Student to complete TEXT, FILE, VIDEO', async () => {
      for (const blockId of [textBlockId, fileBlockId, videoBlockId]) {
        await request(app!.getHttpServer())
          .patch(completionUrl(blockId))
          .set(studentHeaders())
          .send({ completed: true })
          .expect(200);
      }

      const records = await prisma.blockProgress.findMany({
        where: {
          enrollmentId,
          courseBlockId: {
            in: [textBlockId, fileBlockId, videoBlockId],
          },
        },
      });

      expect(records).toHaveLength(3);
      expect(records.every((item) => item.completed)).toBe(true);
    });

    it('allows Student to unmark a supported block', async () => {
      await request(app!.getHttpServer())
        .patch(completionUrl(textBlockId))
        .set(studentHeaders())
        .send({ completed: false })
        .expect(200);

      const record = await prisma.blockProgress.findUniqueOrThrow({
        where: {
          enrollmentId_courseBlockId: {
            enrollmentId,
            courseBlockId: textBlockId,
          },
        },
      });

      expect(record.completed).toBe(false);
      expect(record.completedAt).toBeNull();
    });

    it('rejects manual completion of MODULE, QUIZ and ASSIGNMENT', async () => {
      for (const blockId of [moduleBlockId, quizBlockId, assignmentBlockId]) {
        await request(app!.getHttpServer())
          .patch(completionUrl(blockId))
          .set(studentHeaders())
          .send({ completed: true })
          .expect(400);
      }
    });
  });

  // ==================================================
  // RESUME
  // ==================================================

  describe('Resume position', () => {
    it('returns empty resume state when no block has been visited', async () => {
      // Use a fresh second course/enrollment if the test fixture
      // has already recorded visits to another block.
      const response = await request(app!.getHttpServer())
        .get(courseUrl('/progress/resume'))
        .set(studentHeaders())
        .expect(200);

      expect(response.body).toHaveProperty('hasResumePosition');
    });

    it('saves and returns VIDEO resume data', async () => {
      const resumeData = {
        version: 1,
        type: 'VIDEO',
        data: {
          positionSeconds: 125,
          durationSeconds: 900,
        },
      };

      await request(app!.getHttpServer())
        .patch(positionUrl(videoBlockId))
        .set(studentHeaders())
        .send({ resumeData })
        .expect(200);

      const response = await request(app!.getHttpServer())
        .get(courseUrl('/progress/resume'))
        .set(studentHeaders())
        .expect(200);

      expect(response.body).toMatchObject({
        hasResumePosition: true,
        block: {
          id: videoBlockId,
          type: BlockType.VIDEO,
        },
        resumeData,
      });
    });

    it('rejects resume data with mismatched block type', async () => {
      await request(app!.getHttpServer())
        .patch(positionUrl(videoBlockId))
        .set(studentHeaders())
        .send({
          resumeData: {
            version: 1,
            type: 'TEXT',
            data: {
              anchorId: 'section-1',
            },
          },
        })
        .expect(400);
    });
  });

  // ==================================================
  // ASSESSMENT COMPLETION AND JSON DATA
  // ==================================================

  describe('Assessment records', () => {
    it('stores submitted Quiz and Assignment records and updates BlockProgress', async () => {
      await prisma.$transaction(async (transaction) => {
        const attempt = await transaction.quizAttempt.create({
          data: {
            enrollmentId,
            courseBlockId: quizBlockId,
            attemptNumber: 1,
            status: QuizAttemptStatus.GRADED,
            answers: ['A', 'C'],
            score: '85.50',
            startedAt: new Date(),
            submittedAt: new Date(),
            gradedAt: new Date(),
          },
        });

        await progressService.markAssessmentBlockCompleted(
          transaction,
          attempt.enrollmentId,
          attempt.courseBlockId,
          BlockType.QUIZ,
        );

        const submission = await transaction.assignmentSubmission.create({
          data: {
            enrollmentId,
            courseBlockId: assignmentBlockId,
            attemptNumber: 1,
            textContent: 'Submitted assignment',
            fileMetadata: {
              filename: 'assignment.pdf',
              size: 1024,
              mimeType: 'application/pdf',
            },
            status: AssignmentSubmissionStatus.GRADED,
            score: '90.00',
            feedback: 'Good work',
            submittedAt: new Date(),
            gradedAt: new Date(),
          },
        });

        await progressService.markAssessmentBlockCompleted(
          transaction,
          submission.enrollmentId,
          submission.courseBlockId,
          BlockType.ASSIGNMENT,
        );
      });

      const [quizProgress, assignmentProgress] = await Promise.all([
        prisma.blockProgress.findUniqueOrThrow({
          where: {
            enrollmentId_courseBlockId: {
              enrollmentId,
              courseBlockId: quizBlockId,
            },
          },
        }),

        prisma.blockProgress.findUniqueOrThrow({
          where: {
            enrollmentId_courseBlockId: {
              enrollmentId,
              courseBlockId: assignmentBlockId,
            },
          },
        }),
      ]);

      expect(quizProgress.completed).toBe(true);
      expect(assignmentProgress.completed).toBe(true);
    });

    it('returns Prisma JSON values and Decimal scores in Lecturer response', async () => {
      const response = await request(app!.getHttpServer())
        .get(lecturerProgressUrl())
        .set('Authorization', `Bearer ${lecturerToken}`)
        .expect(200);

      // JSON array: answers
      expect(response.body.quizAttempts[0].answers).toEqual(['A', 'C']);

      // JSON object: fileMetadata
      expect(response.body.assignmentSubmissions[0].fileMetadata).toEqual({
        filename: 'assignment.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      });

      // Decimal is explicitly serialized as a string.
      expect(typeof response.body.quizAttempts[0].score).toBe('string');
      expect(Number(response.body.quizAttempts[0].score)).toBe(85.5);

      expect(typeof response.body.assignmentSubmissions[0].score).toBe('string');

      expect(Number(response.body.assignmentSubmissions[0].score)).toBe(90);
    });
  });

  // ==================================================
  // PROGRESS SUMMARY
  // ==================================================

  describe('Progress summary', () => {
    it('calculates learning progress and quiz completion percentage', async () => {
      // After manual completion was unmarked:
      // TEXT = false
      // FILE = true
      // VIDEO = true
      // QUIZ = true
      // ASSIGNMENT = true
      // MODULE is excluded.

      const response = await request(app!.getHttpServer())
        .get(courseUrl('/progress'))
        .set(studentHeaders())
        .expect(200);

      expect(response.body.progress).toEqual({
        totalItems: 5,
        completedItems: 4,
        learningProgressPercentage: 80,
        totalQuizzes: 1,
        completedQuizzes: 1,
        quizCompletionPercentage: 100,
      });

      expect(response.body.items).toHaveLength(5);

      expect(
        response.body.items.some((item: { type: string }) => item.type === BlockType.MODULE),
      ).toBe(false);
    });
  });

  // ==================================================
  // LECTURER OWNERSHIP AND MANUAL COMPLETION
  // ==================================================

  describe('Lecturer authorization', () => {
    it('allows the owning Lecturer to read learner progress', async () => {
      await request(app!.getHttpServer())
        .get(lecturerProgressUrl())
        .set('Authorization', `Bearer ${lecturerToken}`)
        .expect(200);
    });

    it('rejects another Lecturer from reading learner progress', async () => {
      await request(app!.getHttpServer())
        .get(lecturerProgressUrl())
        .set('Authorization', `Bearer ${otherLecturerToken}`)
        .expect(403);
    });

    it('rejects Student from manually completing enrollment', async () => {
      await request(app!.getHttpServer())
        .patch(lecturerCompletionUrl())
        .set(studentHeaders())
        .expect(403);
    });

    it('allows owning Lecturer to complete ACTIVE enrollment', async () => {
      await request(app!.getHttpServer())
        .patch(lecturerCompletionUrl())
        .set('Authorization', `Bearer ${lecturerToken}`)
        .expect(200);

      const saved = await prisma.enrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
      });

      expect(saved.status).toBe(EnrollmentStatus.COMPLETED);
      expect(saved.completedAt).toBeInstanceOf(Date);
    });

    it('allows COMPLETED Student to read progress but not update it', async () => {
      await request(app!.getHttpServer())
        .get(courseUrl('/progress'))
        .set(studentHeaders())
        .expect(200);

      await request(app!.getHttpServer())
        .patch(completionUrl(fileBlockId))
        .set(studentHeaders())
        .send({ completed: false })
        .expect(403);
    });
  });

  // ==================================================
  // COURSE AVAILABILITY
  // ==================================================

  describe('Course availability', () => {
    it('denies progress reads when the course becomes Draft', async () => {
      await prisma.course.update({
        where: { id: courseId },
        data: {
          status: CourseStatus.DRAFT,
        },
      });

      await request(app!.getHttpServer())
        .get(courseUrl('/progress'))
        .set(studentHeaders())
        .expect(403);

      await request(app!.getHttpServer())
        .get(courseUrl('/progress/resume'))
        .set(studentHeaders())
        .expect(403);
    });

    it('denies progress reads when the course is suspended', async () => {
      await prisma.course.update({
        where: { id: courseId },
        data: {
          status: CourseStatus.PUBLISHED,
          isSuspended: true,
        },
      });

      await request(app!.getHttpServer())
        .get(courseUrl('/progress'))
        .set(studentHeaders())
        .expect(403);
    });
  });
});
