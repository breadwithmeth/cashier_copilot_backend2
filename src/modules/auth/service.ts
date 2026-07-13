import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../common/services/prisma.js';
import { HttpError } from '../../common/errors/http-error.js';
import { hashToken, omitSensitive, verifyPassword } from '../../common/utils/security.js';
import { env } from '../../config/env.js';
import { requireUser } from '../../common/guards/access.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

function signTokens(user: { id: string; email: string; role: string }) {
  const accessToken = jwt.sign(user, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN as any });
  const refreshToken = jwt.sign({ id: user.id }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any });
  return { accessToken, refreshToken };
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/login', async (request) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !user.isActive || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }
    const tokens = signTokens(user);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), refreshTokenHash: hashToken(tokens.refreshToken) }
    });
    await prisma.auditLog.create({ data: { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id } });
    return { user: omitSensitive(user), ...tokens };
  });

  app.post('/api/v1/auth/refresh', async (request) => {
    const input = refreshSchema.parse(request.body);
    let payload: any;
    try {
      payload = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET);
    } catch {
      throw new HttpError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user?.refreshTokenHash || user.refreshTokenHash !== hashToken(input.refreshToken)) {
      throw new HttpError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }
    const tokens = signTokens(user);
    await prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: hashToken(tokens.refreshToken) } });
    return tokens;
  });

  app.post('/api/v1/auth/logout', async (request) => {
    const user = requireUser(request);
    await prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: null } });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', async (request) => {
    const user = requireUser(request);
    const row = await prisma.user.findUnique({ where: { id: user.id } });
    if (!row) throw new HttpError(404, 'User not found', 'NOT_FOUND');
    return omitSensitive(row);
  });
}
