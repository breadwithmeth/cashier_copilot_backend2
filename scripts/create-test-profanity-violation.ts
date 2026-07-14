import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.findUnique({ where: { code: 'tolstogo-90' } });
  if (!store) throw new Error('Store tolstogo-90 not found');

  const register = await prisma.register.findUnique({
    where: { storeId_code: { storeId: store.id, code: 'register-1' } }
  });
  if (!register) throw new Error('Register register-1 not found');

  const camera = await prisma.camera.findUnique({ where: { code: 'cam10' } });
  if (!camera) throw new Error('Camera cam10 not found');

  const rule = await prisma.rule.findUnique({ where: { code: 'profanity-detected' } });
  if (!rule) throw new Error('Rule profanity-detected not found. Run npx prisma db seed first.');

  const actionType = await prisma.actionType.findUnique({ where: { code: 'PROFANITY_DETECTED' } });
  if (!actionType) throw new Error('ActionType PROFANITY_DETECTED not found. Run npx prisma db seed first.');

  const employee = await prisma.employee.findUnique({ where: { externalId: 'employee-45' } });
  const now = new Date();
  const suffix = now.toISOString().replace(/[:.]/g, '-');
  const correlationId = `test-profanity-tolstogo-${suffix}`;
  const text = 'Тестовое нарушение: кассир сказал блять при обслуживании.';

  const session = await prisma.checkoutSession.create({
    data: {
      storeId: store.id,
      registerId: register.id,
      cameraId: camera.id,
      employeeId: employee?.id,
      correlationId,
      startedAt: now,
      lastActivityAt: now,
      status: 'NEEDS_REVIEW',
      confidence: 0.99,
      metadata: { test: true, reason: 'manual profanity test' }
    }
  });

  const analyticsEvent = await prisma.analyticsEvent.create({
    data: {
      storeId: store.id,
      registerId: register.id,
      cameraId: camera.id,
      sessionId: session.id,
      employeeId: employee?.id,
      externalEventId: `test-profanity-audio-event-${suffix}`,
      idempotencyKey: `test-profanity-audio-event-${suffix}`,
      eventType: 'SPEECH_RECOGNIZED',
      source: 'manual-test',
      mediaType: 'AUDIO',
      occurredAt: now,
      confidence: 0.99,
      correlationId,
      payload: { test: true }
    }
  });

  const speechEvent = await prisma.speechEvent.create({
    data: {
      analyticsEventId: analyticsEvent.id,
      storeId: store.id,
      registerId: register.id,
      cameraId: camera.id,
      sessionId: session.id,
      employeeId: employee?.id,
      externalEventId: `test-profanity-speech-${suffix}`,
      idempotencyKey: `test-profanity-speech-${suffix}`,
      startedAt: now,
      endedAt: new Date(now.getTime() + 2500),
      speakerType: 'CASHIER',
      language: 'ru',
      text,
      normalizedText: text.toLowerCase(),
      confidence: 0.99,
      words: [],
      phrases: ['PROFANITY_DETECTED'],
      audioSource: 'EXTERNAL_MICROPHONE_RTSP',
      correlationId,
      metadata: {
        test: true,
        profanity: {
          detected: true,
          matches: ['блять']
        }
      }
    }
  });

  const action = await prisma.cashierAction.create({
    data: {
      storeId: store.id,
      registerId: register.id,
      cameraId: camera.id,
      sessionId: session.id,
      employeeId: employee?.id,
      actionTypeId: actionType.id,
      startedAt: now,
      endedAt: new Date(now.getTime() + 2500),
      confidence: 0.99,
      status: 'NEEDS_REVIEW',
      mediaType: 'AUDIO',
      source: 'manual-test',
      correlationId,
      details: {
        test: true,
        speechEventId: speechEvent.id,
        matches: ['блять']
      }
    }
  });

  await prisma.actionSpeechEventLink.create({
    data: { actionId: action.id, speechEventId: speechEvent.id }
  });

  const violation = await prisma.violation.create({
    data: {
      ruleId: rule.id,
      storeId: store.id,
      registerId: register.id,
      cameraId: camera.id,
      employeeId: employee?.id,
      sessionId: session.id,
      actionId: action.id,
      analyticsEventId: analyticsEvent.id,
      speechEventId: speechEvent.id,
      operationType: 'SERVICE',
      violationType: 'profanity-detected',
      severity: rule.severity,
      confidence: 0.99,
      title: rule.name,
      description: 'Тестовое нарушение: в речи кассира обнаружена запрещенная лексика.',
      occurredAt: now,
      status: 'NEW',
      details: {
        test: true,
        text,
        matches: ['блять']
      }
    }
  });

  const notification = await prisma.employeeNotification.create({
    data: {
      storeId: store.id,
      registerId: register.id,
      employeeId: employee?.id,
      sessionId: session.id,
      violationId: violation.id,
      type: 'profanity-detected',
      title: 'В речи кассира обнаружен мат',
      message: 'Проверьте обслуживание: в транскрипте кассира найдена запрещенная лексика.',
      priority: rule.severity,
      displayMode: 'BANNER',
      status: 'PENDING',
      metadata: { test: true }
    }
  });

  console.log(
    JSON.stringify(
      {
        storeCode: store.code,
        registerCode: register.code,
        sessionId: session.id,
        speechEventId: speechEvent.id,
        actionId: action.id,
        violationId: violation.id,
        notificationId: notification.id
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
