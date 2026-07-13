import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError } from '../errors/http-error.js';
import { env } from '../../config/env.js';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Invalid request', details: error.flatten() });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return reply.status(409).send({ error: 'DATABASE_CONSTRAINT', message: 'Request conflicts with existing data' });
    }
    return reply.status(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      stack: env.NODE_ENV === 'production' ? undefined : error.stack
    });
  });
}
