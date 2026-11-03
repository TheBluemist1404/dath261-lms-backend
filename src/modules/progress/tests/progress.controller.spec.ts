import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockType, EnrollmentStatus, UserRole } from '../../../generated/prisma/client.js';

import { ProgressController } from './../progress.controller.js';
import { ProgressService } from './../progress.service.js';

describe('ProgressController', () => {
  let controller: ProgressController;

  const STUDENT_ID = 'student-1';
  const LECTURER_ID = 'lecturer-1';
  const COURSE_ID = 'course-1';
  const BLOCK_ID = 'block-1';
  const ENROLLMENT_ID = 'enrollment-1';

  const progressServiceMock = {
    updateBlockCompletion: vi.fn(),
    updateLearningPosition: vi.fn(),
    getStudentProgress: vi.fn(),
    getResumePosition: vi.fn(),
    getLecturerStudentProgress: vi.fn(),
  };

  const studentRequest = {
    user: {
      userId: STUDENT_ID,
      role: UserRole.STUDENT,
    },
  };

  const lecturerRequest = {
    user: {
      userId: LECTURER_ID,
      role: UserRole.LECTURER,
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();

    controller = new ProgressController(progressServiceMock as unknown as ProgressService);
  });

  // ==================================================
  // UPDATE BLOCK COMPLETION
  // ==================================================

  describe('updateBlockCompletion', () => {
    it('passes authenticated Student ID and request data to service', async () => {
      const params = {
        courseId: COURSE_ID,
        blockId: BLOCK_ID,
      };

      const dto = {
        completed: true,
      };

      const expectedResponse = {
        id: 'progress-1',
        courseBlockId: BLOCK_ID,
        completed: true,
        completedAt: new Date(),
        lastVisitedAt: null,
      };

      progressServiceMock.updateBlockCompletion.mockResolvedValue(expectedResponse);

      const result = await controller.updateBlockCompletion(
        params as never,
        dto,
        studentRequest as never,
      );

      expect(progressServiceMock.updateBlockCompletion).toHaveBeenCalledWith(
        STUDENT_ID,
        COURSE_ID,
        BLOCK_ID,
        dto,
      );

      expect(result).toEqual(expectedResponse);
    });

    it('passes false when Student unmarks a block', async () => {
      const params = {
        courseId: COURSE_ID,
        blockId: BLOCK_ID,
      };

      const dto = {
        completed: false,
      };

      progressServiceMock.updateBlockCompletion.mockResolvedValue({
        completed: false,
      });

      await controller.updateBlockCompletion(params as never, dto, studentRequest as never);

      expect(progressServiceMock.updateBlockCompletion).toHaveBeenCalledWith(
        STUDENT_ID,
        COURSE_ID,
        BLOCK_ID,
        dto,
      );
    });

    it('propagates service errors', async () => {
      progressServiceMock.updateBlockCompletion.mockRejectedValue(new Error('Service error'));

      await expect(
        controller.updateBlockCompletion(
          {
            courseId: COURSE_ID,
            blockId: BLOCK_ID,
          } as never,
          { completed: true },
          studentRequest as never,
        ),
      ).rejects.toThrow('Service error');
    });
  });

  // ==================================================
  // UPDATE LEARNING POSITION
  // ==================================================

  describe('updateLearningPosition', () => {
    it('passes resumeData to service', async () => {
      const params = {
        courseId: COURSE_ID,
        blockId: BLOCK_ID,
      };

      const dto = {
        resumeData: {
          version: 1 as const,
          type: BlockType.VIDEO,
          data: {
            positionSeconds: 125,
            durationSeconds: 900,
          },
        },
      };

      const expectedResponse = {
        id: 'progress-1',
        courseBlockId: BLOCK_ID,
        completed: false,
        completedAt: null,
        lastVisitedAt: new Date(),
      };

      progressServiceMock.updateLearningPosition.mockResolvedValue(expectedResponse);

      const result = await controller.updateLearningPosition(
        params as never,
        dto,
        studentRequest as never,
      );

      expect(progressServiceMock.updateLearningPosition).toHaveBeenCalledWith(
        STUDENT_ID,
        COURSE_ID,
        BLOCK_ID,
        dto,
      );

      expect(result).toEqual(expectedResponse);
    });

    it('passes empty DTO when only updating lastVisitedAt', async () => {
      progressServiceMock.updateLearningPosition.mockResolvedValue({
        lastVisitedAt: new Date(),
      });

      await controller.updateLearningPosition(
        {
          courseId: COURSE_ID,
          blockId: BLOCK_ID,
        } as never,
        {},
        studentRequest as never,
      );

      expect(progressServiceMock.updateLearningPosition).toHaveBeenCalledWith(
        STUDENT_ID,
        COURSE_ID,
        BLOCK_ID,
        {},
      );
    });
  });

  // ==================================================
  // GET STUDENT PROGRESS
  // ==================================================

  describe('getStudentProgress', () => {
    it('returns the current Student progress', async () => {
      const expectedResponse = {
        enrollmentId: ENROLLMENT_ID,
        enrollmentStatus: EnrollmentStatus.ACTIVE,
        progress: {
          totalItems: 5,
          completedItems: 3,
          learningProgressPercentage: 60,
          totalQuizzes: 1,
          completedQuizzes: 1,
          quizCompletionPercentage: 100,
        },
        items: [],
      };

      progressServiceMock.getStudentProgress.mockResolvedValue(expectedResponse);

      const result = await controller.getStudentProgress(
        { courseId: COURSE_ID } as never,
        studentRequest as never,
      );

      expect(progressServiceMock.getStudentProgress).toHaveBeenCalledWith(STUDENT_ID, COURSE_ID);

      expect(result).toEqual(expectedResponse);
    });
  });

  // ==================================================
  // GET RESUME POSITION
  // ==================================================

  describe('getResumePosition', () => {
    it('returns empty resume state when no block was visited', async () => {
      const expectedResponse = {
        hasResumePosition: false,
        lastVisitedAt: null,
        block: null,
        resumeData: null,
      };

      progressServiceMock.getResumePosition.mockResolvedValue(expectedResponse);

      const result = await controller.getResumePosition(
        { courseId: COURSE_ID } as never,
        studentRequest as never,
      );

      expect(progressServiceMock.getResumePosition).toHaveBeenCalledWith(STUDENT_ID, COURSE_ID);

      expect(result).toEqual(expectedResponse);
    });

    it('returns the most recently visited block', async () => {
      const expectedResponse = {
        hasResumePosition: true,
        lastVisitedAt: new Date(),
        block: {
          id: BLOCK_ID,
          type: BlockType.VIDEO,
          title: 'Introduction video',
          position: 1,
          parentModuleId: null,
        },
        resumeData: {
          version: 1,
          type: BlockType.VIDEO,
          data: {
            positionSeconds: 125,
          },
        },
      };

      progressServiceMock.getResumePosition.mockResolvedValue(expectedResponse);

      const result = await controller.getResumePosition(
        { courseId: COURSE_ID } as never,
        studentRequest as never,
      );

      expect(result).toEqual(expectedResponse);
    });
  });

  // ==================================================
  // LECTURER: GET STUDENT PROGRESS
  // ==================================================

  describe('getLecturerStudentProgress', () => {
    it('uses authenticated Lecturer ID and requested enrollment ID', async () => {
      const params = {
        courseId: COURSE_ID,
        enrollmentId: ENROLLMENT_ID,
      };

      const expectedResponse = {
        enrollment: {
          id: ENROLLMENT_ID,
          status: EnrollmentStatus.ACTIVE,
          enrolledAt: new Date(),
          leftAt: null,
          completedAt: null,
        },
        student: {
          id: STUDENT_ID,
          email: 'student@example.com',
          firstName: null,
          lastName: 'Student',
        },
        progress: {
          totalItems: 5,
          completedItems: 3,
          learningProgressPercentage: 60,
          totalQuizzes: 1,
          completedQuizzes: 1,
          quizCompletionPercentage: 100,
        },
        items: [],
        quizAttempts: [],
        assignmentSubmissions: [],
      };

      progressServiceMock.getLecturerStudentProgress.mockResolvedValue(expectedResponse);

      const result = await controller.getLecturerStudentProgress(
        params as never,
        lecturerRequest as never,
      );

      expect(progressServiceMock.getLecturerStudentProgress).toHaveBeenCalledWith(
        LECTURER_ID,
        COURSE_ID,
        ENROLLMENT_ID,
      );

      expect(result).toEqual(expectedResponse);
    });
  });
});
