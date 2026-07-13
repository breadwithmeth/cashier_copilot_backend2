import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { paginationSchema } from '../schemas/pagination.js';
import { HttpError } from '../errors/http-error.js';
import { canAccessStore, requireUser } from '../guards/access.js';

type ModelName = keyof {
  [K in keyof PrismaClient as PrismaClient[K] extends { findMany: any } ? K : never]: true;
};

export type CrudConfig = {
  route: string;
  model: ModelName;
  searchFields?: string[];
  storeScoped?: boolean;
  createSchema?: z.ZodTypeAny;
  updateSchema?: z.ZodTypeAny;
  sanitize?: (row: any, request: FastifyRequest) => any;
};

const idParams = z.object({ id: z.string() });

export function registerCrudRoutes(app: FastifyInstance, prisma: PrismaClient, config: CrudConfig) {
  const model = prisma[config.model] as any;

  app.get(config.route, async (request) => {
    requireUser(request);
    const query = paginationSchema.parse(request.query);
    const where: any = {};
    for (const key of ['storeId', 'registerId', 'cameraId', 'employeeId', 'shiftId', 'sessionId', 'receiptId', 'status', 'severity']) {
      if ((query as any)[key]) where[key] = (query as any)[key];
    }
    if (query.createdFrom || query.createdTo) {
      where.createdAt = {
        gte: query.createdFrom,
        lte: query.createdTo
      };
    }
    if (query.search && config.searchFields?.length) {
      where.OR = config.searchFields.map((field) => ({ [field]: { contains: query.search, mode: 'insensitive' } }));
    }
    if (config.storeScoped && query.storeId) canAccessStore(request, query.storeId);
    const [items, total] = await Promise.all([
      model.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit
      }),
      model.count({ where })
    ]);
    return { data: items.map((item: any) => config.sanitize?.(item, request) ?? item), pagination: { page: query.page, limit: query.limit, total } };
  });

  app.get(`${config.route}/:id`, async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);
    const row = await model.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, 'Record not found', 'NOT_FOUND');
    if (config.storeScoped) canAccessStore(request, row.storeId);
    return config.sanitize?.(row, request) ?? row;
  });

  app.post(config.route, async (request) => {
    requireUser(request);
    const data = config.createSchema ? config.createSchema.parse(request.body) : request.body;
    if (config.storeScoped) canAccessStore(request, (data as any).storeId);
    return model.create({ data });
  });

  app.patch(`${config.route}/:id`, async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);
    const data = config.updateSchema ? config.updateSchema.parse(request.body) : request.body;
    const existing = await model.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Record not found', 'NOT_FOUND');
    if (config.storeScoped) canAccessStore(request, existing.storeId);
    return model.update({ where: { id }, data });
  });
}
