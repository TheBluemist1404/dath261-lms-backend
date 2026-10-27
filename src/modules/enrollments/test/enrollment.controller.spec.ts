import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnrollmentStatus, UserRole } from '../../../generated/prisma/client.js';
import { CourseIdParamDto } from '../dto/course-id-param.dto.js';
import { EnrollmentController } from './../enrollment.controller.js';
import { EnrollmentService } from './../enrollment.service.js';

const USER_ID = 'student-1';
const COURSE_ID = 'course-1';

const serviceMock = {
  enroll: vi.fn(),
  leave: vi.fn(),
  getMyEnrollments: vi.fn(),
  getCourseEnrollmentState: vi.fn(),
};

describe('EnrollmentController', () => {
  let controller: EnrollmentController;

  const request = {
    user: {
      userId: USER_ID,
      role: UserRole.STUDENT,
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();

    controller = new EnrollmentController(serviceMock as unknown as EnrollmentService);
  });

  it('enrolls the authenticated student and returns the action response', async () => {
    serviceMock.enroll.mockResolvedValue({
      id: 'enrollment-1',
      userId: USER_ID,
      courseId: COURSE_ID,
      status: EnrollmentStatus.ACTIVE,
    });

    const result = await controller.enroll({ courseId: COURSE_ID }, request as never);

    expect(serviceMock.enroll).toHaveBeenCalledWith(USER_ID, COURSE_ID);

    expect(result).toEqual({
      enrollmentId: 'enrollment-1',
      courseId: COURSE_ID,
      status: EnrollmentStatus.ACTIVE,
      canAccessCourse: true,
    });
  });

  it('leaves the course for the authenticated student', async () => {
    serviceMock.leave.mockResolvedValue({
      id: 'enrollment-1',
      userId: USER_ID,
      courseId: COURSE_ID,
      status: EnrollmentStatus.LEFT,
    });

    const result = await controller.leave({ courseId: COURSE_ID }, request as never);

    expect(serviceMock.leave).toHaveBeenCalledWith(USER_ID, COURSE_ID);

    expect(result).toEqual({
      enrollmentId: 'enrollment-1',
      courseId: COURSE_ID,
      status: EnrollmentStatus.LEFT,
      canAccessCourse: false,
    });
  });

  it('passes pagination parameters to the service for My Courses', async () => {
    const query = {
      page: 2,
      limit: 10,
    };

    const response = {
      data: [],
      meta: {
        page: 2,
        limit: 10,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    };

    serviceMock.getMyEnrollments.mockResolvedValue(response);

    const result = await controller.getMyEnrollments(request as never, query as never);

    expect(serviceMock.getMyEnrollments).toHaveBeenCalledWith(USER_ID, query);
    expect(result).toEqual(response);
  });

  it('returns the authenticated student enrollment state', async () => {
    const state = {
      courseId: COURSE_ID,
      enrollmentId: 'enrollment-1',
      enrollmentStatus: EnrollmentStatus.ACTIVE,
      enrolledAt: new Date(),
      leftAt: null,
      completedAt: null,
      courseAvailable: true,
      canAccessCourse: true,
    };

    serviceMock.getCourseEnrollmentState.mockResolvedValue(state);

    const result = await controller.getCourseEnrollmentState(
      { courseId: COURSE_ID },
      request as never,
    );

    expect(serviceMock.getCourseEnrollmentState).toHaveBeenCalledWith(USER_ID, COURSE_ID);

    expect(result).toEqual(state);
  });
});
