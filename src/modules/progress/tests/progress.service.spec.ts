import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssignmentSubmissionStatus,
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  QuizAttemptStatus,
} from '../../../generated/prisma/client.js';

import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { ProgressService } from './../progress.service.js';

const USER_ID = 'student-1';
const LECTURER_ID = 'lecturer-1';
const OTHER_LECTURER_ID = 'lecturer-2';
const COURSE_ID = 'course-1';
const ENROLLMENT_ID = 'enrollment-1';

const tx = {
  course: {
    findUnique: vi.fn(),
  },
  enrollment: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  courseBlock: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  blockProgress: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  quizAttempt: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  assignmentSubmission: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

const prismaMock = {
  $transaction: vi.fn(),
};

const publishedCourse: {
  id: string;
  lecturerId: string;
  status: CourseStatus;
  isSuspended: boolean;
} = {
  id: COURSE_ID,
  lecturerId: LECTURER_ID,
  status: CourseStatus.PUBLISHED,
  isSuspended: false,
};

function makeEnrollment(status: EnrollmentStatus = EnrollmentStatus.ACTIVE) {
  return {
    id: ENROLLMENT_ID,
    userId: USER_ID,
    courseId: COURSE_ID,
    status,
  };
}

function mockStudentContext(
  status: EnrollmentStatus = EnrollmentStatus.ACTIVE,
  course = publishedCourse,
) {
  tx.course.findUnique.mockResolvedValue(course);

  tx.enrollment.findUnique.mockResolvedValue({
    id: ENROLLMENT_ID,
    status,
  });
}

describe('ProgressService', () => {
  let service: ProgressService;

  beforeEach(() => {
    vi.resetAllMocks();

    prismaMock.$transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    );

    mockStudentContext();

    tx.courseBlock.findFirst.mockResolvedValue({
      id: 'block-1',
      type: BlockType.TEXT,
    });

    tx.courseBlock.findMany.mockResolvedValue([]);

    tx.blockProgress.upsert.mockResolvedValue({
      id: 'progress-1',
      enrollmentId: ENROLLMENT_ID,
      courseBlockId: 'block-1',
      completed: true,
      completedAt: new Date(),
      lastVisitedAt: null,
      resumeData: null,
    });

    tx.blockProgress.findFirst.mockResolvedValue(null);
    tx.blockProgress.findUnique.mockResolvedValue(null);

    tx.enrollment.findFirst.mockResolvedValue(makeEnrollment());
    tx.enrollment.updateMany.mockResolvedValue({ count: 1 });

    tx.quizAttempt.findFirst.mockResolvedValue({
      id: 'attempt-1',
    });
    tx.assignmentSubmission.findFirst.mockResolvedValue({
      id: 'submission-1',
    });

    tx.quizAttempt.findMany.mockResolvedValue([]);
    tx.assignmentSubmission.findMany.mockResolvedValue([]);

    service = new ProgressService(prismaMock as unknown as PrismaService);
  });

  // ==================================================
  // BLOCK COMPLETION
  // ==================================================

  describe('updateBlockCompletion', () => {
    it.each([
      BlockType.TEXT,
      BlockType.FILE,
      BlockType.VIDEO,
    ])('allows manual completion of %s', async (type) => {
      tx.courseBlock.findFirst.mockResolvedValue({
        id: 'block-1',
        type,
      });

      await service.updateBlockCompletion(USER_ID, COURSE_ID, 'block-1', {
        completed: true,
      });

      expect(tx.blockProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            enrollmentId_courseBlockId: {
              enrollmentId: ENROLLMENT_ID,
              courseBlockId: 'block-1',
            },
          },
          create: expect.objectContaining({
            completed: true,
            completedAt: expect.any(Date),
          }),
          update: expect.objectContaining({
            completed: true,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it.each([
      BlockType.MODULE,
      BlockType.QUIZ,
      BlockType.ASSIGNMENT,
    ])('rejects manual completion of %s', async (type) => {
      tx.courseBlock.findFirst.mockResolvedValue({
        id: 'block-1',
        type,
      });

      await expect(
        service.updateBlockCompletion(USER_ID, COURSE_ID, 'block-1', {
          completed: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.blockProgress.upsert).not.toHaveBeenCalled();
    });

    it('allows unmarking a supported learning block', async () => {
      await service.updateBlockCompletion(USER_ID, COURSE_ID, 'block-1', {
        completed: false,
      });

      expect(tx.blockProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            completed: false,
            completedAt: null,
          }),
          update: expect.objectContaining({
            completed: false,
            completedAt: null,
          }),
        }),
      );
    });

    it('rejects a block that does not belong to the course', async () => {
      tx.courseBlock.findFirst.mockResolvedValue(null);

      await expect(
        service.updateBlockCompletion(USER_ID, COURSE_ID, 'foreign-block', {
          completed: true,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================
  // STUDENT ACCESS
  // ==================================================

  describe('student access', () => {
    it('allows ACTIVE Student to read progress', async () => {
      mockStudentContext(EnrollmentStatus.ACTIVE);

      const result = await service.getStudentProgress(USER_ID, COURSE_ID);

      expect(result.enrollmentStatus).toBe(EnrollmentStatus.ACTIVE);
    });

    it('allows COMPLETED Student to read progress', async () => {
      mockStudentContext(EnrollmentStatus.COMPLETED);

      const result = await service.getStudentProgress(USER_ID, COURSE_ID);

      expect(result.enrollmentStatus).toBe(EnrollmentStatus.COMPLETED);
    });

    it('rejects LEFT Student from reading progress', async () => {
      mockStudentContext(EnrollmentStatus.LEFT);

      await expect(service.getStudentProgress(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects progress reads when course is Draft', async () => {
      mockStudentContext(EnrollmentStatus.ACTIVE, {
        ...publishedCourse,
        status: CourseStatus.DRAFT,
      });

      await expect(service.getStudentProgress(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects progress reads when course is suspended', async () => {
      mockStudentContext(EnrollmentStatus.ACTIVE, {
        ...publishedCourse,
        isSuspended: true,
      });

      await expect(service.getStudentProgress(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects writes from COMPLETED enrollment', async () => {
      mockStudentContext(EnrollmentStatus.COMPLETED);

      await expect(
        service.updateBlockCompletion(USER_ID, COURSE_ID, 'block-1', {
          completed: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ==================================================
  // RESUME DATA
  // ==================================================

  describe('updateLearningPosition', () => {
    it('saves valid VIDEO resume data', async () => {
      tx.courseBlock.findFirst.mockResolvedValue({
        id: 'video-1',
        type: BlockType.VIDEO,
      });

      const resumeData = {
        version: 1 as const,
        type: BlockType.VIDEO,
        data: {
          positionSeconds: 125,
          durationSeconds: 900,
        },
      };

      await service.updateLearningPosition(USER_ID, COURSE_ID, 'video-1', {
        resumeData,
      });

      expect(tx.blockProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            resumeData,
            lastVisitedAt: expect.any(Date),
          }),
          update: expect.objectContaining({
            resumeData,
            lastVisitedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('preserves existing resumeData when the field is omitted', async () => {
      tx.courseBlock.findFirst.mockResolvedValue({
        id: 'video-1',
        type: BlockType.VIDEO,
      });

      await service.updateLearningPosition(USER_ID, COURSE_ID, 'video-1', {});

      const args = tx.blockProgress.upsert.mock.calls[0][0];

      expect(args.update.lastVisitedAt).toBeInstanceOf(Date);
      expect(args.update).not.toHaveProperty('resumeData');
    });

    it('clears resumeData when null is provided', async () => {
      tx.courseBlock.findFirst.mockResolvedValue({
        id: 'video-1',
        type: BlockType.VIDEO,
      });

      await service.updateLearningPosition(USER_ID, COURSE_ID, 'video-1', {
        resumeData: null,
      });

      const args = tx.blockProgress.upsert.mock.calls[0][0];

      expect(args.update.resumeData).toBe(Prisma.JsonNull);
    });

    it('rejects MODULE resume positions', async () => {
      tx.courseBlock.findFirst.mockResolvedValue({
        id: 'module-1',
        type: BlockType.MODULE,
      });

      await expect(
        service.updateLearningPosition(USER_ID, COURSE_ID, 'module-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects resumeData with mismatched block type', async () => {
      tx.courseBlock.findFirst.mockResolvedValue({
        id: 'video-1',
        type: BlockType.VIDEO,
      });

      await expect(
        service.updateLearningPosition(USER_ID, COURSE_ID, 'video-1', {
          resumeData: {
            version: 1,
            type: BlockType.TEXT,
            data: {},
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unsupported resumeData version', async () => {
      tx.courseBlock.findFirst.mockResolvedValue({
        id: 'video-1',
        type: BlockType.VIDEO,
      });

      await expect(
        service.updateLearningPosition(USER_ID, COURSE_ID, 'video-1', {
          resumeData: {
            version: 2,
            type: BlockType.VIDEO,
            data: {},
          } as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getResumePosition', () => {
    it('returns empty state when no previous visit exists', async () => {
      const result = await service.getResumePosition(USER_ID, COURSE_ID);

      expect(result).toEqual({
        hasResumePosition: false,
        lastVisitedAt: null,
        block: null,
        resumeData: null,
      });
    });

    it('returns the latest visited block and JSON resume data', async () => {
      const visitedAt = new Date();

      const resumeData = {
        version: 1,
        type: BlockType.VIDEO,
        data: {
          positionSeconds: 125,
        },
      };

      tx.blockProgress.findFirst.mockResolvedValue({
        lastVisitedAt: visitedAt,
        resumeData,
        courseBlock: {
          id: 'video-1',
          type: BlockType.VIDEO,
          title: 'Introduction video',
          position: 2,
          parentModuleId: null,
        },
      });

      const result = await service.getResumePosition(USER_ID, COURSE_ID);

      expect(result).toEqual({
        hasResumePosition: true,
        lastVisitedAt: visitedAt,
        block: {
          id: 'video-1',
          type: BlockType.VIDEO,
          title: 'Introduction video',
          position: 2,
          parentModuleId: null,
        },
        resumeData,
      });
    });
  });

  // ==================================================
  // PROGRESS CALCULATION
  // ==================================================

  describe('getStudentProgress', () => {
    it('derives learning progress and quiz percentage', async () => {
      tx.courseBlock.findMany.mockResolvedValue([
        {
          id: 'text-1',
          type: BlockType.TEXT,
          title: 'Text',
          position: 1,
          parentModuleId: null,
          progressEntries: [{ completed: true, completedAt: new Date() }],
        },
        {
          id: 'file-1',
          type: BlockType.FILE,
          title: 'File',
          position: 2,
          parentModuleId: null,
          progressEntries: [],
        },
        {
          id: 'video-1',
          type: BlockType.VIDEO,
          title: 'Video',
          position: 3,
          parentModuleId: null,
          progressEntries: [{ completed: true, completedAt: new Date() }],
        },
        {
          id: 'quiz-1',
          type: BlockType.QUIZ,
          title: 'Quiz',
          position: 4,
          parentModuleId: null,
          progressEntries: [{ completed: true, completedAt: new Date() }],
        },
        {
          id: 'assignment-1',
          type: BlockType.ASSIGNMENT,
          title: 'Assignment',
          position: 5,
          parentModuleId: null,
          progressEntries: [],
        },
      ]);

      const result = await service.getStudentProgress(USER_ID, COURSE_ID);

      expect(result.progress).toEqual({
        totalItems: 5,
        completedItems: 3,
        learningProgressPercentage: 60,
        totalQuizzes: 1,
        completedQuizzes: 1,
        quizCompletionPercentage: 100,
      });

      expect(result.items).toHaveLength(5);
      expect(result.items.some((item) => item.type === BlockType.MODULE)).toBe(false);
    });

    it('returns zero percentages when no learning blocks exist', async () => {
      tx.courseBlock.findMany.mockResolvedValue([]);

      const result = await service.getStudentProgress(USER_ID, COURSE_ID);

      expect(result.progress).toEqual({
        totalItems: 0,
        completedItems: 0,
        learningProgressPercentage: 0,
        totalQuizzes: 0,
        completedQuizzes: 0,
        quizCompletionPercentage: 0,
      });
    });
  });

  // ==================================================
  // ASSESSMENT COMPLETION
  // ==================================================

  describe('markAssessmentBlockCompleted', () => {
    function mockAssessment(type: typeof BlockType.QUIZ | typeof BlockType.ASSIGNMENT) {
      tx.enrollment.findUnique.mockResolvedValue({
        ...makeEnrollment(),
        course: {
          status: CourseStatus.PUBLISHED,
          isSuspended: false,
        },
      });

      tx.courseBlock.findUnique.mockResolvedValue({
        id: 'assessment-1',
        courseId: COURSE_ID,
        type,
      });

      tx.blockProgress.findUnique.mockResolvedValue(null);
    }

    it('marks Quiz completed only when a submitted attempt exists', async () => {
      mockAssessment(BlockType.QUIZ);

      tx.quizAttempt.findFirst.mockResolvedValue({
        id: 'attempt-1',
        status: QuizAttemptStatus.SUBMITTED,
      });

      await service.markAssessmentBlockCompleted(
        tx as unknown as Prisma.TransactionClient,
        ENROLLMENT_ID,
        'assessment-1',
        BlockType.QUIZ,
      );

      expect(tx.blockProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            completed: true,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects Quiz completion without a submitted attempt', async () => {
      mockAssessment(BlockType.QUIZ);
      tx.quizAttempt.findFirst.mockResolvedValue(null);

      await expect(
        service.markAssessmentBlockCompleted(
          tx as unknown as Prisma.TransactionClient,
          ENROLLMENT_ID,
          'assessment-1',
          BlockType.QUIZ,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.blockProgress.upsert).not.toHaveBeenCalled();
    });

    it('marks Assignment completed only when a submission exists', async () => {
      mockAssessment(BlockType.ASSIGNMENT);

      tx.assignmentSubmission.findFirst.mockResolvedValue({
        id: 'submission-1',
        status: AssignmentSubmissionStatus.SUBMITTED,
      });

      await service.markAssessmentBlockCompleted(
        tx as unknown as Prisma.TransactionClient,
        ENROLLMENT_ID,
        'assessment-1',
        BlockType.ASSIGNMENT,
      );

      expect(tx.blockProgress.upsert).toHaveBeenCalled();
    });

    it('rejects Assignment completion without a submission', async () => {
      mockAssessment(BlockType.ASSIGNMENT);
      tx.assignmentSubmission.findFirst.mockResolvedValue(null);

      await expect(
        service.markAssessmentBlockCompleted(
          tx as unknown as Prisma.TransactionClient,
          ENROLLMENT_ID,
          'assessment-1',
          BlockType.ASSIGNMENT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.blockProgress.upsert).not.toHaveBeenCalled();
    });

    it('does not overwrite an existing completion timestamp', async () => {
      mockAssessment(BlockType.QUIZ);

      tx.blockProgress.findUnique.mockResolvedValue({
        completed: true,
      });

      await service.markAssessmentBlockCompleted(
        tx as unknown as Prisma.TransactionClient,
        ENROLLMENT_ID,
        'assessment-1',
        BlockType.QUIZ,
      );

      expect(tx.blockProgress.upsert).not.toHaveBeenCalled();
    });
  });

  // ==================================================
  // LECTURER RESPONSE AND OWNERSHIP
  // ==================================================

  describe('getLecturerStudentProgress', () => {
    it('returns Prisma JSON values and serializes Decimal scores', async () => {
      const answers = ['A', 'C'];
      const fileMetadata = {
        filename: 'submission.pdf',
        size: 1024,
      };

      tx.course.findUnique.mockResolvedValue(publishedCourse);

      tx.enrollment.findFirst.mockResolvedValue({
        ...makeEnrollment(),
        enrolledAt: new Date('2026-01-01T00:00:00Z'),
        leftAt: null,
        completedAt: null,
        user: {
          id: USER_ID,
          email: 'student@example.test',
          firstName: null,
          lastName: 'Student',
        },
      });

      tx.courseBlock.findMany.mockResolvedValue([]);

      tx.quizAttempt.findMany.mockResolvedValue([
        {
          id: 'attempt-1',
          courseBlockId: 'quiz-1',
          attemptNumber: 1,
          status: QuizAttemptStatus.GRADED,
          answers,
          score: { toString: () => '85.50' },
          startedAt: new Date(),
          submittedAt: new Date(),
          gradedAt: new Date(),
          quizBlock: {
            title: 'Networking Quiz',
          },
        },
      ]);

      tx.assignmentSubmission.findMany.mockResolvedValue([
        {
          id: 'submission-1',
          courseBlockId: 'assignment-1',
          attemptNumber: 1,
          textContent: null,
          fileMetadata,
          status: AssignmentSubmissionStatus.GRADED,
          score: { toString: () => '90.00' },
          feedback: 'Good work',
          submittedAt: new Date(),
          gradedAt: new Date(),
          assignmentBlock: {
            title: 'Networking Assignment',
          },
        },
      ]);

      const result = await service.getLecturerStudentProgress(
        LECTURER_ID,
        COURSE_ID,
        ENROLLMENT_ID,
      );

      expect(result.student.firstName).toBeNull();

      // JSON arrays must not be incorrectly restricted to objects.
      expect(result.quizAttempts[0].answers).toEqual(answers);

      // JSON objects must also be preserved.
      expect(result.assignmentSubmissions[0].fileMetadata).toEqual(fileMetadata);

      expect(result.quizAttempts[0].score).toBe('85.50');
      expect(result.assignmentSubmissions[0].score).toBe('90.00');
    });

    it('rejects Lecturer who does not own the course', async () => {
      tx.course.findUnique.mockResolvedValue(publishedCourse);

      await expect(
        service.getLecturerStudentProgress(OTHER_LECTURER_ID, COURSE_ID, ENROLLMENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(tx.enrollment.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an enrollment belonging to another course', async () => {
      tx.course.findUnique.mockResolvedValue(publishedCourse);
      tx.enrollment.findFirst.mockResolvedValue(null);

      await expect(
        service.getLecturerStudentProgress(LECTURER_ID, COURSE_ID, ENROLLMENT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('completeEnrollment', () => {
    it('allows the owning Lecturer to complete an ACTIVE enrollment', async () => {
      tx.course.findUnique.mockResolvedValue(publishedCourse);
      tx.enrollment.findFirst.mockResolvedValue(makeEnrollment(EnrollmentStatus.ACTIVE));

      const result = await service.completeEnrollment(LECTURER_ID, COURSE_ID, ENROLLMENT_ID);

      expect(tx.enrollment.updateMany).toHaveBeenCalledWith({
        where: {
          id: ENROLLMENT_ID,
          courseId: COURSE_ID,
          status: EnrollmentStatus.ACTIVE,
        },
        data: {
          status: EnrollmentStatus.COMPLETED,
          completedAt: expect.any(Date),
        },
      });

      expect(result.status).toBe(EnrollmentStatus.COMPLETED);
    });

    it('rejects Lecturer who does not own the course', async () => {
      tx.course.findUnique.mockResolvedValue(publishedCourse);

      await expect(
        service.completeEnrollment(OTHER_LECTURER_ID, COURSE_ID, ENROLLMENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(tx.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      EnrollmentStatus.LEFT,
      EnrollmentStatus.COMPLETED,
    ])('rejects completion from %s enrollment', async (status) => {
      tx.course.findUnique.mockResolvedValue(publishedCourse);
      tx.enrollment.findFirst.mockResolvedValue(makeEnrollment(status));

      await expect(
        service.completeEnrollment(LECTURER_ID, COURSE_ID, ENROLLMENT_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
