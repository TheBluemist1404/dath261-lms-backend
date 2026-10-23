import type { WorkspaceMemberRole } from '../../src/generated/prisma/enums.js';
import type { TestApp } from './test-app.js';
import type { TestUser } from './users.js';

/** Creates a collaborative workspace through the API, owned by `owner`. */
export async function createWorkspace(testApp: TestApp, owner: TestUser, name = 'Study group') {
  const response = await testApp
    .http()
    .post('/api/workspaces')
    .set(owner.auth)
    .send({ name })
    .expect(201);

  return response.body as { id: string; name: string };
}

/** Adds a membership row directly, for tests that are not about the members API. */
export async function addMembership(
  testApp: TestApp,
  workspaceId: string,
  user: TestUser,
  role: WorkspaceMemberRole,
) {
  return testApp.prisma.workspaceMembership.create({
    data: { workspaceId, userId: user.id, role },
  });
}

export async function archiveWorkspace(testApp: TestApp, workspaceId: string) {
  await testApp.prisma.workspace.update({
    where: { id: workspaceId },
    data: { archivedAt: new Date() },
  });
}
