import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  city: z.string().optional(),
  storeId: z.string().optional(),
  registerId: z.string().optional(),
  cameraId: z.string().optional(),
  employeeId: z.string().optional(),
  shiftId: z.string().optional(),
  sessionId: z.string().optional(),
  receiptId: z.string().optional(),
  receiptNumber: z.string().optional(),
  operationType: z.string().optional(),
  status: z.string().optional(),
  severity: z.string().optional(),
  eventType: z.string().optional(),
  violationType: z.string().optional(),
  mediaType: z.string().optional(),
  source: z.string().optional(),
  supplierId: z.string().optional(),
  evidenceStatus: z.string().optional()
});

export type PaginationQuery = z.infer<typeof paginationSchema>;
