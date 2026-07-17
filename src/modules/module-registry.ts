import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { registerCrudRoutes } from '../common/services/crud.js';
import { maskRtsp } from '../common/utils/security.js';

const json = z.record(z.any()).default({});
const baseCreate = z.record(z.any());

export function registerDomainCrud(app: FastifyInstance, prisma: PrismaClient) {
  const modules = [
    ['stores', 'store', ['name', 'code', 'city', 'type']],
    ['registers', 'register', ['name', 'code'], true],
    ['cameras', 'camera', ['name', 'code'], true],
    ['employees', 'employee', ['firstName', 'lastName', 'employeeNumber'], true],
    ['shifts', 'shift', ['externalId'], true],
    ['receipts', 'receipt', ['receiptNumber', 'externalId'], true],
    ['payments', 'payment', ['externalId']],
    ['pos-operations', 'posOperation', ['externalEventId'], true],
    ['checkout-sessions', 'checkoutSession', ['correlationId'], true],
    ['analytics-events', 'analyticsEvent', ['externalEventId', 'eventType'], true],
    ['detections', 'detection', ['className'], true],
    ['speech-events', 'speechEvent', ['text', 'externalEventId'], true],
    ['cashier-actions', 'cashierAction', ['source'], true],
    ['action-types', 'actionType', ['code', 'name']],
    ['reconciliations', 'saleReconciliation', ['status']],
    ['service-standards', 'serviceStandard', ['name']],
    ['service-evaluations', 'serviceEvaluation', ['result']],
    ['suppliers', 'supplier', ['name', 'code']],
    ['receiving-documents', 'receivingDocument', ['documentNumber', 'externalId'], true],
    ['receiving-sessions', 'receivingSession', ['status'], true],
    ['rules', 'rule', ['name', 'code']],
    ['violations', 'violation', ['title', 'violationType'], true],
    ['violation-reviews', 'violationReview', ['comment']],
    ['evidence-clips', 'evidenceClip', ['storageKey'], true],
    ['employee-notifications', 'employeeNotification', ['title', 'message'], true],
    ['manager-notifications', 'employeeNotification', ['title', 'message'], true],
    ['alerts', 'violation', ['title', 'violationType'], true],
    ['integration-events', 'integrationEvent', ['externalEventId', 'eventType']],
    ['integration-errors', 'integrationError', ['message', 'errorType']],
    ['scheduled-tasks', 'scheduledTask', ['type']],
    ['reports', 'report', ['type', 'format']],
    ['audit-logs', 'auditLog', ['action', 'entityType']]
  ] as const;

  for (const [route, model, searchFields, storeScoped] of modules) {
    registerCrudRoutes(app, prisma, {
      route: `/api/v1/${route}`,
      model: model as any,
      searchFields: [...searchFields],
      storeScoped,
      createSchema: baseCreate,
      updateSchema: baseCreate,
      sanitize:
        route === 'cameras'
          ? (row) => ({ ...row, videoRtspUrl: maskRtsp(row.videoRtspUrl), audioRtspUrl: maskRtsp(row.audioRtspUrl) })
          : undefined
    });
  }

  app.post('/api/v1/cameras/:id/stream-credentials', async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const camera = await prisma.camera.findUnique({ where: { id: params.id } });
    if (!camera) return app.httpErrors.notFound('Camera not found');
    await prisma.auditLog.create({
      data: {
        userId: request.userContext?.id,
        apiKeyId: request.apiKeyContext?.id,
        action: 'STREAM_CREDENTIAL_ACCESS',
        entityType: 'Camera',
        entityId: camera.id,
        storeId: camera.storeId,
        metadata: json.parse({})
      }
    });
    return {
      videoRtspUrl: camera.videoRtspUrl,
      audioRtspUrl: camera.audioRtspUrl,
      videoAnalyticsStreamUrl: camera.videoAnalyticsStreamUrl,
      audioAnalyticsStreamUrl: camera.audioAnalyticsStreamUrl
    };
  });
}
