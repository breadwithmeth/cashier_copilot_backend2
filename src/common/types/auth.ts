import type { UserRole } from '@prisma/client';

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  storeIds: string[];
  cities: string[];
};

declare module 'fastify' {
  interface FastifyRequest {
    userContext?: AuthUser;
    apiKeyContext?: {
      id: string;
      serviceType: string;
      permissions: string[];
      allowedStoreIds: string[];
      allowedRegisterIds: string[];
      allowedCameraIds: string[];
    };
  }
}
