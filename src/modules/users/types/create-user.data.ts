import type { UserRole } from '../../../generated/prisma/client.js';
export interface CreateUserData {
  email: string;
  passwordHash: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
}
