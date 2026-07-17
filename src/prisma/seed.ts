import { PrismaClient, Severity } from '@prisma/client';
import { env } from '../config/env.js';
import { hashApiKey, hashPassword } from '../common/utils/security.js';

const prisma = new PrismaClient();

const actionCodes = [
  'CUSTOMER_ENTERED','CUSTOMER_LEFT','CUSTOMER_WAITING','CUSTOMER_WAITING_TOO_LONG','CASHIER_PRESENT','CASHIER_ABSENT','CASHIER_ABSENT_DURING_SERVICE','GREETING_DETECTED','NEED_IDENTIFICATION_DETECTED','CONSULTATION_DETECTED','UPSELL_DETECTED','CASH_SCRIPT_DETECTED','PURCHASE_AMOUNT_ANNOUNCED','CHANGE_AMOUNT_ANNOUNCED','GOODBYE_DETECTED','NO_FAREWELL','NO_PAYMENT_OR_RECEIPT_SPEECH','INCORRECT_TONE_DETECTED','PROFANITY_DETECTED','PHONE_DISTRACTION_DETECTED','PRODUCT_PICKED','PRODUCT_MOVED_TO_CUSTOMER','PRODUCT_TRANSFERRED','PRODUCT_NOT_SCANNED','SCANNER_PRESENTED','SCANNER_BEEP_DETECTED','SCAN_SIMULATION_SUSPECTED','PRODUCT_REMOVED_FROM_RECEIPT','CONTAINER_USED','CONTAINER_TRANSFERRED','CONTAINER_SCANNED','CONTAINER_NOT_SCANNED','OBJECT_LEFT_IN_SCAN_ZONE','PAYMENT_STARTED','CASH_PAYMENT_DETECTED','CARD_PAYMENT_DETECTED','QR_PAYMENT_DETECTED','MONEY_RECEIVED','CHANGE_GIVEN','PAYMENT_METHOD_MISMATCH','PAYMENT_AMOUNT_MISMATCH','RECEIPT_PRINTED','RECEIPT_GIVEN','RECEIPT_PLACED_IN_BAG','RECEIPT_NOT_GIVEN','BUSINESS_CARD_GIVEN','BUSINESS_CARD_NOT_GIVEN','AGE_DOCUMENT_REQUESTED','AGE_DOCUMENT_SHOWN','RETURN_DETECTED','VOID_DETECTED','PRODUCT_TRANSFER_DURING_RETURN','PRODUCT_TRANSFER_DURING_VOID','RECEIVING_STARTED','INVOICE_CHECKED','PRODUCT_COUNT_STARTED','PRODUCT_COUNT_COMPLETED','EXPIRATION_DATE_CHECKED','PACKAGE_INTEGRITY_CHECKED','DAMAGED_PRODUCT_SEPARATED','RECEIVING_DIFFERENCE_RECORDED','PRODUCT_MOVED_WITHOUT_COUNT','RECEIVING_COMPLETED'
];

const rules = [
  ['product-transferred-not-scanned','Product transferred but not scanned','transferred_item_missing_in_receipt','HIGH','SALES'],
  ['scanner-without-pos-scan','Scanner interaction without POS scan','scanner_without_pos_event','HIGH','SALES'],
  ['container-transferred-not-scanned','Container transferred but not scanned','container_missing_in_receipt','MEDIUM','SALES'],
  ['receipt-not-given','Receipt not given','required_action','MEDIUM','SERVICE'],
  ['business-card-not-given','Business card not given','required_action','MEDIUM','SERVICE'],
  ['payment-method-mismatch','Payment method mismatch','payment_method_mismatch','HIGH','PAYMENT'],
  ['payment-amount-mismatch','Payment amount mismatch','payment_amount_mismatch','HIGH','PAYMENT'],
  ['incorrect-change','Incorrect change','change_amount_mismatch','HIGH','PAYMENT'],
  ['purchase-amount-not-announced','Purchase amount not announced','required_phrase','MEDIUM','SERVICE'],
  ['change-not-announced','Change not announced','required_phrase','MEDIUM','SERVICE'],
  ['customer-waiting-too-long','Customer waiting too long','customer_waiting_too_long','MEDIUM','SERVICE'],
  ['cashier-absent-during-service','Cashier absent during service','cashier_absent_during_service','MEDIUM','SERVICE'],
  ['object-left-in-scan-zone','Object left in scan zone','object_left_in_scan_zone','MEDIUM','SERVICE'],
  ['payment-or-receipt-speech-missing','Payment or receipt speech missing','payment_or_receipt_speech_missing','MEDIUM','SERVICE'],
  ['greeting-missing','Greeting missing','speech_absence','LOW','SERVICE'],
  ['upsell-missing','Upsell missing','required_action','LOW','SERVICE'],
  ['farewell-missing','Farewell missing','speech_absence','LOW','SERVICE'],
  ['product-transfer-during-return','Product transferred during return','return_with_product_transfer','HIGH','SALES'],
  ['product-transfer-during-void','Product transferred during void','void_with_product_transfer','HIGH','SALES'],
  ['phone-distraction','Employee distracted by phone','forbidden_action','LOW','SERVICE'],
  ['profanity-detected','Profanity detected in cashier speech','forbidden_phrase','MEDIUM','SERVICE'],
  ['receiving-without-counting','Receiving without counting','receiving_count_missing','HIGH','RECEIVING'],
  ['receiving-quantity-mismatch','Receiving quantity mismatch','receiving_quantity_mismatch','HIGH','RECEIVING'],
  ['expiration-not-checked','Expiration date not checked','expiration_check_missing','MEDIUM','RECEIVING'],
  ['package-integrity-not-checked','Packaging integrity not checked','package_check_missing','MEDIUM','RECEIVING'],
  ['damaged-product-not-separated','Damaged product not separated','damaged_product_not_separated','MEDIUM','RECEIVING'],
  ['receiving-discrepancy-not-recorded','Receiving discrepancy not recorded','receiving_difference_not_recorded','MEDIUM','RECEIVING'],
  ['receiving-too-fast','Receiving completed too fast','receiving_too_fast','LOW','RECEIVING'],
  ['video-stream-offline','Video stream offline','video_offline','HIGH','CAMERA_HEALTH'],
  ['audio-stream-offline','Audio stream offline','audio_offline','MEDIUM','CAMERA_HEALTH'],
  ['receipt-delayed','Receipt delayed','integration_event_missing','MEDIUM','INTEGRATION'],
  ['evidence-unavailable','Evidence unavailable','evidence_unavailable','MEDIUM','INTEGRATION']
] as const;

async function main() {
  if (!env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD is required when running prisma seed');
  }
  const store = await prisma.store.upsert({
    where: { code: 'tolstogo-90' },
    update: {},
    create: { name: 'Tolstogo 90', code: 'tolstogo-90', address: 'Tolstogo 90', city: 'Almaty' }
  });
  const register = await prisma.register.upsert({
    where: { storeId_code: { storeId: store.id, code: 'register-1' } },
    update: {},
    create: { storeId: store.id, name: 'Register 1', code: 'register-1', registerNumber: 1, workstationId: 'workstation-1' }
  });
  await prisma.camera.upsert({
    where: { code: 'cam10' },
    update: {},
    create: { storeId: store.id, registerId: register.id, name: 'Checkout camera', code: 'cam10', locationType: 'CHECKOUT', videoRtspUrl: 'rtsp://video:pass@camera/video', audioRtspUrl: 'rtsp://audio:pass@mic/audio', audioEnabled: true }
  });
  await prisma.camera.upsert({
    where: { code: 'receiving-cam1' },
    update: {},
    create: { storeId: store.id, name: 'Receiving camera', code: 'receiving-cam1', locationType: 'RECEIVING_AREA', videoRtspUrl: 'rtsp://video:pass@camera/receiving', audioEnabled: false }
  });
  const callCenter = await prisma.store.upsert({
    where: { code: 'cc-almaty-01' },
    update: {},
    create: {
      type: 'CALL_CENTER',
      name: 'Call Center Almaty',
      code: 'cc-almaty-01',
      address: 'Almaty, Tole bi 59',
      city: 'Almaty'
    }
  });
  await prisma.camera.upsert({
    where: { code: 'cc-cam-01' },
    update: {},
    create: {
      storeId: callCenter.id,
      name: 'Agent Desk 1',
      code: 'cc-cam-01',
      locationType: 'CALL_CENTER_FLOOR',
      videoRtspUrl: 'rtsp://localhost:8554/cc-agent-1',
      audioEnabled: true,
      audioRtspUrl: 'rtsp://localhost:8554/cc-agent-1-audio'
    }
  });
  const employee = await prisma.employee.upsert({
    where: { externalId: 'employee-45' },
    update: {},
    create: { storeId: store.id, externalId: 'employee-45', employeeNumber: '45', firstName: 'Aigerim', lastName: 'Cashier', position: 'Cashier' }
  });
  await prisma.shift.create({ data: { storeId: store.id, registerId: register.id, employeeId: employee.id, startedAt: new Date(), status: 'ACTIVE' } });
  await prisma.$transaction(async (tx) => {
    await tx.auditLog.updateMany({ where: { userId: { not: null } }, data: { userId: null } });
    await tx.userStoreAccess.deleteMany({});
    await tx.userCityAccess.deleteMany({});
    await tx.user.deleteMany({});
  });
  const admin = await prisma.user.create({
    data: {
      email: env.ADMIN_EMAIL,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      firstName: 'Admin',
      lastName: 'Gradusy24',
      role: 'ADMIN',
      isActive: true
    }
  });
  await prisma.userStoreAccess.create({ data: { userId: admin.id, storeId: store.id } });
  for (const code of actionCodes) {
    await prisma.actionType.upsert({ where: { code }, update: {}, create: { code, name: code.replaceAll('_', ' '), category: code.split('_')[0], description: code.replaceAll('_', ' '), defaultSeverity: Severity.LOW } });
  }
  for (const [code, name, evaluator, severity, domain] of rules) {
    await prisma.rule.upsert({
      where: { code },
      update: {},
      create: { code, name, description: name, domain: domain as any, triggerType: 'ACTION', triggerCode: code, condition: { evaluator }, severity: severity as any, createEmployeeNotification: ['HIGH','MEDIUM'].includes(severity), createManagerAlert: severity === 'HIGH', requireEvidence: severity === 'HIGH' }
    });
  }
  const standard = await prisma.serviceStandard.upsert({ where: { id: 'default-service-standard' }, update: {}, create: { id: 'default-service-standard', name: 'Default checkout standard', description: 'Greeting, consultation, payment, receipt, farewell' } });
  await prisma.serviceStandardCriterion.createMany({
    data: ['GREETING_DETECTED','UPSELL_DETECTED','PURCHASE_AMOUNT_ANNOUNCED','RECEIPT_GIVEN','GOODBYE_DETECTED'].map((code, index) => ({ serviceStandardId: standard.id, name: code, code, description: code, category: 'CONTACT', weight: 1, sourceType: 'ACTION', actionTypeCode: code, sortOrder: index })),
    skipDuplicates: true
  });
  for (const [name, serviceType, permissions, serviceKey] of [
    ['Analytics service', 'ANALYTICS_SERVICE', ['analytics:write'], env.ANALYTICS_API_KEY],
    ['Integration service', 'INTEGRATION_SERVICE', ['integrations:write'], env.INTEGRATION_API_KEY]
  ] as const) {
    const raw = serviceKey;
    const keyPrefix = raw.split('_').slice(0, 2).join('_');
    await prisma.apiKey.upsert({
      where: { keyPrefix },
      update: {
        name,
        serviceType,
        keyHash: hashApiKey(raw),
        permissions: [...permissions],
        allowedStoreIds: [store.id, callCenter.id],
        allowedRegisterIds: [register.id],
        allowedCameraIds: [],
        isActive: true
      },
      create: { name, serviceType, keyPrefix, keyHash: hashApiKey(raw), permissions: [...permissions], allowedStoreIds: [store.id, callCenter.id], allowedRegisterIds: [register.id], allowedCameraIds: [] }
    });
    console.log(`${name} API key loaded from env: ${keyPrefix}_***`);
  }
  console.log(`Seeded admin user: ${env.ADMIN_EMAIL}`);
}

main().finally(() => prisma.$disconnect());
