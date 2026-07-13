import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../common/services/prisma.js';
import { requireUser } from '../../common/guards/access.js';

const params = z.object({ id: z.string() });

export function registerTimelineRoutes(app: FastifyInstance) {
  async function timeline(sessionId: string) {
    const [pos, analytics, speech, actions, violations, notifications, evidence, payments] = await Promise.all([
      prisma.posOperation.findMany({ where: { checkoutSessionId: sessionId } }),
      prisma.analyticsEvent.findMany({ where: { sessionId } }),
      prisma.speechEvent.findMany({ where: { sessionId } }),
      prisma.cashierAction.findMany({ where: { sessionId } }),
      prisma.violation.findMany({ where: { sessionId }, include: { reviews: true } }),
      prisma.employeeNotification.findMany({ where: { sessionId } }),
      prisma.evidenceClip.findMany({ where: { sessionId } }),
      prisma.payment.findMany({ where: { receipt: { checkoutSessionId: sessionId } } })
    ]);
    return [...pos.map((x) => ({ type: 'pos', at: x.occurredAt, data: x })), ...analytics.map((x) => ({ type: 'analytics', at: x.occurredAt, data: x })), ...speech.map((x) => ({ type: 'speech', at: x.startedAt, data: x })), ...actions.map((x) => ({ type: 'action', at: x.startedAt, data: x })), ...violations.map((x) => ({ type: 'violation', at: x.occurredAt, data: x })), ...notifications.map((x) => ({ type: 'notification', at: x.createdAt, data: x })), ...evidence.map((x) => ({ type: 'evidence', at: x.eventOccurredAt, data: x })), ...payments.map((x) => ({ type: 'payment', at: x.occurredAt, data: x }))].sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  app.get('/api/v1/checkout-sessions/:id/timeline', async (request) => {
    requireUser(request);
    return { data: await timeline(params.parse(request.params).id) };
  });
  app.get('/api/v1/receipts/:id/timeline', async (request) => {
    requireUser(request);
    const receipt = await prisma.receipt.findUnique({ where: { id: params.parse(request.params).id } });
    return { data: receipt?.checkoutSessionId ? await timeline(receipt.checkoutSessionId) : [] };
  });
  app.get('/api/v1/receiving-sessions/:id/timeline', async (request) => {
    requireUser(request);
    const { id } = params.parse(request.params);
    const [session, evidence, violations] = await Promise.all([
      prisma.receivingSession.findUnique({ where: { id }, include: { analyses: true } }),
      prisma.evidenceClip.findMany({ where: { receivingSessionId: id } }),
      prisma.violation.findMany({ where: { receivingSessionId: id } })
    ]);
    return { data: [{ type: 'receiving-session', at: session?.startedAt, data: session }, ...evidence.map((e) => ({ type: 'evidence', at: e.eventOccurredAt, data: e })), ...violations.map((v) => ({ type: 'violation', at: v.occurredAt, data: v }))] };
  });
}
