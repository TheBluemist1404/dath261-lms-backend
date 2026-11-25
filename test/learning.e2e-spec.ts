import { BlockType } from '../src/generated/prisma/enums.js';
import { createCourse } from './support/courses.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { registerUser, type TestUser } from './support/users.js';

// IT-07: a student enrolls, learns blocks in order, and resumes where they left off.

describe('Learning: enrollment, progress and resume (e2e)', () => {
  let testApp: TestApp;
  let student: TestUser;
  let lecturer: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
    student = await registerUser(testApp, 'STUDENT');
    lecturer = await registerUser(testApp, 'LECTURER');
  });

  async function publishedCourse() {
    return createCourse(testApp, {
      lecturerId: lecturer.id,
      title: 'Graphs',
      blocks: [
        { type: BlockType.TEXT, title: 'Intro', content: { text: '# Graphs' } },
        { type: BlockType.VIDEO, title: 'Lecture', content: { url: 'https://example.com/v.mp4' } },
        { type: BlockType.FILE, title: 'Slides', content: { url: 'https://example.com/s.pdf' } },
      ],
    });
  }

  const enrollMe = (courseId: string, user = student) =>
    testApp.http().post(`/api/courses/${courseId}/enrollments/me`).set(user.auth);

  describe('enrollment', () => {
    it('enrolls once, shows the course in My Courses, and refuses a second enrollment', async () => {
      const course = await publishedCourse();

      await enrollMe(course.id).expect(201);
      await enrollMe(course.id).expect(409);

      const state = await testApp
        .http()
        .get(`/api/courses/${course.id}/enrollments/me`)
        .set(student.auth)
        .expect(200);
      expect(state.body).toMatchObject({ enrollmentStatus: 'ACTIVE', canAccessCourse: true });

      const mine = await testApp
        .http()
        .get('/api/users/me/enrollments')
        .set(student.auth)
        .expect(200);
      expect(JSON.stringify(mine.body)).toContain(course.id);
    });

    it.each([
      ['a draft course', { status: 'DRAFT' as const }],
      ['a suspended course', { isSuspended: true }],
    ])('refuses to enroll in %s', async (_label, options) => {
      const course = await createCourse(testApp, { lecturerId: lecturer.id, ...options });
      await enrollMe(course.id).expect(409);
    });

    it('returns 404 for an unknown course and 403 for a lecturer', async () => {
      await enrollMe('missing-course').expect(404);
      const course = await publishedCourse();
      await enrollMe(course.id, lecturer).expect(403);
    });

    it('leaving a course removes access to its blocks', async () => {
      const course = await publishedCourse();
      await enrollMe(course.id).expect(201);
      await testApp.http().get(`/api/courses/${course.id}/blocks`).set(student.auth).expect(200);

      await testApp
        .http()
        .delete(`/api/courses/${course.id}/enrollments/me`)
        .set(student.auth)
        .expect(200);

      await testApp.http().get(`/api/courses/${course.id}/blocks`).set(student.auth).expect(403);
      await testApp.http().get(`/api/courses/${course.id}/progress`).set(student.auth).expect(403);
    });
  });

  describe('progress', () => {
    it('blocks, progress and resume are refused before enrolling', async () => {
      const course = await publishedCourse();
      const [intro] = course.blocks;

      await testApp.http().get(`/api/courses/${course.id}/blocks`).set(student.auth).expect(403);
      await testApp.http().get(`/api/courses/${course.id}/progress`).set(student.auth).expect(403);
      await testApp
        .http()
        .patch(`/api/courses/${course.id}/blocks/${intro.id}/progress`)
        .set(student.auth)
        .send({ completed: true })
        .expect(403);
    });

    it('lists blocks in lecturer order and counts completed blocks', async () => {
      const course = await publishedCourse();
      const [intro, lecture] = course.blocks;
      await enrollMe(course.id).expect(201);

      const blocks = await testApp
        .http()
        .get(`/api/courses/${course.id}/blocks`)
        .set(student.auth)
        .expect(200);
      expect(blocks.body.map((block: { title: string }) => block.title)).toEqual([
        'Intro',
        'Lecture',
        'Slides',
      ]);

      const before = await testApp
        .http()
        .get(`/api/courses/${course.id}/progress`)
        .set(student.auth)
        .expect(200);
      expect(before.body.progress).toMatchObject({ totalItems: 3, completedItems: 0 });

      for (const block of [intro, lecture]) {
        const marked = await testApp
          .http()
          .patch(`/api/courses/${course.id}/blocks/${block.id}/progress`)
          .set(student.auth)
          .send({ completed: true })
          .expect(200);
        expect(marked.body).toMatchObject({ courseBlockId: block.id, completed: true });
      }

      const after = await testApp
        .http()
        .get(`/api/courses/${course.id}/progress`)
        .set(student.auth)
        .expect(200);
      expect(after.body.progress).toMatchObject({
        totalItems: 3,
        completedItems: 2,
        learningProgressPercentage: 66.67,
      });
      expect(after.body.items.filter((item: { completed: boolean }) => item.completed).length).toBe(
        2,
      );

      // Unmarking takes it back out of the count.
      await testApp
        .http()
        .patch(`/api/courses/${course.id}/blocks/${lecture.id}/progress`)
        .set(student.auth)
        .send({ completed: false })
        .expect(200);
      const unmarked = await testApp
        .http()
        .get(`/api/courses/${course.id}/progress`)
        .set(student.auth)
        .expect(200);
      expect(unmarked.body.progress.completedItems).toBe(1);
    });

    it('rejects a block from another course and a body without completed', async () => {
      const course = await publishedCourse();
      const other = await publishedCourse();
      await enrollMe(course.id).expect(201);

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/blocks/${other.blocks[0].id}/progress`)
        .set(student.auth)
        .send({ completed: true })
        .expect(404);
      await testApp
        .http()
        .patch(`/api/courses/${course.id}/blocks/${course.blocks[0].id}/progress`)
        .set(student.auth)
        .send({})
        .expect(400);
    });
  });

  describe('resume', () => {
    it('has no resume position at first, then returns the last visited block and video time', async () => {
      const course = await publishedCourse();
      const [intro, lecture] = course.blocks;
      await enrollMe(course.id).expect(201);

      const empty = await testApp
        .http()
        .get(`/api/courses/${course.id}/progress/resume`)
        .set(student.auth)
        .expect(200);
      expect(empty.body).toMatchObject({ hasResumePosition: false, block: null });

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/blocks/${intro.id}/position`)
        .set(student.auth)
        .send({ resumeData: { version: 1, type: 'TEXT', data: {} } })
        .expect(200);
      await testApp
        .http()
        .patch(`/api/courses/${course.id}/blocks/${lecture.id}/position`)
        .set(student.auth)
        .send({ resumeData: { version: 1, type: 'VIDEO', data: { positionSeconds: 125 } } })
        .expect(200);

      const resume = await testApp
        .http()
        .get(`/api/courses/${course.id}/progress/resume`)
        .set(student.auth)
        .expect(200);
      expect(resume.body).toMatchObject({
        hasResumePosition: true,
        block: { id: lecture.id, type: 'VIDEO' },
        resumeData: { version: 1, type: 'VIDEO', data: { positionSeconds: 125 } },
      });
    });

    it('rejects resume data whose type does not match the block', async () => {
      const course = await publishedCourse();
      await enrollMe(course.id).expect(201);

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/blocks/${course.blocks[0].id}/position`)
        .set(student.auth)
        .send({ resumeData: { version: 1, type: 'VIDEO', data: { positionSeconds: 3 } } })
        .expect(400);
    });

    it('keeps each student’s position separate', async () => {
      const course = await publishedCourse();
      const classmate = await registerUser(testApp, 'STUDENT');
      await enrollMe(course.id).expect(201);
      await enrollMe(course.id, classmate).expect(201);

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/blocks/${course.blocks[1].id}/position`)
        .set(student.auth)
        .send({ resumeData: { version: 1, type: 'VIDEO', data: { positionSeconds: 40 } } })
        .expect(200);

      const theirs = await testApp
        .http()
        .get(`/api/courses/${course.id}/progress/resume`)
        .set(classmate.auth)
        .expect(200);
      expect(theirs.body.hasResumePosition).toBe(false);
    });
  });
});
