import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { validatorCompiler, serializerCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { prisma } from './common/services/prisma.js';
import './common/types/auth.js';
import { registerAuthMiddleware } from './common/middleware/auth.js';
import { registerErrorHandler } from './common/middleware/error-handler.js';
import { registerAuthRoutes } from './modules/auth/service.js';
import { registerDomainCrud } from './modules/module-registry.js';
import { registerIngestionRoutes } from './modules/ingestion/service.js';
import { registerWorkflowRoutes } from './modules/workflows/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { registerTimelineRoutes } from './modules/timeline/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerReportRoutes } from './modules/reports/routes.js';
import { registerCameraRoiRoutes } from './modules/cameras/roi-routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    requestIdHeader: 'x-request-id',
    bodyLimit: 10 * 1024 * 1024
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(helmet);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(sensible);
  await app.register(websocket);
  await app.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024,
      files: 1
    }
  });
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Cashier Copilot Backend', version: '1.0.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' }
        }
      },
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }]
    },
    transform: jsonSchemaTransform
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await registerAuthMiddleware(app);
  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerDomainCrud(app, prisma);
  registerIngestionRoutes(app);
  registerWorkflowRoutes(app);
  registerDashboardRoutes(app);
  registerTimelineRoutes(app);
  registerReportRoutes(app);
  registerCameraRoiRoutes(app);
  app.addHook('onClose', async () => prisma.$disconnect());
  return app;
}
