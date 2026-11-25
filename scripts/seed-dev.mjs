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
  // Admins have no workspace, so this account only opens the admin screens.
  ['seed-user-admin', 'admin@dath261.dev', 'Dung', 'Pham', 'ADMIN'],
];

const courses = [
  ['seed-course-algorithms', 'Algorithms', 'PUBLISHED'],
  ['seed-course-databases', 'Databases', 'PUBLISHED'],
  ['seed-course-draft', 'Compilers (draft)', 'DRAFT'],
];

// Content follows the block content contract: TEXT {text} (Markdown), VIDEO {url, durationSeconds},
// FILE {url, fileName, sizeBytes}. The quiz block gets its questions further down.
const blocks = [
  [
    'seed-block-intro',
    'seed-course-algorithms',
    'TEXT',
    'Welcome to Algorithms',
    0,
    {
      text: [
        '# Welcome',
        'This course covers **graph search**, shortest paths and greedy algorithms.',
        '## How to use this course',
        '- Read each lesson, then mark it complete.',
        '- Watch the lecture and take *Quiz 1* at the end.',
      ].join('\n'),
    },
  ],
  [
    'seed-block-slides',
    'seed-course-algorithms',
    'FILE',
    'Week 1 slides',
    1,
    {
      url: 'https://example.com/dath261/week-1-slides.pdf',
      fileName: 'week-1-slides.pdf',
      sizeBytes: 482133,
    },
  ],
  [
    'seed-block-lecture',
    'seed-course-algorithms',
    'VIDEO',
    'Graph search lecture',
    2,
    { url: 'https://example.com/dath261/graph-search.mp4', durationSeconds: 754 },
  ],
  ['seed-block-quiz', 'seed-course-algorithms', 'QUIZ', 'Quiz 1', 3, null],
  [
    'seed-block-databases-intro',
    'seed-course-databases',
    'TEXT',
    'What is a relational database?',
    0,
    { text: 'Tables, keys and the **relational model**.' },
  ],
  [
    'seed-block-normal-forms',
    'seed-course-databases',
    'FILE',
    'Normal forms handout',
    1,
    {
      url: 'https://example.com/dath261/normal-forms.pdf',
      fileName: 'normal-forms.pdf',
      sizeBytes: 120400,
    },
  ],
  ['seed-block-draft', 'seed-course-draft', 'FILE', 'Parsing notes', 0, null],
];

// Quiz 1 is auto-graded: three questions worth 1 point each, three attempts, best score counts.
const quizQuestions = [
  [
    'seed-question-bfs',
    'SINGLE_CHOICE',
    'Which data structure does breadth-first search use?',
    0,
    null,
    [
      ['seed-option-bfs-queue', 'A queue', true],
      ['seed-option-bfs-stack', 'A stack', false],
      ['seed-option-bfs-heap', 'A heap', false],
    ],
  ],
  [
    'seed-question-dijkstra',
    'TRUE_FALSE',
    "Dijkstra's algorithm works with negative edge weights.",
    1,
    false,
    [],
  ],
  [
    'seed-question-greedy',
    'MULTIPLE_CHOICE',
    'Which of these are greedy algorithms?',
    2,
    null,
    [
      ['seed-option-greedy-prim', "Prim's algorithm", true],
      ['seed-option-greedy-kruskal', "Kruskal's algorithm", true],
      ['seed-option-greedy-floyd', 'Floyd-Warshall', false],
    ],
  ],
];

// The student is enrolled in Algorithms only, so Databases references show as locked.
const enrollments = [
  ['seed-enrollment-student-algorithms', 'seed-user-student', 'seed-course-algorithms'],
];

// Plain-text content; shared pages turn it into their collaborative document on first open.
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
  // Seed blocks made by an older seed had less content and other positions: add the missing
  // content keys (keys already there win) and put the seed blocks back in seed order.
  for (const [id, courseId, type, title, position, content] of blocks) {
    await client.query(
      `INSERT INTO course_blocks (id, course_id, type, title, position, content, updated_at)
       VALUES ($1, $2, $3::"BlockType", $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         position = EXCLUDED.position,
         content = COALESCE(
           EXCLUDED.content || course_blocks.content,
           course_blocks.content,
           EXCLUDED.content
         )`,
      [id, courseId, type, title, position, content],
    );
  }
  await client.query(
    `INSERT INTO quiz_configs (id, course_block_id, max_attempts, scoring_mode, updated_at)
     VALUES ('seed-quiz-config', 'seed-block-quiz', 3, 'HIGHEST'::"QuizScoringMode", now())
     ON CONFLICT DO NOTHING`,
  );
  for (const [id, type, text, position, correctBoolean, options] of quizQuestions) {
    await client.query(
      `INSERT INTO quiz_questions (id, course_block_id, type, text, points, position, correct_boolean, updated_at)
       VALUES ($1, 'seed-block-quiz', $2::"QuestionType", $3, 1, $4, $5, now()) ON CONFLICT DO NOTHING`,
      [id, type, text, position, correctBoolean],
    );
    for (const [index, [optionId, optionText, isCorrect]] of options.entries()) {
      await client.query(
        `INSERT INTO quiz_options (id, question_id, text, is_correct, position)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [optionId, id, optionText, isCorrect, index],
      );
    }
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
