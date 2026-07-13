import type { FastifyInstance } from 'fastify';
import { prisma } from '../../common/services/prisma.js';
import { requireUser } from '../../common/guards/access.js';

export function registerDashboardRoutes(app: FastifyInstance) {
  const paths = ['summary', 'sales-risk', 'service-quality', 'receiving', 'camera-health', 'integration-health', 'employees', 'stores', 'registers', 'violations-trend'];
  for (const path of paths) {
    app.get(`/api/v1/dashboard/${path}`, async (request) => {
      requireUser(request);
      const [receipts, violations, highRisk, financial, cameras, errors] = await Promise.all([
        prisma.receipt.count(),
        prisma.violation.count(),
        prisma.violation.count({ where: { severity: { in: ['HIGH', 'CRITICAL'] } } }),
        prisma.violation.aggregate({ _sum: { financialRiskAmount: true } }),
        prisma.camera.groupBy({ by: ['videoStatus', 'audioStatus'], _count: true }),
        prisma.integrationError.count({ where: { status: { in: ['OPEN', 'RETRYING', 'FAILED'] } } })
      ]);
      return {
        scope: path,
        totalReceipts: receipts,
        totalViolations: violations,
        highRiskViolations: highRisk,
        totalPossibleFinancialRiskAmount: financial._sum.financialRiskAmount ?? 0,
        cameraAvailability: cameras,
        integrationErrors: errors
      };
    });
  }
}
