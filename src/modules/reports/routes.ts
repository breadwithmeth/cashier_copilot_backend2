import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../common/services/prisma.js';
import { requireUser } from '../../common/guards/access.js';

const generateSchema = z.object({
  type: z.enum(['daily_violation', 'weekly_employee', 'weekly_store', 'weekly_receiving', 'monthly_service_standard', 'receiving', 'service_standard']),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf-ready']).default('json'),
  filters: z.record(z.any()).default({})
});

export function registerReportRoutes(app: FastifyInstance) {
  app.post('/api/v1/reports/generate', async (request) => {
    const user = requireUser(request);
    const input = generateSchema.parse(request.body);
    const [violations, service, receiving] = await Promise.all([
      prisma.violation.groupBy({ by: ['severity', 'violationType'], _count: true, _sum: { financialRiskAmount: true } }),
      prisma.serviceEvaluation.aggregate({ _avg: { percentage: true }, _count: true }),
      prisma.receivingSession.groupBy({ by: ['status'], _count: true })
    ]);
    const report = await prisma.report.create({
      data: {
        type: input.type,
        format: input.format,
        filters: input.filters,
        status: 'READY',
        createdByUserId: user.id,
        result: { violations, service, receiving, generatedAt: new Date().toISOString() }
      }
    });
    return report;
  });

  app.get('/api/v1/reports/:id/download', async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const report = await prisma.report.findUnique({ where: { id } });
    await prisma.auditLog.create({ data: { userId: user.id, action: 'REPORT_DOWNLOAD', entityType: 'Report', entityId: id } });
    return report;
  });
}
