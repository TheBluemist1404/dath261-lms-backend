import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import {
  AccountStatus,
  CourseStatus,
  EnrollmentStatus,
  UserRole,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';

describe('Enrollment HTTP integration', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;

  const password = 'Test-password-123!';
  const suffix = randomUUID();

  const createdUserIds: string[] = [];
  const createdCourseIds: string[] = [];

  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let lecturer: { id: string; email: string };

  let isolationCourseId: string;
  let lifecycleCourseId: string;

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
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);

    const passwordHash = await bcrypt.hash(password, 4);

    async function createUser(
      role: UserRole,
      label: string,
    ): Promise<{ id: string; email: string }> {
      const email = `${label}-${suffix}@example.test`;

      const user = await prisma!.user.create({
        data: {
          email,
          passwordHash,
          firstName: 'HTTP',
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

    lecturer = await createUser(UserRole.LECTURER, 'lecturer');

    async function createPublishedCourse(title: string): Promise<string> {
      const now = Date.now();

      const course = await prisma!.course.create({
        data: {
          title,
          description: 'Enrollment HTTP integration test',
          lecturerId: lecturer.id,
          status: CourseStatus.PUBLISHED,
          isSuspended: false,
          enrollmentStartAt: new Date(now - 60_000),
          enrollmentEndAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
        },
      });

      createdCourseIds.push(course.id);

      return course.id;
    }

    isolationCourseId = await createPublishedCourse(`Isolation course ${suffix}`);

    lifecycleCourseId = await createPublishedCourse(`Lifecycle course ${suffix}`);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        if (createdUserIds.length > 0) {
          await prisma.enrollment.deleteMany({
            where: {
              userId: {
                in: createdUserIds,
              },
            },
          });

          await prisma.authSession.deleteMany({
            where: {
              userId: {
                in: createdUserIds,
              },
            },
          });
        }

        if (createdCourseIds.length > 0) {
          await prisma.course.deleteMany({
            where: {
              id: {
                in: createdCourseIds,
              },
            },
          });
        }

        if (createdUserIds.length > 0) {
          await prisma.user.deleteMany({
            where: {
              id: {
                in: createdUserIds,
              },
            },
          });
        }
      }
    } finally {
      await app?.close();
    }
  });

  async function login(email: string): Promise<string> {
    const response = await request(app!.getHttpServer()).post(`${api}/auth/login`).send({
      email,
      password,
    });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));

    return response.body.accessToken as string;
  }

  function enrollUrl(courseId: string): string {
    return `${api}/courses/${courseId}/enrollments/me`;
  }

  function leaveUrl(courseId: string): string {
    return `${api}/courses/${courseId}/enrollments/me`;
  }

  function stateUrl(courseId: string): string {
    return `${api}/courses/${courseId}/enrollments/me`;
  }

  // Authentication and role enforcement

  it('rejects requests without an access token', async () => {
    await request(app!.getHttpServer()).get(`${api}/users/me/enrollments`).expect(401);
  });

  it('rejects an invalid access token', async () => {
    await request(app!.getHttpServer())
      .get(`${api}/users/me/enrollments`)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('rejects a Lecturer on the Student-only My Courses endpoint', async () => {
    const token = await login(lecturer.email);

    await request(app!.getHttpServer())
      .get(`${api}/users/me/enrollments`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  // Student isolation

  it('isolates enrollment records between two authenticated Students', async () => {
    const tokenA = await login(studentA.email);
    const tokenB = await login(studentB.email);

    // Student A enrolls in a course.
    const enrollResponse = await request(app!.getHttpServer())
      .post(enrollUrl(isolationCourseId))
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    expect(enrollResponse.body).toMatchObject({
      courseId: isolationCourseId,
      status: EnrollmentStatus.ACTIVE,
      canAccessCourse: true,
    });

    // Student A can read their own enrollment state.
    const stateA = await request(app!.getHttpServer())
      .get(stateUrl(isolationCourseId))
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(stateA.body).toMatchObject({
      courseId: isolationCourseId,
      enrollmentId: enrollResponse.body.enrollmentId,
      enrollmentStatus: EnrollmentStatus.ACTIVE,
      courseAvailable: true,
      canAccessCourse: true,
    });

    // Student B must not see Student A's enrollment.
    const stateB = await request(app!.getHttpServer())
      .get(stateUrl(isolationCourseId))
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(stateB.body).toMatchObject({
      courseId: isolationCourseId,
      enrollmentId: null,
      enrollmentStatus: null,
      courseAvailable: true,
      canAccessCourse: false,
    });

    // Student B's My Courses list must not contain Student A's course.
    const myCoursesB = await request(app!.getHttpServer())
      .get(`${api}/users/me/enrollments?page=1&limit=10`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(myCoursesB.body.data).toEqual([]);
    expect(myCoursesB.body.meta.total).toBe(0);

    // Student A sees the enrollment in their own list.
    const myCoursesA = await request(app!.getHttpServer())
      .get(`${api}/users/me/enrollments?page=1&limit=10`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(
      myCoursesA.body.data.some(
        (item: { courseId: string }) => item.courseId === isolationCourseId,
      ),
    ).toBe(true);
  });

  // Enroll -> state -> leave -> state -> My Courses -> re-enroll

  it('supports the complete enrollment lifecycle over HTTP', async () => {
    const token = await login(studentA.email);

    // Enroll in the course.
    const enrollResponse = await request(app!.getHttpServer())
      .post(enrollUrl(lifecycleCourseId))
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(enrollResponse.body).toMatchObject({
      courseId: lifecycleCourseId,
      status: EnrollmentStatus.ACTIVE,
      canAccessCourse: true,
    });

    const enrollmentId = enrollResponse.body.enrollmentId as string;

    const originalEnrollment = await prisma!.enrollment.findUniqueOrThrow({
      where: {
        userId_courseId: {
          userId: studentA.id,
          courseId: lifecycleCourseId,
        },
      },
    });

    expect(originalEnrollment.id).toBe(enrollmentId);
    expect(originalEnrollment.status).toBe(EnrollmentStatus.ACTIVE);
    expect(originalEnrollment.leftAt).toBeNull();

    const originalEnrolledAt = originalEnrollment.enrolledAt;

    // Read state while enrolled.
    const activeState = await request(app!.getHttpServer())
      .get(stateUrl(lifecycleCourseId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(activeState.body).toMatchObject({
      enrollmentId,
      enrollmentStatus: EnrollmentStatus.ACTIVE,
      courseAvailable: true,
      canAccessCourse: true,
    });

    // Leave the course.
    const leaveResponse = await request(app!.getHttpServer())
      .delete(leaveUrl(lifecycleCourseId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(leaveResponse.body).toMatchObject({
      enrollmentId,
      courseId: lifecycleCourseId,
      status: EnrollmentStatus.LEFT,
      canAccessCourse: false,
    });

    // Verify that the enrollment was updated, not deleted.
    const leftEnrollment = await prisma!.enrollment.findUniqueOrThrow({
      where: {
        userId_courseId: {
          userId: studentA.id,
          courseId: lifecycleCourseId,
        },
      },
    });

    expect(leftEnrollment.id).toBe(enrollmentId);
    expect(leftEnrollment.status).toBe(EnrollmentStatus.LEFT);
    expect(leftEnrollment.leftAt).toBeInstanceOf(Date);
    expect(leftEnrollment.enrolledAt.getTime()).toBe(originalEnrolledAt.getTime());

    // Read state after leaving.
    const leftState = await request(app!.getHttpServer())
      .get(stateUrl(lifecycleCourseId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(leftState.body).toMatchObject({
      enrollmentId,
      enrollmentStatus: EnrollmentStatus.LEFT,
      courseAvailable: true,
      canAccessCourse: false,
    });

    // My Courses must retain the LEFT enrollment.
    const myCoursesAfterLeave = await request(app!.getHttpServer())
      .get(`${api}/users/me/enrollments?page=1&limit=100`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const leftItem = myCoursesAfterLeave.body.data.find(
      (item: { courseId: string }) => item.courseId === lifecycleCourseId,
    );

    expect(leftItem).toBeDefined();
    expect(leftItem.status).toBe(EnrollmentStatus.LEFT);
    expect(leftItem.canAccessCourse).toBe(false);

    // Re-enroll using the same Student/Course pair.
    const reEnrollResponse = await request(app!.getHttpServer())
      .post(enrollUrl(lifecycleCourseId))
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(reEnrollResponse.body).toMatchObject({
      enrollmentId,
      courseId: lifecycleCourseId,
      status: EnrollmentStatus.ACTIVE,
      canAccessCourse: true,
    });

    // Confirm that the retained enrollment was reactivated.
    const reactivatedEnrollment = await prisma!.enrollment.findUniqueOrThrow({
      where: {
        userId_courseId: {
          userId: studentA.id,
          courseId: lifecycleCourseId,
        },
      },
    });

    expect(reactivatedEnrollment.id).toBe(enrollmentId);
    expect(reactivatedEnrollment.status).toBe(EnrollmentStatus.ACTIVE);
    expect(reactivatedEnrollment.leftAt).toBeNull();
    expect(reactivatedEnrollment.enrolledAt.getTime()).toBe(originalEnrolledAt.getTime());

    // Confirm that the HTTP state reflects reactivation.
    const reactivatedState = await request(app!.getHttpServer())
      .get(stateUrl(lifecycleCourseId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(reactivatedState.body).toMatchObject({
      enrollmentId,
      enrollmentStatus: EnrollmentStatus.ACTIVE,
      courseAvailable: true,
      canAccessCourse: true,
    });
  });

  // Duplicate enrollment

  it('returns 409 when a Student enrolls twice while already ACTIVE', async () => {
    const token = await login(studentA.email);

    await request(app!.getHttpServer())
      .post(enrollUrl(isolationCourseId))
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    const records = await prisma!.enrollment.findMany({
      where: {
        userId: studentA.id,
        courseId: isolationCourseId,
      },
    });

    expect(records).toHaveLength(1);
  });
});
