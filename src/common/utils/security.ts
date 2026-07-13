import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { env } from '../../config/env.js';

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export const hashApiKey = (key: string) =>
  crypto.createHmac('sha256', env.API_KEY_PEPPER).update(key).digest('hex');

export function createRawApiKey(prefix = 'ck') {
  const secret = nanoid(40);
  return `${prefix}_${secret}`;
}

export function maskRtsp(url?: string | null) {
  if (!url) return url;
  return url.replace(/(rtsp:\/\/)([^:@/]+):([^@/]+)@/i, '$1$2:***@');
}

export function omitSensitive<T extends Record<string, any>>(value: T) {
  const { passwordHash: _passwordHash, refreshTokenHash: _refreshTokenHash, ...rest } = value;
  return rest;
}
