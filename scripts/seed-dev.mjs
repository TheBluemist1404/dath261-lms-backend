// Development seed for trying the workspace UI against a real backend.
// Usage: pnpm db:seed:dev (needs DATABASE_URL; refuses to run in production).
// Rows use fixed ids, so running it again leaves existing data untouched.
import 'dotenv/config';
import bcrypt from 'bcrypt';
import pg from 'pg';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a production database.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const PASSWORD = 'password123';

const users = [
  ['seed-user-student', 'student@dath261.dev', 'An', 'Nguyen', 'STUDENT'],
  ['seed-user-classmate', 'classmate@dath261.dev', 'Binh', 'Tran', 'STUDENT'],
  ['seed-user-lecturer', 'lecturer@dath261.dev', 'Chi', 'Le', 'LECTURER'],
];

const courses = [
  ['seed-course-algorithms', 'Algorithms', 'PUBLISHED'],
  ['seed-course-databases', 'Databases', 'PUBLISHED'],
  ['seed-course-draft', 'Compilers (draft)', 'DRAFT'],
];

const blocks = [
  ['seed-block-slides', 'seed-course-algorithms', 'FILE', 'Week 1 slides', 0, null],
  [
    'seed-block-lecture',
    'seed-course-algorithms',
    'VIDEO',
    'Graph search lecture',
    1,
    { durationSeconds: 754 },
  ],
  ['seed-block-quiz', 'seed-course-algorithms', 'QUIZ', 'Quiz 1', 2, null],
  ['seed-block-normal-forms', 'seed-course-databases', 'FILE', 'Normal forms handout', 0, null],
  ['seed-block-draft', 'seed-course-draft', 'FILE', 'Parsing notes', 0, null],
];

// The student is enrolled in Algorithms only, so Databases references show as locked.
const enrollments = [
  ['seed-enrollment-student-algorithms', 'seed-user-student', 'seed-course-algorithms'],
];

// The frontend editor is still a plain-text stand-in; this is the shape it saves.
function paragraphs(...texts) {
  return { type: 'plain-text', text: texts.join('\n\n') };
}

const pages = [
  ['seed-page-overview', 'Course overview', null, paragraphs('Notes for the Algorithms course.')],
  [
    'seed-page-graphs',
    'Graph search',
    'seed-page-overview',
    paragraphs(
      'Breadth-first search visits nodes level by level.',
      'Dijkstra handles weighted edges.',
    ),
  ],
  ['seed-page-exam', 'Exam prep', null, paragraphs('Past papers and questions to revisit.')],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query('BEGIN');
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const [id, email, firstName, lastName, role] of users) {
    await client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::"UserRole", now()) ON CONFLICT DO NOTHING`,
      [id, email, passwordHash, firstName, lastName, role],
    );
  }
  for (const [id, title, status] of courses) {
    await client.query(
      `INSERT INTO courses (id, title, status, lecturer_id, updated_at)
       VALUES ($1, $2, $3::"CourseStatus", 'seed-user-lecturer', now()) ON CONFLICT DO NOTHING`,
      [id, title, status],
    );
  }
  for (const [id, courseId, type, title, position, content] of blocks) {
    await client.query(
      `INSERT INTO course_blocks (id, course_id, type, title, position, content, updated_at)
       VALUES ($1, $2, $3::"BlockType", $4, $5, $6, now()) ON CONFLICT DO NOTHING`,
      [id, courseId, type, title, position, content],
    );
  }
  for (const [id, userId, courseId] of enrollments) {
    await client.query(
      'INSERT INTO enrollments (id, user_id, course_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [id, userId, courseId],
    );
  }

  await client.query(
    `INSERT INTO workspaces (id, name, type, created_by_id, updated_at)
     VALUES ('seed-workspace-study', 'Algorithms study group', 'COLLABORATIVE', 'seed-user-student', now())
     ON CONFLICT DO NOTHING`,
  );
  for (const [id, userId, role] of [
    ['seed-membership-student', 'seed-user-student', 'OWNER'],
    ['seed-membership-classmate', 'seed-user-classmate', 'MEMBER'],
  ]) {
    await client.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role)
       VALUES ($1, 'seed-workspace-study', $2, $3::"WorkspaceMemberRole") ON CONFLICT DO NOTHING`,
      [id, userId, role],
    );
  }
  for (const [id, title, parentPageId, content] of pages) {
    await client.query(
      `INSERT INTO pages (id, workspace_id, title, parent_page_id, content, updated_at)
       VALUES ($1, 'seed-workspace-study', $2, $3, $4, now()) ON CONFLICT DO NOTHING`,
      [id, title, parentPageId, content],
    );
  }
  for (const [id, blockId, timestamp] of [
    ['seed-reference-lecture', 'seed-block-lecture', 95],
    ['seed-reference-normal-forms', 'seed-block-normal-forms', null],
  ]) {
    await client.query(
      `INSERT INTO resource_references (id, page_id, course_block_id, timestamp_seconds)
       VALUES ($1, 'seed-page-graphs', $2, $3) ON CONFLICT DO NOTHING`,
      [id, blockId, timestamp],
    );
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}

console.log(`Seeded development data. Sign in with any of these, password "${PASSWORD}":`);
for (const [, email, , , role] of users) {
  console.log(`  ${role.padEnd(8)} ${email}`);
}
