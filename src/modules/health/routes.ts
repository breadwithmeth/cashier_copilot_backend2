import type { FastifyInstance } from 'fastify';
import { prisma } from '../../common/services/prisma.js';

export function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));
  app.get('/ready', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ready', postgres: 'ok', prisma: 'ok', scheduledWorker: 'configured', websocket: 'enabled' };
  });
}
