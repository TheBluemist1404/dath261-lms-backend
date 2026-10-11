import type { UserRole } from '../../../generated/prisma/client.js';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
}
