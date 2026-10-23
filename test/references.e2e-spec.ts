import { createCourse, enroll } from './support/courses.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser, type TestUser } from './support/users.js';
import {
  addMembership,
  archiveWorkspace,
  createWorkspace,
  insertPage,
} from './support/workspaces.js';

describe('Course references API (e2e)', () => {
  let testApp: TestApp;
  let lecturer: TestUser;
  let author: TestUser;
  let peer: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let pageId: string;
  let course: Awaited<ReturnType<typeof createCourse>>;
  let file: { id: string };
  let video: { id: string };
  let quiz: { id: string };

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
    lecturer = await registerUser(testApp, 'LECTURER');
    author = await registerUser(testApp);
    peer = await registerUser(testApp);
    outsider = await registerUser(testApp);

    course = await createCourse(testApp, {
      lecturerId: lecturer.id,
      title: 'Algorithms',
      blocks: [
        { type: 'FILE', title: 'Week 1 slides' },
        { type: 'VIDEO', title: 'Graph search lecture', content: { durationSeconds: 600 } },
        { type: 'QUIZ', title: 'Quiz 1' },
      ],
    });
    [file, video, quiz] = course.blocks;
    await enroll(testApp, author.id, course.id);

    workspaceId = (await createWorkspace(testApp, author)).id;
    await addMembership(testApp, workspaceId, peer, 'MEMBER');
    pageId = (await insertPage(testApp, workspaceId, 'Notes')).id;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const http = () => testApp.http();
  const refsPath = (id = pageId) => `/api/pages/${id}/references`;

  async function addReference(courseBlockId: string, timestampSeconds?: number) {
    const response = await http()
      .post(refsPath())
      .set(author.auth)
      .send({ courseBlockId, timestampSeconds })
      .expect(201);
    return response.body as { id: string };
  }

  async function referencesSeenBy(user: TestUser) {
    const response = await http().get(refsPath()).set(user.auth).expect(200);
    return response.body as { status: string; block?: unknown }[];
  }

  describe('POST /pages/:id/references', () => {
    it('references an accessible video at a timestamp', async () => {
      const response = await http()
        .post(refsPath())
        .set(author.auth)
        .send({ courseBlockId: video.id, timestampSeconds: 125 })
        .expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        pageId,
        createdAt: expect.any(String),
        status: 'AVAILABLE',
        block: {
          id: video.id,
          type: 'VIDEO',
          title: 'Graph search lecture',
          courseId: course.id,
          courseTitle: 'Algorithms',
          durationSeconds: 600,
        },
        timestampSeconds: 125,
      });
    });

    it('references a file without a timestamp', async () => {
      const response = await http()
        .post(refsPath())
        .set(author.auth)
        .send({ courseBlockId: file.id })
        .expect(201);
      expect(response.body).toMatchObject({
        status: 'AVAILABLE',
        block: { type: 'FILE', durationSeconds: null },
        timestampSeconds: null,
      });
    });

    it('accepts timestamps at both ends of the video', async () => {
      await addReference(video.id, 0);
      await addReference(video.id, 600);
    });

    it('lets the course lecturer reference without an enrollment', async () => {
      const lecturerWorkspace = await createWorkspace(testApp, lecturer);
      const page = await insertPage(testApp, lecturerWorkspace.id, 'Prep');

      await http()
        .post(refsPath(page.id))
        .set(lecturer.auth)
        .send({ courseBlockId: file.id })
        .expect(201);
    });

    it('treats a completed enrollment as current access', async () => {
      await testApp.prisma.enrollment.updateMany({ data: { status: 'COMPLETED' } });
      await addReference(file.id);
    });

    it.each([
      ['a timestamp past the end', 601],
      ['a negative timestamp', -1],
      ['a fractional timestamp', 1.5],
    ])('rejects %s with 400', async (_label, timestampSeconds) => {
      await http()
        .post(refsPath())
        .set(author.auth)
        .send({ courseBlockId: video.id, timestampSeconds })
        .expect(400);
    });

    it('rejects a timestamp on a file', async () => {
      const response = await http()
        .post(refsPath())
        .set(author.auth)
        .send({ courseBlockId: file.id, timestampSeconds: 3 })
        .expect(400);
      expect(response.body.message).toBe('timestampSeconds is outside the video');
    });

    it('allows any timestamp when the video duration is unknown', async () => {
      const unknown = await createCourse(testApp, {
        lecturerId: lecturer.id,
        blocks: [{ type: 'VIDEO', title: 'No metadata' }],
      });
      await enroll(testApp, author.id, unknown.id);

      await addReference(unknown.blocks[0].id, 99_999);
    });

    it('answers 404 alike for missing, non-referenceable and inaccessible blocks', async () => {
      const draft = await createCourse(testApp, {
        lecturerId: lecturer.id,
        status: 'DRAFT',
        blocks: [{ type: 'FILE', title: 'Draft' }],
      });
      await enroll(testApp, author.id, draft.id);
      const suspended = await createCourse(testApp, {
        lecturerId: lecturer.id,
        isSuspended: true,
        blocks: [{ type: 'FILE', title: 'Suspended' }],
      });
      await enroll(testApp, author.id, suspended.id);
      const notEnrolled = await createCourse(testApp, {
        lecturerId: lecturer.id,
        blocks: [{ type: 'FILE', title: 'Other course' }],
      });
      const left = await createCourse(testApp, {
        lecturerId: lecturer.id,
        blocks: [{ type: 'FILE', title: 'Left course' }],
      });
      await enroll(testApp, author.id, left.id, 'LEFT');

      for (const courseBlockId of [
        'missing',
        quiz.id,
        draft.blocks[0].id,
        suspended.blocks[0].id,
        notEnrolled.blocks[0].id,
        left.blocks[0].id,
      ]) {
        const response = await http()
          .post(refsPath())
          .set(author.auth)
          .send({ courseBlockId })
          .expect(404);
        expect(response.body.message).toBe('Course material is not available');
      }
      expect(await testApp.prisma.resourceReference.count()).toBe(0);
    });

    it('checks the caller’s own course access, not the page author’s', async () => {
      await http().post(refsPath()).set(peer.auth).send({ courseBlockId: file.id }).expect(404);
    });

    it('rejects writes in an archived workspace', async () => {
      await archiveWorkspace(testApp, workspaceId);
      await http().post(refsPath()).set(author.auth).send({ courseBlockId: file.id }).expect(409);
    });

    it('hides the page from non-members and admins', async () => {
      await http().post(refsPath()).set(outsider.auth).send({ courseBlockId: file.id }).expect(404);
      await http()
        .post(refsPath('missing'))
        .set(author.auth)
        .send({ courseBlockId: file.id })
        .expect(404);
      const admin = await createAdmin(testApp);
      await http().post(refsPath()).set(admin.auth).send({ courseBlockId: file.id }).expect(403);
    });

    it.each([
      ['missing block id', {}],
      ['empty block id', { courseBlockId: '' }],
      ['string timestamp', { courseBlockId: 'x', timestampSeconds: '10' }],
      ['unknown field', { courseBlockId: 'x', pageId: 'y' }],
    ])('rejects %s with 400', async (_label, body) => {
      await http().post(refsPath()).set(author.auth).send(body).expect(400);
    });
  });

  describe('GET /pages/:id/references', () => {
    it('resolves each reference against the viewer’s own access', async () => {
      await addReference(video.id, 30);

      const [forAuthor] = await referencesSeenBy(author);
      expect(forAuthor).toMatchObject({ status: 'AVAILABLE', timestampSeconds: 30 });

      // The peer shares the page but not the course.
      const [forPeer] = await referencesSeenBy(peer);
      expect(forPeer).toEqual({
        id: expect.any(String),
        pageId,
        createdAt: expect.any(String),
        status: 'LOCKED',
      });
      expect(JSON.stringify(forPeer)).not.toContain('Graph search');

      await enroll(testApp, peer.id, course.id);
      const [afterEnrolling] = await referencesSeenBy(peer);
      expect(afterEnrolling.status).toBe('AVAILABLE');
    });

    it('locks references once the viewer leaves the course', async () => {
      await addReference(file.id);
      await testApp.prisma.enrollment.updateMany({
        where: { userId: author.id },
        data: { status: 'LEFT', leftAt: new Date() },
      });

      const [reference] = await referencesSeenBy(author);
      expect(reference).not.toHaveProperty('block');
      expect(reference.status).toBe('LOCKED');
    });

    it('marks references unavailable when the course is suspended or back in draft', async () => {
      await addReference(file.id);

      await testApp.prisma.course.update({ where: { id: course.id }, data: { isSuspended: true } });
      expect((await referencesSeenBy(author))[0]).toEqual(
        expect.objectContaining({ status: 'UNAVAILABLE' }),
      );
      expect((await referencesSeenBy(author))[0]).not.toHaveProperty('block');

      await testApp.prisma.course.update({
        where: { id: course.id },
        data: { isSuspended: false, status: 'DRAFT' },
      });
      expect((await referencesSeenBy(author))[0].status).toBe('UNAVAILABLE');
      // Someone without access still sees LOCKED rather than learning the course state.
      expect((await referencesSeenBy(peer))[0].status).toBe('LOCKED');
    });

    it('lists references in the order they were added', async () => {
      const first = await addReference(file.id);
      const second = await addReference(video.id, 10);

      const references = (await referencesSeenBy(author)) as unknown as { id: string }[];
      expect(references.map((reference) => reference.id)).toEqual([first.id, second.id]);
    });

    it('stays readable in an archived workspace', async () => {
      await addReference(file.id);
      await archiveWorkspace(testApp, workspaceId);
      expect(await referencesSeenBy(author)).toHaveLength(1);
    });

    it('drops references whose block is deleted', async () => {
      await addReference(file.id);
      await testApp.prisma.courseBlock.delete({ where: { id: file.id } });
      expect(await referencesSeenBy(author)).toEqual([]);
    });

    it('hides the page from non-members', async () => {
      await http().get(refsPath()).set(outsider.auth).expect(404);
    });
  });

  describe('DELETE /references/:id', () => {
    it('lets any member remove a reference', async () => {
      const reference = await addReference(file.id);

      await http().delete(`/api/references/${reference.id}`).set(peer.auth).expect(204);
      expect(await referencesSeenBy(author)).toEqual([]);
    });

    it('hides references from non-members and unknown ids', async () => {
      const reference = await addReference(file.id);

      const hidden = await http()
        .delete(`/api/references/${reference.id}`)
        .set(outsider.auth)
        .expect(404);
      expect(hidden.body.message).toBe('Reference not found');
      await http().delete('/api/references/missing').set(author.auth).expect(404);
      expect(await testApp.prisma.resourceReference.count()).toBe(1);
    });

    it('rejects removals in an archived workspace', async () => {
      const reference = await addReference(file.id);
      await archiveWorkspace(testApp, workspaceId);

      await http().delete(`/api/references/${reference.id}`).set(author.auth).expect(409);
    });
  });

  describe('GET /reference-sources', () => {
    async function sources(user: TestUser, query: string) {
      const response = await http()
        .get(`/api/reference-sources?${query}`)
        .set(user.auth)
        .expect(200);
      return response.body as { id: string; title: string; courseTitle: string }[];
    }

    it('lists accessible blocks of the requested type', async () => {
      expect(await sources(author, 'type=FILE')).toEqual([
        {
          id: file.id,
          type: 'FILE',
          title: 'Week 1 slides',
          courseId: course.id,
          courseTitle: 'Algorithms',
          durationSeconds: null,
        },
      ]);
      expect((await sources(author, 'type=VIDEO')).map((block) => block.id)).toEqual([video.id]);
    });

    it('includes the lecturer’s own courses and excludes inaccessible ones', async () => {
      const draft = await createCourse(testApp, {
        lecturerId: lecturer.id,
        status: 'DRAFT',
        blocks: [{ type: 'FILE', title: 'Draft notes' }],
      });
      await enroll(testApp, author.id, draft.id);
      const left = await createCourse(testApp, {
        lecturerId: lecturer.id,
        title: 'Left',
        blocks: [{ type: 'FILE', title: 'Left notes' }],
      });
      await enroll(testApp, author.id, left.id, 'LEFT');
      await createCourse(testApp, {
        lecturerId: lecturer.id,
        isSuspended: true,
        blocks: [{ type: 'FILE', title: 'Suspended notes' }],
      });

      expect((await sources(author, 'type=FILE')).map((block) => block.id)).toEqual([file.id]);
      expect(await sources(peer, 'type=FILE')).toEqual([]);
      // The lecturer sees published courses they teach, not drafts or suspended ones.
      expect((await sources(lecturer, 'type=FILE')).map((block) => block.title).sort()).toEqual([
        'Left notes',
        'Week 1 slides',
      ]);
    });

    it('filters by block or course title, ignoring case', async () => {
      const databases = await createCourse(testApp, {
        lecturerId: lecturer.id,
        title: 'Databases',
        blocks: [{ type: 'FILE', title: 'Normal forms' }],
      });
      await enroll(testApp, author.id, databases.id);

      expect((await sources(author, 'type=FILE&q=SLIDES')).map((b) => b.id)).toEqual([file.id]);
      expect((await sources(author, 'type=FILE&q=databases')).map((b) => b.title)).toEqual([
        'Normal forms',
      ]);
      expect((await sources(author, 'type=FILE&q=%20%20')).length).toBe(2);
      // LIKE wildcards in the query match literally.
      expect(await sources(author, 'type=FILE&q=%25')).toEqual([]);
      expect(await sources(author, 'type=FILE&q=_')).toEqual([]);
      expect(await sources(author, 'type=FILE&q=%5C')).toEqual([]);
      await testApp.prisma.courseBlock.update({
        where: { id: file.id },
        data: { title: '100% slides' },
      });
      expect((await sources(author, 'type=FILE&q=0%25')).map((b) => b.id)).toEqual([file.id]);
    });

    it.each([
      ['type=QUIZ'],
      ['type=file'],
      [''],
      ['type=FILE&extra=1'],
    ])('rejects query %s with 400', async (query) => {
      await http().get(`/api/reference-sources?${query}`).set(author.auth).expect(400);
    });

    it('is closed to admins and anonymous callers', async () => {
      const admin = await createAdmin(testApp);
      await http().get('/api/reference-sources?type=FILE').set(admin.auth).expect(403);
      await http().get('/api/reference-sources?type=FILE').expect(401);
    });
  });
});
