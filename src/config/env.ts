import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  API_KEY_PEPPER: z.string().min(8),
  RTSP_ENCRYPTION_KEY: z.string().min(8),
  RTSP_CREDENTIALS_ENCRYPTION_ENABLED: z.coerce.boolean().default(true),
  AUDIO_VIDEO_CORRELATION_TOLERANCE_MS: z.coerce.number().default(3000),
  RECEIPT_VIDEO_CORRELATION_TOLERANCE_SECONDS: z.coerce.number().default(30),
  SESSION_INACTIVITY_TIMEOUT_SECONDS: z.coerce.number().default(30),
  CAMERA_HEALTH_CHECK_INTERVAL_SECONDS: z.coerce.number().default(30),
  VIDEO_OFFLINE_AFTER_SECONDS: z.coerce.number().default(20),
  AUDIO_OFFLINE_AFTER_SECONDS: z.coerce.number().default(20),
  SCHEDULED_TASK_POLL_INTERVAL_MS: z.coerce.number().default(1000),
  SCHEDULED_TASK_BATCH_SIZE: z.coerce.number().default(50),
  SCHEDULED_TASK_MAX_ATTEMPTS: z.coerce.number().default(5),
  EVIDENCE_SECONDS_BEFORE: z.coerce.number().default(10),
  EVIDENCE_SECONDS_AFTER: z.coerce.number().default(10),
  RAW_ANALYTICS_RETENTION_DAYS: z.coerce.number().default(90),
  EVIDENCE_RETENTION_DAYS: z.coerce.number().default(180),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().default(365),
  INTEGRATION_ERROR_RETENTION_DAYS: z.coerce.number().default(180),
  ANALYTICS_WORKER_BASE_URL: z.string().url(),
  ANALYTICS_WORKER_API_KEY: z.string(),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('')
});

export const env = schema.parse(process.env);
export type Env = typeof env;
