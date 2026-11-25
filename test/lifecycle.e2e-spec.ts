import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser, type TestUser } from './support/users.js';

// IT-14: one course through its whole life, across modules, using only the HTTP API:
// a lecturer builds and publishes it, a student learns it and takes the quiz, the lecturer
// releases results, and an admin suspends the course.

interface StudentQuestion {
  id: string;
  type: string;
  options: { id: string; text: string }[];
}

describe('Course lifecycle across modules (e2e)', () => {
  let testApp: TestApp;
  let lecturer: TestUser;
  let student: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
    await resetDatabase(testApp.prisma);
    lecturer = await registerUser(testApp, 'LECTURER');
    student = await registerUser(testApp, 'STUDENT');
    admin = await createAdmin(testApp);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('runs from authoring to suspension', async () => {
    const http = () => testApp.http();

    // Lecturer: create a draft course with a text lesson and an auto-graded quiz.
    const course = await http()
      .post('/api/courses')
      .set(lecturer.auth)
      .send({ title: 'Lifecycle course', description: 'End to end' })
      .expect(201);
    const courseId: string = course.body.id;
    expect(course.body.status).toBe('DRAFT');

    const text = await http()
      .post(`/api/courses/${courseId}/blocks`)
      .set(lecturer.auth)
      .send({ type: 'TEXT', title: 'Read me', content: { text: '# Lesson' } })
      .expect(201);

    const quiz = await http()
      .post(`/api/courses/${courseId}/quizzes`)
      .set(lecturer.auth)
      .send({
        title: 'Check',
        maxAttempts: 2,
        questions: [
          {
            type: 'SINGLE_CHOICE',
            text: 'Pick A',
            points: 1,
            options: [
              { text: 'A', isCorrect: true },
              { text: 'B', isCorrect: false },
            ],
          },
          { type: 'TRUE_FALSE', text: 'True?', points: 1, correctBoolean: true },
        ],
      })
      .expect(201);
    const quizBlockId: string = quiz.body.id;

    // A draft course is not in the catalog and cannot be enrolled in.
    const draftCatalog = await http().get('/api/courses/catalog').expect(200);
    expect(draftCatalog.body.data.map((c: { id: string }) => c.id)).not.toContain(courseId);
    await http().post(`/api/courses/${courseId}/enrollments/me`).set(student.auth).expect(409);

    await http()
      .patch(`/api/courses/${courseId}/status`)
      .set(lecturer.auth)
      .send({ status: 'PUBLISHED' })
      .expect(200);

    // Student: find it, enroll, learn.
    const catalog = await http()
      .get('/api/courses/catalog')
      .query({ search: 'Lifecycle' })
      .expect(200);
    expect(catalog.body.data.map((c: { id: string }) => c.id)).toContain(courseId);

    await http().post(`/api/courses/${courseId}/enrollments/me`).set(student.auth).expect(201);

    const blocks = await http()
      .get(`/api/courses/${courseId}/blocks`)
      .set(student.auth)
      .expect(200);
    expect(blocks.body.map((b: { type: string }) => b.type)).toEqual(['TEXT', 'QUIZ']);

    await http()
      .patch(`/api/courses/${courseId}/blocks/${text.body.id}/progress`)
      .set(student.auth)
      .send({ completed: true })
      .expect(200);

    // The student view of the quiz carries no answer keys.
    const studentQuiz = await http()
      .get(`/api/courses/${courseId}/quizzes/${quizBlockId}/student`)
      .set(student.auth)
      .expect(200);
    expect(JSON.stringify(studentQuiz.body)).not.toMatch(/isCorrect|correctBoolean/);

    const questions: StudentQuestion[] = studentQuiz.body.questions;
    const single = questions.find((q) => q.type === 'SINGLE_CHOICE');
    const trueFalse = questions.find((q) => q.type === 'TRUE_FALSE');
    if (!single || !trueFalse) throw new Error('Quiz questions missing from the student view');
    const optionA = single.options.find((o) => o.text === 'A');
    if (!optionA) throw new Error('Option A missing');

    const attempt = await http()
      .post(`/api/courses/${courseId}/quizzes/${quizBlockId}/attempts`)
      .set(student.auth)
      .send({
        answers: [
          { questionId: single.id, selectedOptionIds: [optionA.id] },
          { questionId: trueFalse.id, booleanAnswer: false },
        ],
      })
      .expect(201);
    expect(attempt.body).toMatchObject({ attemptNumber: 1, resultsReleased: false, answers: null });
    expect(attempt.body.score).toBe(50);

    const progress = await http()
      .get(`/api/courses/${courseId}/progress`)
      .set(student.auth)
      .expect(200);
    expect(progress.body.progress).toMatchObject({
      completedItems: 2,
      totalItems: 2,
      learningProgressPercentage: 100,
      completedQuizzes: 1,
      quizCompletionPercentage: 100,
    });

    // Lecturer: sees the student and the attempt, then releases results.
    const roster = await http()
      .get(`/api/courses/${courseId}/enrollments`)
      .set(lecturer.auth)
      .expect(200);
    expect(JSON.stringify(roster.body)).toContain(student.email);

    const attempts = await http()
      .get(`/api/courses/${courseId}/quizzes/${quizBlockId}/attempts`)
      .set(lecturer.auth)
      .expect(200);
    expect(JSON.stringify(attempts.body)).toContain(attempt.body.id);

    await http()
      .patch(`/api/courses/${courseId}/quizzes/${quizBlockId}/release-results`)
      .set(lecturer.auth)
      .expect(200);

    // Student: is notified, and now sees per-question results.
    const notifications = await http()
      .get('/api/users/me/notifications')
      .set(student.auth)
      .expect(200);
    expect(notifications.body.data.map((n: { type: string }) => n.type)).toContain(
      'RESULT_RELEASED',
    );

    const latest = await http()
      .get(`/api/courses/${courseId}/quizzes/${quizBlockId}/my-latest-attempt`)
      .set(student.auth)
      .expect(200);
    expect(latest.body.resultsReleased).toBe(true);
    expect(latest.body.answers).toHaveLength(2);

    // Admin: suspends the course; it leaves the catalog and the student loses access.
    await http()
      .patch(`/api/admin/courses/${courseId}/suspension`)
      .set(admin.auth)
      .send({ suspended: true })
      .expect(200);

    const suspendedCatalog = await http().get('/api/courses/catalog').expect(200);
    expect(suspendedCatalog.body.data.map((c: { id: string }) => c.id)).not.toContain(courseId);
    await http().get(`/api/courses/${courseId}/blocks`).set(student.auth).expect(403);
    await http()
      .post(`/api/courses/${courseId}/quizzes/${quizBlockId}/attempts`)
      .set(student.auth)
      .send({ answers: [] })
      .expect(403);

    // Restoring it gives access back.
    await http()
      .patch(`/api/admin/courses/${courseId}/suspension`)
      .set(admin.auth)
      .send({ suspended: false })
      .expect(200);
    await http().get(`/api/courses/${courseId}/blocks`).set(student.auth).expect(200);
  });
});
