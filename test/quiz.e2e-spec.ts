// test/quiz.e2e-spec.ts
import {
    BlockType,
    CourseStatus,
    EnrollmentStatus,
    QuestionType,
    QuizAttemptStatus,
    QuizScoringMode,
    UserRole,
  } from '../src/generated/prisma/enums.js';
  import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
  import { registerUser, type TestUser } from './support/users.js';
  
  describe('Quiz (e2e)', () => {
    let testApp: TestApp;
    let lecturer: TestUser;
    let otherLecturer: TestUser;
    let student: TestUser;
    let outsider: TestUser;
    let courseId: string;
  
    beforeAll(async () => {
      testApp = await createTestApp();
    });
  
    afterAll(async () => {
      await testApp.app.close();
    });
  
    beforeEach(async () => {
      await resetDatabase(testApp.prisma);
  
      lecturer = await registerUser(testApp, 'LECTURER');
      otherLecturer = await registerUser(testApp, 'LECTURER');
      student = await registerUser(testApp, 'STUDENT');
      outsider = await registerUser(testApp, 'STUDENT');
  
      // Deterministic display names (course/quiz response uses them).
      await testApp.prisma.user.update({
        where: { id: lecturer.id },
        data: { firstName: 'Lec', lastName: 'One' },
      });
  
      // Create a PUBLISHED course owned by `lecturer` and enroll `student`.
      const course = await testApp.prisma.course.create({
        data: {
          title: 'Quiz Course',
          lecturerId: lecturer.id,
          status: CourseStatus.PUBLISHED,
        },
      });
      courseId = course.id;
  
      await testApp.prisma.enrollment.create({
        data: {
          userId: student.id,
          courseId,
          status: EnrollmentStatus.ACTIVE,
        },
      });
    });
  
    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------
    const basePath = () => `/api/courses/${courseId}/quizzes`;
  
    const trueFalseQuestion = (overrides: Record<string, unknown> = {}) => ({
      type: QuestionType.TRUE_FALSE,
      text: 'HTTP is stateless?',
      points: 1,
      correctBoolean: true,
      ...overrides,
    });
  
    const singleChoiceQuestion = (overrides: Record<string, unknown> = {}) => ({
      type: QuestionType.SINGLE_CHOICE,
      text: 'Capital of France?',
      points: 1,
      options: [
        { text: 'Paris', isCorrect: true },
        { text: 'London', isCorrect: false },
      ],
      ...overrides,
    });
  
    const fillInQuestion = (overrides: Record<string, unknown> = {}) => ({
      type: QuestionType.FILL_IN_BLANK,
      text: '1 + 1 = ___',
      points: 2,
      acceptedAnswers: ['2', 'two'],
      ...overrides,
    });
  
    async function createQuizViaApi(
      questions: unknown[] = [trueFalseQuestion()],
      extra: Record<string, unknown> = {},
    ) {
      const res = await testApp
        .http()
        .post(basePath())
        .set(lecturer.auth)
        .send({
          title: 'Midterm',
          maxAttempts: 3,
          scoringMode: QuizScoringMode.HIGHEST,
          allowLate: false,
          questions,
          ...extra,
        })
        .expect(201);
      return res.body as {
        id: string;
        courseId: string;
        title: string;
        questions: Array<{
          id: string;
          type: QuestionType;
          correctBoolean?: boolean | null;
          options?: Array<{ id: string; isCorrect: boolean }> | null;
          acceptedAnswers?: string[] | null;
        }>;
      };
    }
  
    async function setQuizConfig(
      blockId: string,
      config: {
        maxAttempts?: number;
        scoringMode?: QuizScoringMode;
        availableFrom?: string | null;
        deadline?: string | null;
        allowLate?: boolean;
      },
    ) {
      return testApp
        .http()
        .patch(`${basePath()}/${blockId}/config`)
        .set(lecturer.auth)
        .send(config)
        .expect(200);
    }
  
    // ===========================================================================
    // Auth
    // ===========================================================================
    describe('auth', () => {
      it('should return 401 on POST /quizzes without token', async () => {
        await testApp.http().post(basePath()).send({}).expect(401);
      });
  
      it('should return 403 when a Student tries to create a quiz', async () => {
        await testApp
          .http()
          .post(basePath())
          .set(student.auth)
          .send({ title: 'x', questions: [trueFalseQuestion()] })
          .expect(403);
      });
  
      it('should return 403 when a Lecturer (non-owner) tries to create a quiz', async () => {
        await testApp
          .http()
          .post(basePath())
          .set(otherLecturer.auth)
          .send({ title: 'x', questions: [trueFalseQuestion()] })
          .expect(403);
      });
    });
  
    // ===========================================================================
    // POST /api/courses/:courseId/quizzes — create
    // ===========================================================================
    describe('POST /quizzes (create)', () => {
      it('should create a quiz and return full Lecturer view with answer keys', async () => {
        const res = await testApp
          .http()
          .post(basePath())
          .set(lecturer.auth)
          .send({
            title: 'Midterm',
            maxAttempts: 3,
            scoringMode: QuizScoringMode.HIGHEST,
            allowLate: false,
            questions: [singleChoiceQuestion(), trueFalseQuestion(), fillInQuestion()],
          })
          .expect(201);
  
        expect(res.body.id).toBeDefined();
        expect(res.body.courseId).toBe(courseId);
        expect(res.body.title).toBe('Midterm');
        expect(res.body.maxAttempts).toBe(3);
        expect(res.body.scoringMode).toBe(QuizScoringMode.HIGHEST);
        expect(res.body.allowLate).toBe(false);
        expect(res.body.resultsReleasedAt).toBeNull();
        expect(res.body.questions).toHaveLength(3);
  
        const single = res.body.questions.find(
          (q: { type: string }) => q.type === QuestionType.SINGLE_CHOICE,
        );
        expect(single.options).toHaveLength(2);
        expect(single.options.filter((o: { isCorrect: boolean }) => o.isCorrect)).toHaveLength(1);
  
        const tf = res.body.questions.find(
          (q: { type: string }) => q.type === QuestionType.TRUE_FALSE,
        );
        expect(tf.correctBoolean).toBe(true);
  
        const fib = res.body.questions.find(
          (q: { type: string }) => q.type === QuestionType.FILL_IN_BLANK,
        );
        expect(fib.acceptedAnswers).toEqual(['2', 'two']);
  
        // Persisted
        const persisted = await testApp.prisma.courseBlock.findUniqueOrThrow({
          where: { id: res.body.id },
          include: { quizConfig: true, quizQuestions: { include: { options: true } } },
        });
        expect(persisted.type).toBe(BlockType.QUIZ);
        expect(persisted.quizConfig?.maxAttempts).toBe(3);
        expect(persisted.quizQuestions).toHaveLength(3);
      });
  
      it('should reject an empty questions array with 400', async () => {
        await testApp
          .http()
          .post(basePath())
          .set(lecturer.auth)
          .send({ title: 'Empty', questions: [] })
          .expect(400);
      });
  
      it('should reject SINGLE_CHOICE with more than one correct option with 400', async () => {
        await testApp
          .http()
          .post(basePath())
          .set(lecturer.auth)
          .send({
            title: 'Bad',
            questions: [
              {
                type: QuestionType.SINGLE_CHOICE,
                text: 'Q',
                options: [
                  { text: 'A', isCorrect: true },
                  { text: 'B', isCorrect: true },
                ],
              },
            ],
          })
          .expect(400);
      });
  
      it('should reject TRUE_FALSE without correctBoolean with 400', async () => {
        await testApp
          .http()
          .post(basePath())
          .set(lecturer.auth)
          .send({
            title: 'Bad',
            questions: [{ type: QuestionType.TRUE_FALSE, text: 'Q' }],
          })
          .expect(400);
      });
  
      it('should reject FILL_IN_BLANK without acceptedAnswers with 400', async () => {
        await testApp
          .http()
          .post(basePath())
          .set(lecturer.auth)
          .send({
            title: 'Bad',
            questions: [{ type: QuestionType.FILL_IN_BLANK, text: 'Q' }],
          })
          .expect(400);
      });
  
      it('should reject availableFrom >= deadline with 400', async () => {
        await testApp
          .http()
          .post(basePath())
          .set(lecturer.auth)
          .send({
            title: 'Bad',
            availableFrom: '2026-02-01T00:00:00.000Z',
            deadline: '2026-01-01T00:00:00.000Z',
            questions: [trueFalseQuestion()],
          })
          .expect(400);
      });
  
      it('should return 404 when course does not exist', async () => {
        await testApp
          .http()
          .post('/api/courses/non-existent/quizzes')
          .set(lecturer.auth)
          .send({ title: 'X', questions: [trueFalseQuestion()] })
          .expect(404);
      });
    });
  
    // ===========================================================================
    // GET /quizzes/:blockId — Lecturer view
    // ===========================================================================
    describe('GET /quizzes/:blockId (Lecturer)', () => {
      it('should return full quiz with answer keys for the owner', async () => {
        const quiz = await createQuizViaApi();
  
        const res = await testApp
          .http()
          .get(`${basePath()}/${quiz.id}`)
          .set(lecturer.auth)
          .expect(200);
  
        expect(res.body.id).toBe(quiz.id);
        expect(res.body.questions[0].correctBoolean).toBe(true);
      });
  
      it('should return 403 for a non-owner Lecturer', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}`)
          .set(otherLecturer.auth)
          .expect(403);
      });
  
      it('should return 404 for a non-existent quiz', async () => {
        await testApp
          .http()
          .get(`${basePath()}/non-existent`)
          .set(lecturer.auth)
          .expect(404);
      });
  
      it('should return 404 for a block that is not a QUIZ', async () => {
        const textBlock = await testApp.prisma.courseBlock.create({
          data: { courseId, type: BlockType.TEXT, title: 'T', position: 0 },
        });
  
        await testApp
          .http()
          .get(`${basePath()}/${textBlock.id}`)
          .set(lecturer.auth)
          .expect(404);
      });
    });
  
    // ===========================================================================
    // PATCH /quizzes/:blockId/config — update config
    // ===========================================================================
    describe('PATCH /quizzes/:blockId/config', () => {
      it('should update maxAttempts, scoringMode, deadline, allowLate', async () => {
        const quiz = await createQuizViaApi();
  
        const res = await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/config`)
          .set(lecturer.auth)
          .send({
            maxAttempts: 5,
            scoringMode: QuizScoringMode.AVERAGE,
            deadline: '2099-01-01T00:00:00.000Z',
            allowLate: true,
          })
          .expect(200);
  
        expect(res.body.maxAttempts).toBe(5);
        expect(res.body.scoringMode).toBe(QuizScoringMode.AVERAGE);
        expect(res.body.allowLate).toBe(true);
        expect(res.body.deadline).toBe('2099-01-01T00:00:00.000Z');
      });
  
      it('should reject an invalid merged window with 400', async () => {
        const quiz = await createQuizViaApi([trueFalseQuestion()], {
          availableFrom: '2026-01-01T00:00:00.000Z',
          deadline: '2026-02-01T00:00:00.000Z',
        });
  
        await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/config`)
          .set(lecturer.auth)
          .send({ deadline: '2025-12-31T00:00:00.000Z' })
          .expect(400);
      });
  
      it('should return 403 for a non-owner Lecturer', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/config`)
          .set(otherLecturer.auth)
          .send({ maxAttempts: 99 })
          .expect(403);
      });
    });
  
    // ===========================================================================
    // PATCH /quizzes/:blockId/questions — replace-all
    // ===========================================================================
    describe('PATCH /quizzes/:blockId/questions (replace-all)', () => {
      it('should replace all questions', async () => {
        const quiz = await createQuizViaApi();
  
        const res = await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/questions`)
          .set(lecturer.auth)
          .send([singleChoiceQuestion(), fillInQuestion()])
          .expect(200);
  
        expect(res.body.questions).toHaveLength(2);
        expect(res.body.questions.map((q: { type: string }) => q.type).sort()).toEqual(
          [QuestionType.FILL_IN_BLANK, QuestionType.SINGLE_CHOICE].sort(),
        );
      });
  
      it('should reject invalid question payload with 400', async () => {
        const quiz = await createQuizViaApi();
  
        await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/questions`)
          .set(lecturer.auth)
          .send([])
          .expect(400);
      });
    });
  
    // ===========================================================================
    // GET /quizzes/:blockId/student — Student view (no answer keys)
    // ===========================================================================
    describe('GET /quizzes/:blockId/student', () => {
      it('should return quiz WITHOUT any answer key fields', async () => {
        const quiz = await createQuizViaApi([
          singleChoiceQuestion(),
          trueFalseQuestion(),
          fillInQuestion(),
        ]);
  
        const res = await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/student`)
          .set(student.auth)
          .expect(200);
  
        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain('isCorrect');
        expect(raw).not.toContain('correctBoolean');
        expect(raw).not.toContain('acceptedAnswers');
  
        // Options are present but only id/text/position
        const single = res.body.questions.find(
          (q: { type: string }) => q.type === QuestionType.SINGLE_CHOICE,
        );
        expect(single.options).toHaveLength(2);
        expect(single.options[0]).toEqual(
          expect.objectContaining({ id: expect.any(String), text: expect.any(String) }),
        );
        expect(single.options[0]).not.toHaveProperty('isCorrect');
      });
  
      it('should return 403 when a non-enrolled Student reads the quiz', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/student`)
          .set(outsider.auth)
          .expect(403);
      });
  
      it('should return 403 when availableFrom is in the future', async () => {
        const quiz = await createQuizViaApi();
        await setQuizConfig(quiz.id, {
          availableFrom: '2099-01-01T00:00:00.000Z',
        });
  
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/student`)
          .set(student.auth)
          .expect(403);
      });
  
      it('should return 404 for a non-existent quiz', async () => {
        await testApp
          .http()
          .get(`${basePath()}/non-existent/student`)
          .set(student.auth)
          .expect(404);
      });
    });
  
    // ===========================================================================
    // POST /quizzes/:blockId/attempts — submit
    // ===========================================================================
    describe('POST /quizzes/:blockId/attempts (submit)', () => {
      it('should submit a fully correct attempt and return score 100 with answers=null (not released)', async () => {
        const quiz = await createQuizViaApi([trueFalseQuestion()]);
        const q = quiz.questions[0];
  
        const res = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(201);
  
        expect(res.body.score).toBe(100);
        expect(res.body.isLate).toBe(false);
        expect(res.body.status).toBe(QuizAttemptStatus.SUBMITTED);
        expect(res.body.resultsReleased).toBe(false);
        expect(res.body.answers).toBeNull();
        expect(res.body.attemptNumber).toBe(1);
      });
  
      it('should grade a wrong answer with score 0', async () => {
        const quiz = await createQuizViaApi([trueFalseQuestion()]);
        const q = quiz.questions[0];
  
        const res = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: false }] })
          .expect(201);
  
        expect(res.body.score).toBe(0);
      });
  
      it('should grade fill-in-the-blank case-insensitively after trimming', async () => {
        const quiz = await createQuizViaApi([fillInQuestion()]);
        const q = quiz.questions[0];
  
        const res = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, textAnswer: '  TWO  ' }] })
          .expect(201);
  
        expect(res.body.score).toBe(100);
      });
  
      it('should grade multiple-choice all-or-nothing', async () => {
        const quiz = await createQuizViaApi([
          {
            type: QuestionType.MULTIPLE_CHOICE,
            text: 'OOP?',
            points: 2,
            options: [
              { text: 'Java', isCorrect: true },
              { text: 'Python', isCorrect: true },
              { text: 'C', isCorrect: false },
            ],
          },
        ]);
        const q = quiz.questions[0];
        const correctIds = q.options!.filter((o) => o.isCorrect).map((o) => o.id);
  
        // Missing one → 0
        const partial = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, selectedOptionIds: [correctIds[0]] }] })
          .expect(201);
        expect(partial.body.score).toBe(0);
  
        // Exact set → 100
        const full = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, selectedOptionIds: correctIds }] })
          .expect(201);
        expect(full.body.score).toBe(100);
      });
  
      it('should enforce attempt limit (409 after maxAttempts)', async () => {
        const quiz = await createQuizViaApi([trueFalseQuestion()], { maxAttempts: 2 });
        const q = quiz.questions[0];
  
        for (let i = 0; i < 2; i++) {
          await testApp
            .http()
            .post(`${basePath()}/${quiz.id}/attempts`)
            .set(student.auth)
            .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
            .expect(201);
        }
  
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(409);
      });
  
      it('should return 403 when a non-enrolled Student submits', async () => {
        const quiz = await createQuizViaApi();
        const q = quiz.questions[0];
  
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(outsider.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(403);
      });
  
      it('should reject late submission with 403 when allowLate = false', async () => {
        const quiz = await createQuizViaApi();
        await setQuizConfig(quiz.id, {
          deadline: '2020-01-01T00:00:00.000Z',
          allowLate: false,
        });
  
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [] })
          .expect(403);
      });
  
      it('should accept late submission and flag isLate=true when allowLate = true', async () => {
        const quiz = await createQuizViaApi([trueFalseQuestion()]);
        const q = quiz.questions[0];
        await setQuizConfig(quiz.id, {
          deadline: '2020-01-01T00:00:00.000Z',
          allowLate: true,
        });
  
        const res = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(201);
  
        expect(res.body.isLate).toBe(true);
  
        const persisted = await testApp.prisma.quizAttempt.findUniqueOrThrow({
          where: { id: res.body.id },
        });
        expect(persisted.isLate).toBe(true);
      });
  
      it('should reject when quiz is not yet available (403)', async () => {
        const quiz = await createQuizViaApi();
        await setQuizConfig(quiz.id, {
          availableFrom: '2099-01-01T00:00:00.000Z',
        });
  
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [] })
          .expect(403);
      });
  
      it('should reject an empty body with 400 (answers required)', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({})
          .expect(400);
      });
  
      it('should reject an unknown extra field with 400 (forbidNonWhitelisted)', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [], hacker: 'x' })
          .expect(400);
      });
    });
  
    // ===========================================================================
    // GET /quizzes/:blockId/my-latest-attempt
    // ===========================================================================
    describe('GET /quizzes/:blockId/my-latest-attempt', () => {
      it('should return null when no attempt exists', async () => {
        const quiz = await createQuizViaApi();
        const res = await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/my-latest-attempt`)
          .set(student.auth)
          .expect(200);
  
        // Nest serializes `null` as an empty body; supertest parses it to `{}`.
        expect(res.body === null || Object.keys(res.body).length === 0).toBe(true);
      });
  
      it('should hide per-question results before release', async () => {
        const quiz = await createQuizViaApi();
        const q = quiz.questions[0];
  
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(201);
  
        const res = await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/my-latest-attempt`)
          .set(student.auth)
          .expect(200);
  
        expect(res.body.resultsReleased).toBe(false);
        expect(res.body.answers).toBeNull();
        expect(res.body.score).toBe(100);
      });
  
      it('should show per-question results after release', async () => {
        const quiz = await createQuizViaApi();
        const q = quiz.questions[0];
  
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(201);
  
        await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/release-results`)
          .set(lecturer.auth)
          .expect(200);
  
        const res = await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/my-latest-attempt`)
          .set(student.auth)
          .expect(200);
  
        expect(res.body.resultsReleased).toBe(true);
        expect(res.body.answers).toHaveLength(1);
        expect(res.body.answers[0].isCorrect).toBe(true);
        expect(res.body.answers[0].correctAnswer).toBe(true);
      });
  
      it('should return only the Student own latest attempt', async () => {
        const quiz = await createQuizViaApi();
        const q = quiz.questions[0];
  
        // student submits 2 attempts
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(201);
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: false }] })
          .expect(201);
  
        const mine = await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/my-latest-attempt`)
          .set(student.auth)
          .expect(200);
        expect(mine.body.attemptNumber).toBe(2);
  
        // outsider is not enrolled → 403
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/my-latest-attempt`)
          .set(outsider.auth)
          .expect(403);
      });
    });
  
    // ===========================================================================
    // PATCH /quizzes/:blockId/release-results
    // ===========================================================================
    describe('PATCH /quizzes/:blockId/release-results', () => {
      it('should set resultsReleasedAt and be idempotent', async () => {
        const quiz = await createQuizViaApi();
  
        const r1 = await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/release-results`)
          .set(lecturer.auth)
          .expect(200);
        expect(r1.body.resultsReleasedAt).not.toBeNull();
  
        const r2 = await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/release-results`)
          .set(lecturer.auth)
          .expect(200);
        expect(r2.body.resultsReleasedAt).toBe(r1.body.resultsReleasedAt);
      });
  
      it('should return 403 for a non-owner Lecturer', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .patch(`${basePath()}/${quiz.id}/release-results`)
          .set(otherLecturer.auth)
          .expect(403);
      });
    });
  
    // ===========================================================================
    // GET /quizzes/:blockId/attempts (Lecturer)
    // ===========================================================================
    describe('GET /quizzes/:blockId/attempts (Lecturer)', () => {
      it('should list attempts paginated with student info and correct answers', async () => {
        const quiz = await createQuizViaApi([trueFalseQuestion()]);
        const q = quiz.questions[0];
  
        await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(201);
  
        const res = await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/attempts`)
          .set(lecturer.auth)
          .expect(200);
  
        expect(res.body.data).toHaveLength(1);
        expect(res.body.meta).toEqual({
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        });
        expect(res.body.data[0].student.email).toBe(student.email ?? expect.any(String));
        expect(res.body.data[0].answers[0].correctAnswer).toBe(true);
      });
  
      it('should return 403 for a non-owner Lecturer', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/attempts`)
          .set(otherLecturer.auth)
          .expect(403);
      });
  
      it('should reject invalid limit > 100 with 400', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/attempts`)
          .query({ limit: 101 })
          .set(lecturer.auth)
          .expect(400);
      });
  
      it('should reject page < 1 with 400', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/attempts`)
          .query({ page: 0 })
          .set(lecturer.auth)
          .expect(400);
      });
    });
  
    // ===========================================================================
    // GET /quizzes/:blockId/attempts/:attemptId (Lecturer)
    // ===========================================================================
    describe('GET /quizzes/:blockId/attempts/:attemptId (Lecturer)', () => {
      it('should return attempt detail with correct answers', async () => {
        const quiz = await createQuizViaApi([trueFalseQuestion()]);
        const q = quiz.questions[0];
  
        const submit = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(201);
  
        const res = await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/attempts/${submit.body.id}`)
          .set(lecturer.auth)
          .expect(200);
  
        expect(res.body.id).toBe(submit.body.id);
        expect(res.body.answers).toHaveLength(1);
        expect(res.body.answers[0].correctAnswer).toBe(true);
        expect(res.body.student.userId).toBe(student.id);
      });
  
      it('should return 404 for a non-existent attempt', async () => {
        const quiz = await createQuizViaApi();
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/attempts/non-existent`)
          .set(lecturer.auth)
          .expect(404);
      });
  
      it('should return 403 for a non-owner Lecturer', async () => {
        const quiz = await createQuizViaApi();
        const q = quiz.questions[0];
        const submit = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({ answers: [{ questionId: q.id, booleanAnswer: true }] })
          .expect(201);
  
        await testApp
          .http()
          .get(`${basePath()}/${quiz.id}/attempts/${submit.body.id}`)
          .set(otherLecturer.auth)
          .expect(403);
      });
    });
  
    // ===========================================================================
    // Aggregation across attempts
    // ===========================================================================
    describe('aggregation across attempts', () => {
      it('persists per-attempt scores so HIGHEST / LATEST / AVERAGE are computable', async () => {
        const quiz = await createQuizViaApi(
          [
            trueFalseQuestion({ points: 2 }),
            trueFalseQuestion({ text: 'Q2', points: 2, correctBoolean: true }),
          ],
          { maxAttempts: 3 },
        );
        const [q1, q2] = quiz.questions;
  
        // 1/2 → 50
        const a1 = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({
            answers: [
              { questionId: q1.id, booleanAnswer: true },
              { questionId: q2.id, booleanAnswer: false },
            ],
          })
          .expect(201);
        // 2/2 → 100
        const a2 = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({
            answers: [
              { questionId: q1.id, booleanAnswer: true },
              { questionId: q2.id, booleanAnswer: true },
            ],
          })
          .expect(201);
        // 1/2 → 50
        const a3 = await testApp
          .http()
          .post(`${basePath()}/${quiz.id}/attempts`)
          .set(student.auth)
          .send({
            answers: [
              { questionId: q1.id, booleanAnswer: true },
              { questionId: q2.id, booleanAnswer: false },
            ],
          })
          .expect(201);
  
        expect(a1.body.score).toBe(50);
        expect(a2.body.score).toBe(100);
        expect(a3.body.score).toBe(50);
  
        const scores = [a1.body.score, a2.body.score, a3.body.score] as number[];
        expect(Math.max(...scores)).toBe(100); // HIGHEST
        expect(scores[scores.length - 1]).toBe(50); // LATEST
        expect(scores.reduce((s, v) => s + v, 0) / scores.length).toBeCloseTo(66.67, 1); // AVERAGE
      });
    });
  });