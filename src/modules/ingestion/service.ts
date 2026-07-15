import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MediaType, NotificationDisplayMode, Severity } from '@prisma/client';
import { prisma } from '../../common/services/prisma.js';
import { requireApiPermission } from '../../common/guards/access.js';
import { HttpError } from '../../common/errors/http-error.js';
import { HIGH_RISK_MESSAGES } from '../../config/constants.js';
import { detectProfanity } from '../../common/utils/profanity.js';

const batch = <T extends z.ZodTypeAny>(item: T) => z.object({ records: z.array(item).min(1).max(500) });
const receiptItem = z.object({
  productCode: z.string(),
  barcode: z.string().optional(),
  productName: z.string(),
  quantity: z.coerce.number(),
  unit: z.string(),
  unitPrice: z.coerce.number(),
  discountAmount: z.coerce.number().default(0),
  totalAmount: z.coerce.number(),
  isContainer: z.boolean().default(false),
  containerType: z.string().optional(),
  metadata: z.record(z.any()).default({})
});
const receiptInput = z.object({
  externalId: z.string(),
  receiptNumber: z.string(),
  storeCode: z.string(),
  registerCode: z.string(),
  employeeExternalId: z.string().optional(),
  operationType: z.enum(['SALE', 'RETURN', 'CANCELLATION', 'VOID', 'RECEIPT_CORRECTION']),
  status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED', 'VOIDED', 'RETURNED', 'PARTIALLY_RETURNED']),
  openedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'BONUS', 'MIXED', 'QR', 'OTHER']),
  subtotalAmount: z.coerce.number(),
  discountAmount: z.coerce.number().default(0),
  totalAmount: z.coerce.number(),
  paidAmount: z.coerce.number(),
  expectedChangeAmount: z.coerce.number().optional(),
  actualChangeAmount: z.coerce.number().optional(),
  currency: z.string().default('KZT'),
  items: z.array(receiptItem).default([]),
  metadata: z.record(z.any()).default({})
});
const posInput = z.object({
  externalEventId: z.string(),
  idempotencyKey: z.string().optional(),
  storeCode: z.string(),
  registerCode: z.string(),
  operationType: z.string(),
  occurredAt: z.coerce.date(),
  correlationId: z.string().optional(),
  productCode: z.string().optional(),
  barcode: z.string().optional(),
  quantity: z.coerce.number().optional(),
  amount: z.coerce.number().optional(),
  payload: z.record(z.any()).default({})
});
const videoEventInput = z.object({
  externalEventId: z.string(),
  idempotencyKey: z.string().optional(),
  cameraCode: z.string(),
  registerCode: z.string().optional(),
  eventType: z.string(),
  source: z.string(),
  occurredAt: z.coerce.date(),
  frameTimestampMs: z.coerce.bigint().optional(),
  confidence: z.number().optional(),
  trackId: z.string().optional(),
  modelName: z.string().optional(),
  modelVersion: z.string().optional(),
  correlationId: z.string().optional(),
  payload: z.record(z.any()).default({})
});
const audioEventInput = videoEventInput.extend({
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
  speakerType: z.enum(['CASHIER', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'UNKNOWN', 'MULTIPLE']).default('UNKNOWN'),
  language: z.string().default('ru'),
  text: z.string().default(''),
  audioSource: z.enum(['CAMERA_AUDIO_RTSP', 'EXTERNAL_MICROPHONE_RTSP', 'EMBEDDED_VIDEO_AUDIO', 'UPLOADED_AUDIO', 'OTHER']).default('OTHER'),
  words: z.array(z.any()).default([]),
  metadata: z.record(z.any()).default({})
});

const videoViolationRules: Record<string, string> = {
  PRODUCT_TRANSFERRED: 'product-transferred-not-scanned',
  SCAN_SIMULATION_SUSPECTED: 'scanner-without-pos-scan',
  CONTAINER_TRANSFERRED: 'container-transferred-not-scanned',
  RECEIPT_NOT_GIVEN: 'receipt-not-given',
  BUSINESS_CARD_NOT_GIVEN: 'business-card-not-given',
  PHONE_DISTRACTION_DETECTED: 'phone-distraction',
  CUSTOMER_WAITING_TOO_LONG: 'customer-waiting-too-long',
  CASHIER_ABSENT_DURING_SERVICE: 'cashier-absent-during-service',
  OBJECT_LEFT_IN_SCAN_ZONE: 'object-left-in-scan-zone',
  NO_PAYMENT_OR_RECEIPT_SPEECH: 'payment-or-receipt-speech-missing',
  NO_FAREWELL: 'farewell-missing'
};

async function resolveStoreRegister(storeCode: string, registerCode?: string) {
  const store = await prisma.store.findUnique({ where: { code: storeCode } });
  if (!store) throw new HttpError(404, 'Store not found', 'STORE_NOT_FOUND');
  const register = registerCode
    ? await prisma.register.findUnique({ where: { storeId_code: { storeId: store.id, code: registerCode } } })
    : null;
  if (registerCode && !register) throw new HttpError(404, 'Register not found', 'REGISTER_NOT_FOUND');
  return { store, register };
}

async function findOrCreateSession(args: { storeId: string; registerId: string; correlationId?: string; at: Date; receiptId?: string }) {
  const where = args.correlationId
    ? { correlationId: args.correlationId, storeId: args.storeId, registerId: args.registerId, status: 'OPEN' as const }
    : { storeId: args.storeId, registerId: args.registerId, status: 'OPEN' as const };
  const existing = await prisma.checkoutSession.findFirst({ where, orderBy: { startedAt: 'desc' } });
  if (existing) {
    return prisma.checkoutSession.update({ where: { id: existing.id }, data: { lastActivityAt: args.at, receiptId: args.receiptId ?? existing.receiptId } });
  }
  return prisma.checkoutSession.create({
    data: { storeId: args.storeId, registerId: args.registerId, correlationId: args.correlationId, startedAt: args.at, lastActivityAt: args.at, status: 'OPEN', receiptId: args.receiptId }
  });
}

async function createViolationFromRule(code: string, data: any) {
  const rule = await prisma.rule.findUnique({ where: { code } });
  if (!rule?.isActive) return null;
  const message = HIGH_RISK_MESSAGES[(rule.condition as any).evaluator] ?? rule.description;
  const violation = await prisma.violation.create({
    data: {
      ruleId: rule.id,
      storeId: data.storeId,
      registerId: data.registerId,
      cameraId: data.cameraId,
      employeeId: data.employeeId,
      sessionId: data.sessionId,
      receiptId: data.receiptId,
      actionId: data.actionId,
      analyticsEventId: data.analyticsEventId,
      speechEventId: data.speechEventId,
      reconciliationId: data.reconciliationId,
      operationType: data.operationType ?? 'SALE',
      violationType: code,
      severity: rule.severity,
      confidence: data.confidence,
      title: rule.name,
      description: message,
      occurredAt: data.occurredAt ?? new Date(),
      status: 'NEW',
      financialRiskAmount: data.financialRiskAmount,
      details: data.details ?? {}
    }
  });
  if (rule.createEmployeeNotification && data.registerId) {
    await prisma.employeeNotification.create({
      data: {
        storeId: data.storeId,
        registerId: data.registerId,
        employeeId: data.employeeId,
        sessionId: data.sessionId,
        receiptId: data.receiptId,
        violationId: violation.id,
        type: code,
        title: rule.name,
        message,
        priority: rule.severity,
        displayMode: NotificationDisplayMode.BANNER
      }
    });
  }
  return violation;
}

async function ingestReceipt(input: z.infer<typeof receiptInput>) {
  const { store, register } = await resolveStoreRegister(input.storeCode, input.registerCode);
  const employee = input.employeeExternalId ? await prisma.employee.findUnique({ where: { externalId: input.employeeExternalId } }) : null;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.receipt.findUnique({ where: { externalId: input.externalId } });
    const version = existing ? existing.version + 1 : 1;
    const session = await findOrCreateSession({ storeId: store.id, registerId: register!.id, correlationId: input.externalId, at: input.openedAt });
    const receipt = await tx.receipt.upsert({
      where: { externalId: input.externalId },
      create: {
        storeId: store.id, registerId: register!.id, employeeId: employee?.id, checkoutSessionId: session.id,
        externalId: input.externalId, receiptNumber: input.receiptNumber, operationType: input.operationType,
        status: input.status, openedAt: input.openedAt, completedAt: input.completedAt, subtotalAmount: input.subtotalAmount,
        discountAmount: input.discountAmount, totalAmount: input.totalAmount, paidAmount: input.paidAmount,
        expectedChangeAmount: input.expectedChangeAmount, actualChangeAmount: input.actualChangeAmount,
        currency: input.currency, paymentMethod: input.paymentMethod, version, metadata: input.metadata,
        items: { create: input.items }
      },
      update: {
        version, status: input.status, completedAt: input.completedAt, paidAmount: input.paidAmount,
        actualChangeAmount: input.actualChangeAmount, metadata: input.metadata
      }
    });
    if (existing) {
      await tx.receiptItem.deleteMany({ where: { receiptId: receipt.id } });
      await tx.receiptItem.createMany({ data: input.items.map((item) => ({ ...item, receiptId: receipt.id })) });
    }
    await tx.receiptVersion.create({ data: { receiptId: receipt.id, version, payload: input } });
    await tx.integrationEvent.create({
      data: { storeId: store.id, registerId: register!.id, receiptId: receipt.id, externalEventId: `receipt:${input.externalId}:v${version}`, source: '1C', eventType: 'RECEIPT', occurredAt: input.completedAt ?? input.openedAt, payload: input }
    });
    await tx.checkoutSession.update({ where: { id: session.id }, data: { receiptId: receipt.id, totalAmount: input.totalAmount, paidAmount: input.paidAmount } });
    return receipt;
  });
}

async function ingestPos(input: z.infer<typeof posInput>) {
  const { store, register } = await resolveStoreRegister(input.storeCode, input.registerCode);
  const existing = await prisma.posOperation.findFirst({ where: { OR: [{ externalEventId: input.externalEventId }, { idempotencyKey: input.idempotencyKey ?? '__none__' }] } });
  if (existing) return existing;
  const session = await findOrCreateSession({ storeId: store.id, registerId: register!.id, correlationId: input.correlationId, at: input.occurredAt });
  return prisma.posOperation.create({
    data: { storeId: store.id, registerId: register!.id, checkoutSessionId: session.id, externalEventId: input.externalEventId, idempotencyKey: input.idempotencyKey, operationType: input.operationType as any, occurredAt: input.occurredAt, correlationId: input.correlationId, productCode: input.productCode, barcode: input.barcode, quantity: input.quantity, amount: input.amount, payload: input.payload }
  });
}

async function ingestVideo(input: z.infer<typeof videoEventInput>) {
  const camera = await prisma.camera.findUnique({ where: { code: input.cameraCode } });
  if (!camera) throw new HttpError(404, 'Camera not found', 'CAMERA_NOT_FOUND');
  const register = input.registerCode ? await prisma.register.findUnique({ where: { storeId_code: { storeId: camera.storeId, code: input.registerCode } } }) : null;
  const existing = await prisma.analyticsEvent.findFirst({ where: { OR: [{ externalEventId: input.externalEventId }, { idempotencyKey: input.idempotencyKey ?? '__none__' }] } });
  if (existing) return existing;
  const session = register ? await findOrCreateSession({ storeId: camera.storeId, registerId: register.id, correlationId: input.correlationId, at: input.occurredAt }) : null;
  const event = await prisma.analyticsEvent.create({
    data: { storeId: camera.storeId, registerId: register?.id, cameraId: camera.id, sessionId: session?.id, externalEventId: input.externalEventId, idempotencyKey: input.idempotencyKey, eventType: input.eventType, source: input.source, mediaType: MediaType.VIDEO, occurredAt: input.occurredAt, confidence: input.confidence, frameTimestampMs: input.frameTimestampMs, trackId: input.trackId, modelName: input.modelName, modelVersion: input.modelVersion, correlationId: input.correlationId, payload: input.payload }
  });
  const detections = Array.isArray((input.payload as any).detections) ? (input.payload as any).detections : [];
  for (const d of detections) {
    await prisma.detection.create({ data: { analyticsEventId: event.id, storeId: camera.storeId, registerId: register?.id, cameraId: camera.id, sessionId: session?.id, detectionType: d.detectionType ?? 'OTHER', className: d.className ?? 'unknown', confidence: d.confidence ?? input.confidence ?? 0, trackId: d.trackId, boundingBox: d.boundingBox, polygon: d.polygon, keypoints: d.keypoints, attributes: d.attributes ?? {}, detectedAt: input.occurredAt } });
  }
  const actionType = register ? await prisma.actionType.findUnique({ where: { code: input.eventType } }) : null;
  const action = actionType
    ? await prisma.cashierAction.create({
        data: {
          storeId: camera.storeId,
          registerId: register!.id,
          cameraId: camera.id,
          sessionId: session?.id,
          actionTypeId: actionType.id,
          startedAt: input.occurredAt,
          confidence: input.confidence,
          status: 'DETECTED',
          mediaType: 'VIDEO',
          source: input.source,
          correlationId: input.correlationId,
          details: {
            analyticsEventId: event.id,
            eventType: input.eventType,
            payload: input.payload
          }
        }
      })
    : null;
  if (action) {
    await prisma.actionEventLink.create({ data: { actionId: action.id, analyticsEventId: event.id } });
  }
  const violationRuleCode = videoViolationRules[input.eventType];
  if (violationRuleCode) {
    await createViolationFromRule(violationRuleCode, {
      storeId: camera.storeId,
      registerId: register?.id,
      cameraId: camera.id,
      sessionId: session?.id,
      actionId: action?.id,
      analyticsEventId: event.id,
      confidence: input.confidence,
      occurredAt: input.occurredAt
    });
  }
  return event;
}

async function ingestAudio(input: z.infer<typeof audioEventInput>) {
  const event = await ingestVideo({ ...input, source: input.source ?? 'speech', payload: input.payload });
  const profanity = detectProfanity(input.text);
  const speech = await prisma.speechEvent.create({
    data: {
      analyticsEventId: event.id,
      storeId: event.storeId,
      registerId: event.registerId,
      cameraId: event.cameraId!,
      sessionId: event.sessionId,
      externalEventId: input.externalEventId,
      idempotencyKey: input.idempotencyKey,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      speakerType: input.speakerType,
      language: input.language,
      text: input.text,
      normalizedText: profanity.normalizedText,
      confidence: input.confidence,
      words: input.words,
      phrases: profanity.detected ? ['PROFANITY_DETECTED'] : [],
      audioSource: input.audioSource,
      correlationId: input.correlationId,
      metadata: {
        ...input.metadata,
        profanity: profanity.detected
          ? {
              detected: true,
              matches: profanity.matches
            }
          : undefined
      }
    }
  });
  if (profanity.detected && input.speakerType === 'CASHIER') {
    const actionType = await prisma.actionType.findUnique({ where: { code: 'PROFANITY_DETECTED' } });
    const action = actionType
      ? await prisma.cashierAction.create({
          data: {
            storeId: event.storeId,
            registerId: event.registerId!,
            cameraId: event.cameraId,
            sessionId: event.sessionId,
            receiptId: event.receiptId,
            shiftId: event.shiftId,
            employeeId: event.employeeId,
            actionTypeId: actionType.id,
            startedAt: input.startedAt,
            endedAt: input.endedAt,
            confidence: input.confidence,
            status: 'NEEDS_REVIEW',
            mediaType: 'AUDIO',
            source: input.source,
            correlationId: input.correlationId,
            details: {
              speechEventId: speech.id,
              normalizedText: profanity.normalizedText,
              matches: profanity.matches
            }
          }
        })
      : null;
    if (action) {
      await prisma.actionSpeechEventLink.create({ data: { actionId: action.id, speechEventId: speech.id } });
    }
    await createViolationFromRule('profanity-detected', {
      storeId: event.storeId,
      registerId: event.registerId,
      cameraId: event.cameraId,
      sessionId: event.sessionId,
      receiptId: event.receiptId,
      employeeId: event.employeeId,
      shiftId: event.shiftId,
      speechEventId: speech.id,
      analyticsEventId: event.id,
      actionId: action?.id,
      operationType: 'SERVICE',
      confidence: input.confidence,
      occurredAt: input.startedAt,
      details: {
        normalizedText: profanity.normalizedText,
        matches: profanity.matches
      }
    });
  }
  return speech;
}

export function registerIngestionRoutes(app: FastifyInstance) {
  app.post('/api/v1/integrations/receipts', async (request) => { requireApiPermission(request, 'integrations:write'); return ingestReceipt(receiptInput.parse(request.body)); });
  app.post('/api/v1/integrations/receipts/batch', async (request) => { requireApiPermission(request, 'integrations:write'); return { data: await Promise.all(batch(receiptInput).parse(request.body).records.map(ingestReceipt)) }; });
  app.post('/api/v1/integrations/pos-events', async (request) => { requireApiPermission(request, 'integrations:write'); return ingestPos(posInput.parse(request.body)); });
  app.post('/api/v1/integrations/pos-events/batch', async (request) => { requireApiPermission(request, 'integrations:write'); return { data: await Promise.all(batch(posInput).parse(request.body).records.map(ingestPos)) }; });
  app.post('/api/v1/analytics/video/events', async (request) => { requireApiPermission(request, 'analytics:write'); return ingestVideo(videoEventInput.parse(request.body)); });
  app.post('/api/v1/analytics/video/events/batch', async (request) => { requireApiPermission(request, 'analytics:write'); return { data: await Promise.all(batch(videoEventInput).parse(request.body).records.map(ingestVideo)) }; });
  app.post('/api/v1/analytics/audio/events', async (request) => { requireApiPermission(request, 'analytics:write'); return ingestAudio(audioEventInput.parse(request.body)); });
  app.post('/api/v1/analytics/audio/events/batch', async (request) => { requireApiPermission(request, 'analytics:write'); return { data: await Promise.all(batch(audioEventInput).parse(request.body).records.map(ingestAudio)) }; });
  app.post('/api/v1/analytics/audio/classifications', async (request) => { requireApiPermission(request, 'analytics:write'); return ingestVideo(videoEventInput.parse(request.body)); });
}
