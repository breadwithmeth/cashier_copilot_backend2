import 'dotenv/config';
import { PrismaClient, Severity } from '@prisma/client';

const prisma = new PrismaClient();

const actionCodes = [
  'CUSTOMER_WAITING_TOO_LONG',
  'CASHIER_ABSENT_DURING_SERVICE',
  'OBJECT_LEFT_IN_SCAN_ZONE',
  'NO_PAYMENT_OR_RECEIPT_SPEECH',
  'NO_FAREWELL'
];

const rules = [
  ['customer-waiting-too-long', 'Customer waiting too long', 'CUSTOMER_WAITING_TOO_LONG', 'customer_waiting_too_long'],
  ['cashier-absent-during-service', 'Cashier absent during service', 'CASHIER_ABSENT_DURING_SERVICE', 'cashier_absent_during_service'],
  ['object-left-in-scan-zone', 'Object left in scan zone', 'OBJECT_LEFT_IN_SCAN_ZONE', 'object_left_in_scan_zone'],
  ['payment-or-receipt-speech-missing', 'Payment or receipt speech missing', 'NO_PAYMENT_OR_RECEIPT_SPEECH', 'payment_or_receipt_speech_missing']
];

async function main() {
  for (const code of actionCodes) {
    await prisma.actionType.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name: code.replaceAll('_', ' '),
        category: code.split('_')[0],
        description: code.replaceAll('_', ' '),
        defaultSeverity: Severity.LOW
      }
    });
  }

  for (const [code, name, triggerCode, evaluator] of rules) {
    await prisma.rule.upsert({
      where: { code },
      update: {
        triggerCode,
        condition: { evaluator },
        severity: Severity.MEDIUM,
        createEmployeeNotification: true,
        isActive: true
      },
      create: {
        code,
        name,
        description: name,
        domain: 'SERVICE',
        triggerType: 'ACTION',
        triggerCode,
        condition: { evaluator },
        severity: Severity.MEDIUM,
        createEmployeeNotification: true,
        createManagerAlert: false,
        requireEvidence: false
      }
    });
  }

  await prisma.rule.upsert({
    where: { code: 'farewell-missing' },
    update: {
      triggerCode: 'NO_FAREWELL',
      condition: { evaluator: 'speech_absence' },
      isActive: true
    },
    create: {
      code: 'farewell-missing',
      name: 'Farewell missing',
      description: 'Farewell missing',
      domain: 'SERVICE',
      triggerType: 'ACTION',
      triggerCode: 'NO_FAREWELL',
      condition: { evaluator: 'speech_absence' },
      severity: Severity.LOW,
      createEmployeeNotification: false,
      createManagerAlert: false,
      requireEvidence: false
    }
  });

  console.log(`Upserted ${actionCodes.length} action types and ${rules.length + 1} rules.`);
}

main().finally(() => prisma.$disconnect());
