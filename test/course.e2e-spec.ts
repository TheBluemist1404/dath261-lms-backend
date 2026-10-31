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
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  describe('auth', () => {
    it('should return 401 on GET /course/get-all without token', async () => {
      await testApp.http().get('/api/course/get-all').expect(401);
    });

    it('should return 401 on POST /course/create without token', async () => {
      await testApp.http().post('/api/course/create').send({ title: 'No auth' }).expect(401);
    });

    it('should return 403 when a student tries to list own courses (LECTURER only)', async () => {
      await testApp.http().get('/api/course/get-all').set(student.auth).expect(403);
    });

    it('should return 403 when a student tries to create a course', async () => {
      await testApp
        .http()
        .post('/api/course/create')
        .set(student.auth)
        .send({ title: 'Student course' })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('POST /api/course/create', () => {
    it('should create a course in DRAFT status', async () => {
      const res = await testApp
        .http()
        .post('/api/course/create')
        .set(lecturerA.auth)
        .send({ title: 'New course' })
        .expect(201);

      expect(res.body.status).toBe(CourseStatus.DRAFT);
      expect(res.body.isSuspended).toBe(false);
      expect(res.body.lecturerId).toBe(lecturerA.id);
      expect(res.body.description).toBeNull();
    });

    it('should create a course with full optional fields', async () => {
      const res = await testApp
        .http()
        .post('/api/course/create')
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
      await testApp.http().post('/api/course/create').set(lecturerA.auth).send({}).expect(400);
    });

    it('should reject invalid enrollment window', async () => {
      await testApp
        .http()
        .post('/api/course/create')
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
  describe('GET /api/course/get-all', () => {
    it('should return only courses owned by the current lecturer', async () => {
      await createCourse({ lecturerId: lecturerA.id, title: 'A1' });
      await createCourse({ lecturerId: lecturerA.id, title: 'A2' });
      await createCourse({ lecturerId: lecturerB.id, title: 'B1' });

      const res = await testApp.http().get('/api/course/get-all').set(lecturerA.auth).expect(200);

      expect(res.body).toHaveLength(2);
      const titles = res.body.map((c: { title: string }) => c.title).sort();
      expect(titles).toEqual(['A1', 'A2']);
    });
  });

  // ---------------------------------------------------------------------------
  // Read — get-all/published
  // ---------------------------------------------------------------------------
  describe('GET /api/course/get-all/published', () => {
    it('should only return PUBLISHED and non-suspended courses', async () => {
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
        .get('/api/course/get-all/published')
        .set(student.auth)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('published');
    });
  });

  // ---------------------------------------------------------------------------
  // Read — get by id
  // ---------------------------------------------------------------------------
  describe('GET /api/course/get/:courseId', () => {
    it('should allow owner to read a DRAFT course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      const res = await testApp
        .http()
        .get(`/api/course/get/${course.id}`)
        .set(lecturerA.auth)
        .expect(200);

      expect(res.body.id).toBe(course.id);
    });

    it('should allow non-owner to read a PUBLISHED non-suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });

      const res = await testApp
        .http()
        .get(`/api/course/get/${course.id}`)
        .set(student.auth)
        .expect(200);

      expect(res.body.id).toBe(course.id);
    });

    it('should return 403 when student reads a DRAFT course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await testApp.http().get(`/api/course/get/${course.id}`).set(student.auth).expect(403);
    });

    it('should return 403 when non-owner reads a suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });

      await testApp.http().get(`/api/course/get/${course.id}`).set(lecturerB.auth).expect(403);
    });

    it('should return 404 when course does not exist', async () => {
      await testApp.http().get('/api/course/get/non-existent').set(lecturerA.auth).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  describe('PATCH /api/course/update/:courseId', () => {
    it('should update course title and persist change', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id, title: 'Old' });

      const res = await testApp
        .http()
        .patch(`/api/course/update/${course.id}`)
        .set(lecturerA.auth)
        .send({ title: 'New' })
        .expect(200);

      expect(res.body.title).toBe('New');

      const persisted = await testApp.prisma.course.findUniqueOrThrow({
        where: { id: course.id },
      });
      expect(persisted.title).toBe('New');
    });

    it('should return 403 when lecturerB updates lecturerA course', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id, title: 'Old' });

      await testApp
        .http()
        .patch(`/api/course/update/${course.id}`)
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
        .patch(`/api/course/update/${course.id}`)
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
        .patch(`/api/course/update/${course.id}`)
        .set(lecturerA.auth)
        .send({ enrollmentEndAt: null })
        .expect(200);

      expect(res.body.enrollmentEndAt).toBeNull();
    });

    it('should return 404 when course does not exist', async () => {
      await testApp
        .http()
        .patch('/api/course/update/non-existent')
        .set(lecturerA.auth)
        .send({ title: 'New' })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Update status
  // ---------------------------------------------------------------------------
  describe('PATCH /api/course/update-status/:courseId', () => {
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
        .patch(`/api/course/update-status/${course.id}`)
        .set(lecturerA.auth)
        .send({ status: CourseStatus.PUBLISHED })
        .expect(200);

      expect(res.body.status).toBe(CourseStatus.PUBLISHED);
    });

    it('should reject publishing an empty course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await testApp
        .http()
        .patch(`/api/course/update-status/${course.id}`)
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
        .patch(`/api/course/update-status/${course.id}`)
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
        .patch(`/api/course/update-status/${course.id}`)
        .set(lecturerA.auth)
        .send({ status: CourseStatus.DRAFT })
        .expect(200);

      expect(res.body.status).toBe(CourseStatus.DRAFT);
    });

    it('should return 404 when course does not exist', async () => {
      await testApp
        .http()
        .patch('/api/course/update-status/non-existent')
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
        .get('/api/course/get-all/published')
        .set(student.auth)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should not expose DRAFT course detail to a student', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await testApp.http().get(`/api/course/get/${course.id}`).set(student.auth).expect(403);
    });
  });
});
