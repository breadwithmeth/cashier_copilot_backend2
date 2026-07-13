import type { FastifyRequest } from 'fastify';
import type { UserRole } from '@prisma/client';
import { HttpError } from '../errors/http-error.js';

export const fullAccessRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS_DIRECTOR'];

export function requireUser(request: FastifyRequest) {
  if (!request.userContext) throw new HttpError(401, 'Authentication required', 'AUTH_REQUIRED');
  return request.userContext;
}

export function requireRoles(request: FastifyRequest, roles: UserRole[]) {
  const user = requireUser(request);
  if (!roles.includes(user.role) && user.role !== 'SUPER_ADMIN') {
    throw new HttpError(403, 'Insufficient permissions', 'FORBIDDEN');
  }
  return user;
}

export function canAccessStore(request: FastifyRequest, storeId?: string | null) {
  const user = requireUser(request);
  if (!storeId || fullAccessRoles.includes(user.role)) return true;
  if (user.storeIds.includes(storeId)) return true;
  throw new HttpError(403, 'Store access denied', 'STORE_ACCESS_DENIED');
}

export function requireApiPermission(request: FastifyRequest, permission: string) {
  const apiKey = request.apiKeyContext;
  if (!apiKey) throw new HttpError(401, 'API key required', 'API_KEY_REQUIRED');
  if (!apiKey.permissions.includes(permission) && !apiKey.permissions.includes('*')) {
    throw new HttpError(403, 'API key permission denied', 'API_KEY_FORBIDDEN');
  }
  return apiKey;
}
