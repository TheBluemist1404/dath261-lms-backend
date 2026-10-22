import type { UserRole } from '../../../generated/prisma/client.js';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}
