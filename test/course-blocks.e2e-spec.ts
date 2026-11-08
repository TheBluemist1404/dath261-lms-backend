// test/courseblock.e2e-spec.ts
import { BlockType, CourseStatus, EnrollmentStatus } from '../src/generated/prisma/enums.js';
import { createCourse } from './support/courses.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { registerUser, type TestUser } from './support/users.js';

describe('CourseBlock (e2e)', () => {
  let testApp: TestApp;
  let lecturerA: TestUser;
  let lecturerB: TestUser;
  let student: TestUser;
  let courseAId: string;
  let courseBId: string;

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

    const courseA = await createCourse(testApp, { lecturerId: lecturerA.id });
    const courseB = await createCourse(testApp, { lecturerId: lecturerB.id });
    courseAId = courseA.id;
    courseBId = courseB.id;
  });

  function createBlock(overrides: {
    courseId?: string;
    type?: BlockType;
    title?: string;
    position: number;
    parentModuleId?: string | null;
  }) {
    return testApp.prisma.courseBlock.create({
      data: {
        courseId: overrides.courseId ?? courseAId,
        type: overrides.type ?? BlockType.TEXT,
        title: overrides.title ?? 'Block',
        position: overrides.position,
        parentModuleId: overrides.parentModuleId ?? null,
      },
    });
  }

  function setCourseStatus(courseId: string, status: CourseStatus, isSuspended = false) {
    return testApp.prisma.course.update({
      where: { id: courseId },
      data: { status, isSuspended },
    });
  }

  function enroll(
    userId: string,
    courseId: string,
    status: EnrollmentStatus = EnrollmentStatus.ACTIVE,
  ) {
    return testApp.prisma.enrollment.create({
      data: {
        userId,
        courseId,
        status,
        ...(status === EnrollmentStatus.LEFT && { leftAt: new Date() }),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  describe('auth', () => {
    it('should return 401 when no token is provided', async () => {
      await testApp.http().get(`/api/courses/${courseAId}/blocks`).expect(401);
    });

    it('should return 403 when lecturer does not own the course and has no enrollment', async () => {
      await testApp.http().get(`/api/courses/${courseAId}/blocks`).set(lecturerB.auth).expect(403);
    });

    it('should return 403 when student is not enrolled', async () => {
      await setCourseStatus(courseAId, CourseStatus.PUBLISHED, false);

      await testApp.http().get(`/api/courses/${courseAId}/blocks`).set(student.auth).expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('POST /api/courses/:courseId/blocks', () => {
    it('should create a block with auto position 0', async () => {
      const res = await testApp
        .http()
        .post(`/api/courses/${courseAId}/blocks`)
        .set(lecturerA.auth)
        .send({ type: BlockType.TEXT, title: 'First' })
        .expect(201);

      expect(res.body.position).toBe(0);
      expect(res.body.parentModuleId).toBeNull();
    });

    it('should auto-increment position for the second root block', async () => {
      await testApp
        .http()
        .post(`/api/courses/${courseAId}/blocks`)
        .set(lecturerA.auth)
        .send({ type: BlockType.TEXT, title: 'First' })
        .expect(201);

      const res = await testApp
        .http()
        .post(`/api/courses/${courseAId}/blocks`)
        .set(lecturerA.auth)
        .send({ type: BlockType.TEXT, title: 'Second' })
        .expect(201);

      expect(res.body.position).toBe(1);
    });

    it('should create a child block inside a MODULE', async () => {
      const module = await createBlock({ type: BlockType.MODULE, position: 0 });

      const res = await testApp
        .http()
        .post(`/api/courses/${courseAId}/blocks`)
        .set(lecturerA.auth)
        .send({
          type: BlockType.TEXT,
          title: 'Child',
          parentModuleId: module.id,
        })
        .expect(201);

      expect(res.body.parentModuleId).toBe(module.id);
      expect(res.body.position).toBe(0);
    });

    it('should reject parent that is not a MODULE', async () => {
      const textBlock = await createBlock({ type: BlockType.TEXT, position: 0 });

      await testApp
        .http()
        .post(`/api/courses/${courseAId}/blocks`)
        .set(lecturerA.auth)
        .send({
          type: BlockType.TEXT,
          title: 'Orphan',
          parentModuleId: textBlock.id,
        })
        .expect(400);
    });

    it('should reject creation by a non-owner lecturer', async () => {
      await testApp
        .http()
        .post(`/api/courses/${courseAId}/blocks`)
        .set(lecturerB.auth)
        .send({ type: BlockType.TEXT, title: 'Hijack' })
        .expect(403);
    });

    it('should reject creation by an enrolled student', async () => {
      await setCourseStatus(courseAId, CourseStatus.PUBLISHED, false);
      await enroll(student.id, courseAId);

      await testApp
        .http()
        .post(`/api/courses/${courseAId}/blocks`)
        .set(student.auth)
        .send({ type: BlockType.TEXT, title: 'Hijack' })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------
  describe('GET /api/courses/:courseId/blocks', () => {
    it('should return blocks ordered by position for the owner', async () => {
      await createBlock({ position: 2, title: 'C' });
      await createBlock({ position: 0, title: 'A' });
      await createBlock({ position: 1, title: 'B' });

      const res = await testApp
        .http()
        .get(`/api/courses/${courseAId}/blocks`)
        .set(lecturerA.auth)
        .expect(200);

      const titles = res.body.map((b: { title: string }) => b.title);
      expect(titles).toEqual(['A', 'B', 'C']);
    });

    it('should allow the owner to read blocks of a Draft course', async () => {
      await setCourseStatus(courseAId, CourseStatus.DRAFT, false);
      await createBlock({ position: 0, title: 'Draft block' });

      const res = await testApp
        .http()
        .get(`/api/courses/${courseAId}/blocks`)
        .set(lecturerA.auth)
        .expect(200);

      expect(res.body.map((b: { title: string }) => b.title)).toEqual(['Draft block']);
    });

    it('should allow an enrolled student to read blocks of a Published, non-suspended course', async () => {
      await setCourseStatus(courseAId, CourseStatus.PUBLISHED, false);
      await enroll(student.id, courseAId);
      await createBlock({ position: 0, title: 'A' });
      await createBlock({ position: 1, title: 'B' });

      const res = await testApp
        .http()
        .get(`/api/courses/${courseAId}/blocks`)
        .set(student.auth)
        .expect(200);

      expect(res.body.map((b: { title: string }) => b.title)).toEqual(['A', 'B']);
    });

    it('should reject an enrolled student when the course is Draft', async () => {
      await setCourseStatus(courseAId, CourseStatus.DRAFT, false);
      await enroll(student.id, courseAId);

      await testApp.http().get(`/api/courses/${courseAId}/blocks`).set(student.auth).expect(403);
    });

    it('should reject an enrolled student when the course is suspended', async () => {
      await setCourseStatus(courseAId, CourseStatus.PUBLISHED, true);
      await enroll(student.id, courseAId);

      await testApp.http().get(`/api/courses/${courseAId}/blocks`).set(student.auth).expect(403);
    });

    it('should reject a student whose enrollment status is LEFT', async () => {
      await setCourseStatus(courseAId, CourseStatus.PUBLISHED, false);
      await enroll(student.id, courseAId, EnrollmentStatus.LEFT);

      await testApp.http().get(`/api/courses/${courseAId}/blocks`).set(student.auth).expect(403);
    });

    it('should return 404 when course does not exist', async () => {
      await testApp
        .http()
        .get(`/api/courses/non-existent-course/blocks`)
        .set(lecturerA.auth)
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  describe('PATCH /api/courses/:courseId/blocks/:blockId', () => {
    it('should update block title', async () => {
      const block = await createBlock({ position: 0, title: 'Old' });

      const res = await testApp
        .http()
        .patch(`/api/courses/${courseAId}/blocks/${block.id}`)
        .set(lecturerA.auth)
        .send({ title: 'New' })
        .expect(200);

      expect(res.body.title).toBe('New');

      const persisted = await testApp.prisma.courseBlock.findUniqueOrThrow({
        where: { id: block.id },
      });
      expect(persisted.title).toBe('New');
    });

    it('should reject changing MODULE with children to another type', async () => {
      const module = await createBlock({ type: BlockType.MODULE, position: 0 });
      await createBlock({ position: 0, parentModuleId: module.id });

      await testApp
        .http()
        .patch(`/api/courses/${courseAId}/blocks/${module.id}`)
        .set(lecturerA.auth)
        .send({ type: BlockType.TEXT })
        .expect(400);
    });

    it('should reject update by a non-owner lecturer', async () => {
      const block = await createBlock({ position: 0, title: 'Old' });

      await testApp
        .http()
        .patch(`/api/courses/${courseAId}/blocks/${block.id}`)
        .set(lecturerB.auth)
        .send({ title: 'Hijack' })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------
  describe('DELETE /api/courses/:courseId/blocks/:blockId', () => {
    it('should delete the block', async () => {
      const block = await createBlock({ position: 0 });

      await testApp
        .http()
        .delete(`/api/courses/${courseAId}/blocks/${block.id}`)
        .set(lecturerA.auth)
        .expect(204);

      const persisted = await testApp.prisma.courseBlock.findUnique({
        where: { id: block.id },
      });
      expect(persisted).toBeNull();
    });

    it('should return 404 when block does not exist', async () => {
      await testApp
        .http()
        .delete(`/api/courses/${courseAId}/blocks/non-existent`)
        .set(lecturerA.auth)
        .expect(404);
    });

    it('should reject deletion by a non-owner lecturer', async () => {
      const block = await createBlock({ position: 0 });

      await testApp
        .http()
        .delete(`/api/courses/${courseAId}/blocks/${block.id}`)
        .set(lecturerB.auth)
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Reorder
  // ---------------------------------------------------------------------------
  describe('PATCH /api/courses/:courseId/blocks/order', () => {
    it('should reorder blocks and persist positions', async () => {
      const a = await createBlock({ position: 0, title: 'A' });
      const b = await createBlock({ position: 1, title: 'B' });
      const c = await createBlock({ position: 2, title: 'C' });

      await testApp
        .http()
        .patch(`/api/courses/${courseAId}/blocks/order`)
        .set(lecturerA.auth)
        .send({ blockIds: [c.id, b.id, a.id] })
        .expect(200);

      const persisted = await testApp.prisma.courseBlock.findMany({
        where: { courseId: courseAId, parentModuleId: null },
        orderBy: { position: 'asc' },
      });
      expect(persisted.map((p) => p.title)).toEqual(['C', 'B', 'A']);
    });

    it('should reject duplicate ids', async () => {
      const a = await createBlock({ position: 0 });

      await testApp
        .http()
        .patch(`/api/courses/${courseAId}/blocks/order`)
        .set(lecturerA.auth)
        .send({ blockIds: [a.id, a.id] })
        .expect(400);
    });

    it('should reject incomplete sibling list', async () => {
      const a = await createBlock({ position: 0 });
      await createBlock({ position: 1 });

      await testApp
        .http()
        .patch(`/api/courses/${courseAId}/blocks/order`)
        .set(lecturerA.auth)
        .send({ blockIds: [a.id] })
        .expect(400);
    });

    it('should reject reorder by a non-owner lecturer', async () => {
      const a = await createBlock({ position: 0 });

      await testApp
        .http()
        .patch(`/api/courses/${courseAId}/blocks/order`)
        .set(lecturerB.auth)
        .send({ blockIds: [a.id] })
        .expect(403);
    });
  });
});
