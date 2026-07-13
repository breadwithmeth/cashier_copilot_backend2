import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../common/services/prisma.js';
import { requireRoles, requireUser } from '../../common/guards/access.js';
import { HttpError } from '../../common/errors/http-error.js';
import { env } from '../../config/env.js';

const idParams = z.object({ id: z.string() });
const reviewSchema = z.object({
  decision: z.enum(['CONFIRM', 'REJECT', 'FALSE_POSITIVE', 'REQUEST_MORE_INFORMATION', 'MARK_CORRECTED', 'ESCALATE', 'RESOLVE']),
  comment: z.string().default('')
});

const decisionStatus = {
  CONFIRM: 'CONFIRMED',
  REJECT: 'REJECTED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  REQUEST_MORE_INFORMATION: 'IN_PROGRESS',
  MARK_CORRECTED: 'CORRECTED',
  ESCALATE: 'ESCALATED_TO_MANAGER',
  RESOLVE: 'RESOLVED'
} as const;

export function registerWorkflowRoutes(app: FastifyInstance) {
  app.post('/api/v1/violations/:id/review', async (request) => {
    const user = requireRoles(request, ['QUALITY_CONTROL', 'ADMIN', 'OPERATOR', 'STORE_MANAGER']);
    const { id } = idParams.parse(request.params);
    const input = reviewSchema.parse(request.body);
    const violation = await prisma.violation.findUnique({ where: { id } });
    if (!violation) throw new HttpError(404, 'Violation not found', 'NOT_FOUND');
    const newStatus = decisionStatus[input.decision];
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.violation.update({
        where: { id },
        data: { status: newStatus, reviewedByUserId: user.id, reviewedAt: new Date(), resolutionComment: input.comment }
      });
      await tx.violationReview.create({
        data: { violationId: id, reviewerUserId: user.id, previousStatus: violation.status, newStatus, decision: input.decision, comment: input.comment }
      });
      await tx.auditLog.create({ data: { userId: user.id, action: 'VIOLATION_REVIEW', entityType: 'Violation', entityId: id, storeId: violation.storeId, metadata: input } });
      return row;
    });
    return updated;
  });

  for (const [path, decision] of [
    ['confirm', 'CONFIRM'],
    ['reject', 'REJECT'],
    ['false-positive', 'FALSE_POSITIVE'],
    ['corrected', 'MARK_CORRECTED'],
    ['escalate', 'ESCALATE'],
    ['resolve', 'RESOLVE']
  ] as const) {
    app.post(`/api/v1/violations/:id/${path}`, async (request) => {
      request.body = { decision, comment: (request.body as any)?.comment ?? '' };
      return app.inject({
        method: 'POST',
        url: `/api/v1/violations/${(request.params as any).id}/review`,
        headers: request.headers as any,
        payload: request.body as any
      }).then((r) => JSON.parse(r.body));
    });
  }

  app.post('/api/v1/violations/:id/assign', async (request) => {
    requireRoles(request, ['QUALITY_CONTROL', 'ADMIN', 'OPERATOR', 'STORE_MANAGER']);
    const { id } = idParams.parse(request.params);
    const input = z.object({ assignedToUserId: z.string().optional(), assignedDepartment: z.string().optional() }).parse(request.body);
    return prisma.violation.update({ where: { id }, data: input });
  });

  for (const action of ['acknowledge', 'dismiss', 'corrected'] as const) {
    app.post(`/api/v1/employee-notifications/:id/${action}`, async (request) => {
      requireUser(request);
      const { id } = idParams.parse(request.params);
      const field = action === 'acknowledge' ? 'acknowledgedAt' : action === 'dismiss' ? 'dismissedAt' : 'correctedAt';
      const status = action === 'acknowledge' ? 'ACKNOWLEDGED' : action === 'dismiss' ? 'DISMISSED' : 'CORRECTED';
      return prisma.employeeNotification.update({ where: { id }, data: { [field]: new Date(), status } });
    });
  }

  app.get('/api/v1/workstations/:workstationId/notifications', { websocket: true }, async (connection, request) => {
    const { workstationId } = z.object({ workstationId: z.string() }).parse(request.params);
    const register = await prisma.register.findFirst({ where: { workstationId } });
    if (!register) {
      connection.socket.close(1008, 'Unknown workstation');
      return;
    }
    const timer = setInterval(async () => {
      const notifications = await prisma.employeeNotification.findMany({
        where: { registerId: register.id, status: 'PENDING', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { createdAt: 'asc' },
        take: 20
      });
      if (notifications.length) {
        connection.socket.send(JSON.stringify({ type: 'notifications', data: notifications }));
        await prisma.employeeNotification.updateMany({ where: { id: { in: notifications.map((n) => n.id) } }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      }
    }, 3000);
    connection.socket.on('close', () => clearInterval(timer));
  });

  app.post('/api/v1/reconciliations/:id/retry', async (request) => {
    requireRoles(request, ['ADMIN', 'QUALITY_CONTROL', 'ANALYST']);
    const { id } = idParams.parse(request.params);
    return prisma.saleReconciliation.update({ where: { id }, data: { status: 'PENDING', startedAt: new Date(), completedAt: null } });
  });

  app.post('/api/v1/evidence-clips/:id/regenerate', async (request) => {
    requireRoles(request, ['ADMIN', 'QUALITY_CONTROL', 'OPERATOR']);
    const { id } = idParams.parse(request.params);
    return prisma.evidenceClip.update({ where: { id }, data: { status: 'REQUESTED', errorCode: null, errorMessage: null } });
  });

  app.get('/api/v1/evidence-clips/:id/playback', async (request) => {
    const user = requireUser(request);
    const { id } = idParams.parse(request.params);
    const clip = await prisma.evidenceClip.findUnique({ where: { id } });
    if (!clip || clip.status !== 'AVAILABLE') throw new HttpError(404, 'Evidence not available', 'EVIDENCE_NOT_AVAILABLE');
    await prisma.auditLog.create({ data: { userId: user.id, action: 'EVIDENCE_PLAYBACK', entityType: 'EvidenceClip', entityId: id, storeId: clip.storeId } });
    return { playbackUrl: clip.playbackUrl, expiresAt: clip.expiresAt };
  });

  app.patch('/api/v1/analytics/evidence-clips/:id/status', async (request) => {
    const { id } = idParams.parse(request.params);
    const input = z.object({ status: z.string(), playbackUrl: z.string().url().optional(), errorCode: z.string().optional(), errorMessage: z.string().optional() }).parse(request.body);
    return prisma.evidenceClip.update({ where: { id }, data: input as any });
  });

  app.post('/api/v1/analytics/evidence-clips', async (request) => {
    const input = z.record(z.any()).parse(request.body);
    const eventAt = new Date(input.eventOccurredAt ?? Date.now());
    return prisma.evidenceClip.create({
      data: {
        storeId: input.storeId, registerId: input.registerId, cameraId: input.cameraId, sessionId: input.sessionId, receiptId: input.receiptId,
        violationId: input.violationId, mediaType: input.mediaType ?? 'AUDIO_VIDEO', storageProvider: input.storageProvider ?? 'protected',
        storageKey: input.storageKey ?? `clips/${Date.now()}`, eventOccurredAt: eventAt,
        clipStartAt: new Date(eventAt.getTime() - env.EVIDENCE_SECONDS_BEFORE * 1000),
        clipEndAt: new Date(eventAt.getTime() + env.EVIDENCE_SECONDS_AFTER * 1000),
        secondsBefore: env.EVIDENCE_SECONDS_BEFORE, secondsAfter: env.EVIDENCE_SECONDS_AFTER,
        durationSeconds: env.EVIDENCE_SECONDS_BEFORE + env.EVIDENCE_SECONDS_AFTER, status: 'REQUESTED', metadata: input.metadata ?? {}
      }
    });
  });
}
