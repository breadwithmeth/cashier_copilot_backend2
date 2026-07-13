import type { FastifyInstance } from 'fastify';
import { prisma } from '../services/prisma.js';
import { hashApiKey } from '../utils/security.js';

export async function registerAuthMiddleware(app: FastifyInstance) {
  app.addHook('preHandler', async (request) => {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = await request.jwtVerify<{ id: string; email: string; role: any }>();
        const [stores, cities] = await Promise.all([
          prisma.userStoreAccess.findMany({ where: { userId: payload.id }, select: { storeId: true } }),
          prisma.userCityAccess.findMany({ where: { userId: payload.id }, select: { city: true } })
        ]);
        request.userContext = {
          id: payload.id,
          email: payload.email,
          role: payload.role,
          storeIds: stores.map((s) => s.storeId),
          cities: cities.map((c) => c.city)
        };
      } catch {
        return;
      }
    }
    const rawApiKey = request.headers['x-api-key'];
    if (typeof rawApiKey === 'string') {
      const keyPrefix = rawApiKey.split('_').slice(0, 2).join('_');
      const apiKey = await prisma.apiKey.findFirst({
        where: { keyPrefix, keyHash: hashApiKey(rawApiKey), isActive: true }
      });
      if (apiKey && (!apiKey.expiresAt || apiKey.expiresAt > new Date())) {
        request.apiKeyContext = {
          id: apiKey.id,
          serviceType: apiKey.serviceType,
          permissions: apiKey.permissions,
          allowedStoreIds: apiKey.allowedStoreIds,
          allowedRegisterIds: apiKey.allowedRegisterIds,
          allowedCameraIds: apiKey.allowedCameraIds
        };
        await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
      }
    }
  });
}
