import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../generated/prisma/client.js';
import { RolesGuard } from './roles.guard.js';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;
  let getAllAndOverride: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getAllAndOverride = vi.fn();

    reflector = {
      getAllAndOverride,
    } as unknown as Reflector;

    guard = new RolesGuard(reflector);
  });

  function createExecutionContext(user?: { role: UserRole }): ExecutionContext {
    const request = user ? { user } : {};

    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue(request),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access when no roles are required', () => {
    getAllAndOverride.mockReturnValue(undefined);

    const context = createExecutionContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw UnauthorizedException when the user is missing', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    const context = createExecutionContext();

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should allow access when the user has a required role', () => {
    getAllAndOverride.mockReturnValue([UserRole.STUDENT]);

    const context = createExecutionContext({
      role: UserRole.STUDENT,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException when the user lacks the required role', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    const context = createExecutionContext({
      role: UserRole.STUDENT,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow access when the user matches any of the required roles', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN, UserRole.LECTURER]);

    const context = createExecutionContext({
      role: UserRole.LECTURER,
    });

    expect(guard.canActivate(context)).toBe(true);
  });
});
