// test/course.e2e-spec.ts
import { CourseStatus } from '../src/generated/prisma/enums.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { registerUser, type TestUser } from './support/users.js';

describe('Course (e2e)', () => {
  let testApp: TestApp;
  let lecturerA: TestUser;
  let lecturerB: TestUser;
  let student: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);

    lecturerA = await registerUser(testApp, 'LECTURER');
    lecturerB = await registerUser(testApp, 'LECTURER');
    student = await registerUser(testApp, 'STUDENT');

    // Ensure deterministic display names for lecturer summary assertions.
    // If your registerUser helper already sets these, this is a no-op-friendly
    // override that keeps the e2e test self-contained.
    await testApp.prisma.user.update({
      where: { id: lecturerA.id },
      data: { firstName: 'Nguyen', lastName: 'An' },
    });
    await testApp.prisma.user.update({
      where: { id: lecturerB.id },
      data: { firstName: 'Tran', lastName: 'Binh' },
    });
  });

  // Helper tạo course trực tiếp qua Prisma để kiểm soát status/suspended.
  function createCourse(overrides: {
    lecturerId: string;
    title?: string;
    status?: CourseStatus;
    isSuspended?: boolean;
    description?: string | null;
    prerequisites?: string | null;
    enrollmentStartAt?: Date | null;
    enrollmentEndAt?: Date | null;
    createdAt?: Date;
  }) {
    return testApp.prisma.course.create({
      data: {
        title: overrides.title ?? 'Course',
        lecturerId: overrides.lecturerId,
        ...(overrides.status !== undefined && { status: overrides.status }),
        ...(overrides.isSuspended !== undefined && { isSuspended: overrides.isSuspended }),
        ...(overrides.description !== undefined && { description: overrides.description }),
        ...(overrides.prerequisites !== undefined && { prerequisites: overrides.prerequisites }),
        ...(overrides.enrollmentStartAt !== undefined && {
          enrollmentStartAt: overrides.enrollmentStartAt,
        }),
        ...(overrides.enrollmentEndAt !== undefined && {
          enrollmentEndAt: overrides.enrollmentEndAt,
        }),
        ...(overrides.createdAt !== undefined && { createdAt: overrides.createdAt }),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  describe('auth', () => {
    it('should return 401 on GET /courses without token', async () => {
      await testApp.http().get('/api/courses').expect(401);
    });

    it('should return 401 on POST /course/create without token', async () => {
      await testApp.http().post('/api/courses').send({ title: 'No auth' }).expect(401);
    });

    it('should return 403 when a student tries to list own courses (LECTURER only)', async () => {
      await testApp.http().get('/api/courses').set(student.auth).expect(403);
    });

    it('should return 403 when a student tries to create a course', async () => {
      await testApp
        .http()
        .post('/api/courses')
        .set(student.auth)
        .send({ title: 'Student course' })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('POST /api/courses', () => {
    it('should create a course in DRAFT status with lecturer summary', async () => {
      const res = await testApp
        .http()
        .post('/api/courses')
        .set(lecturerA.auth)
        .send({ title: 'New course' })
        .expect(201);

      expect(res.body.status).toBe(CourseStatus.DRAFT);
      expect(res.body.isSuspended).toBe(false);
      expect(res.body.lecturerId).toBe(lecturerA.id);
      expect(res.body.lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });
      expect(res.body.description).toBeNull();
      // enrollmentCount is not populated on create
      expect(res.body.enrollmentCount).toBeUndefined();
    });

    it('should create a course with full optional fields', async () => {
      const res = await testApp
        .http()
        .post('/api/courses')
        .set(lecturerA.auth)
        .send({
          title: 'Full',
          description: 'Desc',
          prerequisites: 'Pre',
          enrollmentStartAt: '2026-01-01T00:00:00.000Z',
          enrollmentEndAt: '2026-02-01T00:00:00.000Z',
        })
        .expect(201);

      expect(res.body.description).toBe('Desc');
      expect(res.body.prerequisites).toBe('Pre');
      expect(res.body.enrollmentStartAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should reject missing title', async () => {
      await testApp.http().post('/api/courses').set(lecturerA.auth).send({}).expect(400);
    });

    it('should reject invalid enrollment window', async () => {
      await testApp
        .http()
        .post('/api/courses')
        .set(lecturerA.auth)
        .send({
          title: 'Invalid',
          enrollmentStartAt: '2026-02-01T00:00:00.000Z',
          enrollmentEndAt: '2026-01-01T00:00:00.000Z',
        })
        .expect(400);

      const count = await testApp.prisma.course.count({
        where: { lecturerId: lecturerA.id },
      });
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Read — get-all (lecturer scope)
  // ---------------------------------------------------------------------------
  describe('GET /api/courses', () => {
    it('should return only courses owned by the current lecturer with lecturer summary', async () => {
      await createCourse({ lecturerId: lecturerA.id, title: 'A1' });
      await createCourse({ lecturerId: lecturerA.id, title: 'A2' });
      await createCourse({ lecturerId: lecturerB.id, title: 'B1' });

      const res = await testApp.http().get('/api/courses').set(lecturerA.auth).expect(200);

      expect(res.body).toHaveLength(2);
      const titles = res.body.map((c: { title: string }) => c.title).sort();
      expect(titles).toEqual(['A1', 'A2']);
      expect(res.body[0].lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });
    });

    it('should return enrollmentCount counting only ACTIVE enrollments', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id, title: 'Counting' });

      // ACTIVE x2, LEFT x1, COMPLETED x1 → expect 2
      const { EnrollmentStatus } = await import('../src/generated/prisma/enums.js');
      const students = await Promise.all([
        registerUser(testApp, 'STUDENT'),
        registerUser(testApp, 'STUDENT'),
        registerUser(testApp, 'STUDENT'),
        registerUser(testApp, 'STUDENT'),
      ]);
      await testApp.prisma.enrollment.createMany({
        data: [
          { userId: students[0].id, courseId: course.id, status: EnrollmentStatus.ACTIVE },
          { userId: students[1].id, courseId: course.id, status: EnrollmentStatus.ACTIVE },
          { userId: students[2].id, courseId: course.id, status: EnrollmentStatus.LEFT },
          { userId: students[3].id, courseId: course.id, status: EnrollmentStatus.COMPLETED },
        ],
      });

      const res = await testApp.http().get('/api/courses').set(lecturerA.auth).expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].enrollmentCount).toBe(2);
    });

    it('should return enrollmentCount=0 when there are no enrollments', async () => {
      await createCourse({ lecturerId: lecturerA.id });

      const res = await testApp.http().get('/api/courses').set(lecturerA.auth).expect(200);

      expect(res.body[0].enrollmentCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Read — get-all/published (catalog with search/filter/sort/pagination)
  // ---------------------------------------------------------------------------
  describe('GET /api/courses/catalog', () => {
    it('should only return PUBLISHED and non-suspended courses with meta', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'draft',
        status: CourseStatus.DRAFT,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'published',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'suspended',
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });

      const res = await testApp
        .http()
        .get('/api/courses/catalog')
        .set(student.auth)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('published');
      expect(res.body.data[0].lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });
      expect(res.body.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });

    it('should search by title, description, and prerequisites (case-insensitive)', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'NestJS Fundamentals',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'React Basics',
        description: 'Learn nestjs patterns',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Advanced TS',
        prerequisites: 'Know NestJS first',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Unrelated',
        status: CourseStatus.PUBLISHED,
      });

      const res = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ search: 'NESTJS' })
        .set(student.auth)
        .expect(200);

      const titles = (res.body.data as { title: string }[]).map((c) => c.title).sort();
      expect(titles).toEqual(['Advanced TS', 'NestJS Fundamentals', 'React Basics']);
      expect(res.body.meta.total).toBe(3);
    });

    it('should filter by lecturerId', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'by-A',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerB.id,
        title: 'by-B',
        status: CourseStatus.PUBLISHED,
      });

      const res = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ lecturerId: lecturerB.id })
        .set(student.auth)
        .expect(200);

      expect(res.body.data.map((c: { title: string }) => c.title)).toEqual(['by-B']);
    });

    it('should filter by enrollmentOpen=true (null boundaries = open-ended)', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await createCourse({
        lecturerId: lecturerA.id,
        title: 'open-both-null',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'open-within',
        status: CourseStatus.PUBLISHED,
        enrollmentStartAt: past,
        enrollmentEndAt: future,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'closed-future',
        status: CourseStatus.PUBLISHED,
        enrollmentStartAt: future,
        enrollmentEndAt: future,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'closed-past',
        status: CourseStatus.PUBLISHED,
        enrollmentStartAt: past,
        enrollmentEndAt: past,
      });

      const res = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ enrollmentOpen: 'true' })
        .set(student.auth)
        .expect(200);

      const titles = (res.body.data as { title: string }[]).map((c) => c.title).sort();
      expect(titles).toEqual(['open-both-null', 'open-within']);
    });

    it('should sort by title ascending', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Zeta',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Alpha',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Mike',
        status: CourseStatus.PUBLISHED,
      });

      const res = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ sortBy: 'title', sortOrder: 'asc' })
        .set(student.auth)
        .expect(200);

      expect(res.body.data.map((c: { title: string }) => c.title)).toEqual([
        'Alpha',
        'Mike',
        'Zeta',
      ]);
    });

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await createCourse({
          lecturerId: lecturerA.id,
          title: `c-${i}`,
          status: CourseStatus.PUBLISHED,
          createdAt: new Date(`2026-01-0${i + 1}T00:00:00.000Z`),
        });
      }

      const page1 = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ page: 1, limit: 2 })
        .set(student.auth)
        .expect(200);
      expect(page1.body.data.map((c: { title: string }) => c.title)).toEqual(['c-4', 'c-3']);
      expect(page1.body.meta).toEqual({
        total: 5,
        page: 1,
        limit: 2,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: false,
      });

      const page2 = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ page: 2, limit: 2 })
        .set(student.auth)
        .expect(200);
      expect(page2.body.data.map((c: { title: string }) => c.title)).toEqual(['c-2', 'c-1']);
      expect(page2.body.meta.hasPrevPage).toBe(true);
      expect(page2.body.meta.hasNextPage).toBe(true);

      const page3 = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ page: 3, limit: 2 })
        .set(student.auth)
        .expect(200);
      expect(page3.body.data.map((c: { title: string }) => c.title)).toEqual(['c-0']);
      expect(page3.body.meta.hasNextPage).toBe(false);
    });

    it('should reject invalid sortBy with 400', async () => {
      await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ sortBy: 'not-a-field' })
        .set(student.auth)
        .expect(400);
    });

    it('should reject invalid sortOrder with 400', async () => {
      await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ sortOrder: 'sideways' })
        .set(student.auth)
        .expect(400);
    });

    it('should reject limit > 100 with 400', async () => {
      await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ limit: 101 })
        .set(student.auth)
        .expect(400);
    });

    it('should reject page < 1 with 400', async () => {
      await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ page: 0 })
        .set(student.auth)
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Read — get by id
  // ---------------------------------------------------------------------------
  describe('GET /api/courses/:courseId', () => {
    it('should allow owner to read a DRAFT course with lecturer summary', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      const res = await testApp
        .http()
        .get(`/api/courses/${course.id}`)
        .set(lecturerA.auth)
        .expect(200);

      expect(res.body.id).toBe(course.id);
      expect(res.body.lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });
      // findOne does not populate enrollmentCount
      expect(res.body.enrollmentCount).toBeUndefined();
    });

    it('should allow non-owner to read a PUBLISHED non-suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });

      const res = await testApp
        .http()
        .get(`/api/courses/${course.id}`)
        .set(student.auth)
        .expect(200);

      expect(res.body.id).toBe(course.id);
    });

    it('should return 403 when student reads a DRAFT course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await testApp.http().get(`/api/courses/${course.id}`).set(student.auth).expect(403);
    });

    it('should return 403 when non-owner reads a suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });

      await testApp.http().get(`/api/courses/${course.id}`).set(lecturerB.auth).expect(403);
    });

    it('should return 404 when course does not exist', async () => {
      await testApp.http().get('/api/courses/non-existent').set(lecturerA.auth).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  describe('PATCH /api/courses/:courseId', () => {
    it('should update course title and persist change', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id, title: 'Old' });

      const res = await testApp
        .http()
        .patch(`/api/courses/${course.id}`)
        .set(lecturerA.auth)
        .send({ title: 'New' })
        .expect(200);

      expect(res.body.title).toBe('New');
      expect(res.body.lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });

      const persisted = await testApp.prisma.course.findUniqueOrThrow({
        where: { id: course.id },
      });
      expect(persisted.title).toBe('New');
    });

    it('should return 403 when lecturerB updates lecturerA course', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id, title: 'Old' });

      await testApp
        .http()
        .patch(`/api/courses/${course.id}`)
        .set(lecturerB.auth)
        .send({ title: 'Hacked' })
        .expect(403);

      const persisted = await testApp.prisma.course.findUniqueOrThrow({
        where: { id: course.id },
      });
      expect(persisted.title).toBe('Old');
    });

    it('should reject update that makes enrollment window invalid', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        enrollmentStartAt: new Date('2026-01-01T00:00:00.000Z'),
        enrollmentEndAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      await testApp
        .http()
        .patch(`/api/courses/${course.id}`)
        .set(lecturerA.auth)
        .send({ enrollmentEndAt: '2025-12-31T00:00:00.000Z' })
        .expect(400);
    });

    it('should set enrollmentEndAt to null when passing null', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        enrollmentStartAt: new Date('2026-01-01T00:00:00.000Z'),
        enrollmentEndAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      const res = await testApp
        .http()
        .patch(`/api/courses/${course.id}`)
        .set(lecturerA.auth)
        .send({ enrollmentEndAt: null })
        .expect(200);

      expect(res.body.enrollmentEndAt).toBeNull();
    });

    it('should return 404 when course does not exist', async () => {
      await testApp
        .http()
        .patch('/api/courses/non-existent')
        .set(lecturerA.auth)
        .send({ title: 'New' })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Update status
  // ---------------------------------------------------------------------------
  describe('PATCH /api/courses/:courseId/status', () => {
    it('should publish a course that has at least one block', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });
      await testApp.prisma.courseBlock.create({
        data: {
          courseId: course.id,
          type: 'TEXT',
          title: 'Block',
          position: 0,
        },
      });

      const res = await testApp
        .http()
        .patch(`/api/courses/${course.id}/status`)
        .set(lecturerA.auth)
        .send({ status: CourseStatus.PUBLISHED })
        .expect(200);

      expect(res.body.status).toBe(CourseStatus.PUBLISHED);
      expect(res.body.lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });
    });

    it('should reject publishing an empty course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/status`)
        .set(lecturerA.auth)
        .send({ status: CourseStatus.PUBLISHED })
        .expect(400);

      const persisted = await testApp.prisma.course.findUniqueOrThrow({
        where: { id: course.id },
      });
      expect(persisted.status).toBe(CourseStatus.DRAFT);
    });

    it('should return 403 when lecturerB changes status of lecturerA course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });
      await testApp.prisma.courseBlock.create({
        data: {
          courseId: course.id,
          type: 'TEXT',
          title: 'Block',
          position: 0,
        },
      });

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/status`)
        .set(lecturerB.auth)
        .send({ status: CourseStatus.PUBLISHED })
        .expect(403);
    });

    it('should allow transitioning PUBLISHED back to DRAFT', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });

      const res = await testApp
        .http()
        .patch(`/api/courses/${course.id}/status`)
        .set(lecturerA.auth)
        .send({ status: CourseStatus.DRAFT })
        .expect(200);

      expect(res.body.status).toBe(CourseStatus.DRAFT);
    });

    it('should return 404 when course does not exist', async () => {
      await testApp
        .http()
        .patch('/api/courses/non-existent/status')
        .set(lecturerA.auth)
        .send({ status: CourseStatus.PUBLISHED })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Draft protection (student-facing reads)
  // ---------------------------------------------------------------------------
  describe('draft protection', () => {
    it('should not expose DRAFT courses via published listing', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'draft',
        status: CourseStatus.DRAFT,
      });

      const res = await testApp
        .http()
        .get('/api/courses/catalog')
        .set(student.auth)
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('should not expose DRAFT course detail to a student', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await testApp.http().get(`/api/courses/${course.id}`).set(student.auth).expect(403);
    });
  });
});