import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../../common/services/prisma.js';
import { canAccessStore, requireApiPermission, requireRoles, requireUser } from '../../common/guards/access.js';
import { HttpError } from '../../common/errors/http-error.js';

const legacyUploadRoot = path.resolve(process.cwd(), 'uploads', 'camera-reference-images');

const pointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1)
});

const polygonSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  points: z.array(pointSchema).min(3),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.any()).default({})
});

const roiUpdateSchema = z.object({
  image: z
    .object({
      id: z.string().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      capturedAt: z.coerce.date().optional()
    })
    .optional(),
  cashierRoi: z.array(polygonSchema).default([]),
  scanRoi: z.array(polygonSchema).default([]),
  customerRoi: z.array(polygonSchema).default([])
});

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  throw new HttpError(400, 'Only jpeg, png and webp images are supported', 'UNSUPPORTED_IMAGE_TYPE');
}

function publicImageMetadata(camera: { id: string; analyticsConfiguration: unknown }) {
  const config = (camera.analyticsConfiguration ?? {}) as Record<string, any>;
  return config.roiReferenceImage ?? null;
}

async function readFileBuffer(file: Awaited<ReturnType<FastifyRequest['file']>>) {
  if (!file) throw new HttpError(400, 'Multipart image file is required', 'IMAGE_REQUIRED');
  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readLegacyImageBlob(cameraId: string, image: Record<string, any>) {
  if (!image.storageKey) return null;
  try {
    const imageData = await readFile(path.join(legacyUploadRoot, image.storageKey));
    await prisma.camera.update({
      where: { id: cameraId },
      data: {
        roiReferenceImageData: imageData,
        roiReferenceImageMime: image.mimeType,
        roiReferenceImageName: image.filename
      }
    });
    return imageData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function findCameraById(id: string) {
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) throw new HttpError(404, 'Camera not found', 'CAMERA_NOT_FOUND');
  return camera;
}

async function findCameraByCode(code: string) {
  const camera = await prisma.camera.findUnique({ where: { code } });
  if (!camera) throw new HttpError(404, 'Camera not found', 'CAMERA_NOT_FOUND');
  return camera;
}

export function registerCameraRoiRoutes(app: FastifyInstance) {
  app.get('/api/v1/analytics/cameras/:cameraCode/rois', async (request) => {
    requireApiPermission(request, 'analytics:write');
    const { cameraCode } = z.object({ cameraCode: z.string() }).parse(request.params);
    const camera = await findCameraByCode(cameraCode);
    const apiKey = request.apiKeyContext;
    if (apiKey?.allowedCameraIds.length && !apiKey.allowedCameraIds.includes(camera.id)) {
      throw new HttpError(403, 'API key camera access denied', 'CAMERA_ACCESS_DENIED');
    }
    if (apiKey?.allowedStoreIds.length && !apiKey.allowedStoreIds.includes(camera.storeId)) {
      throw new HttpError(403, 'API key store access denied', 'STORE_ACCESS_DENIED');
    }
    const [store, register] = await Promise.all([
      prisma.store.findUnique({ where: { id: camera.storeId }, select: { id: true, code: true, name: true, city: true } }),
      camera.registerId
        ? prisma.register.findUnique({ where: { id: camera.registerId }, select: { id: true, code: true, name: true, registerNumber: true } })
        : null
    ]);
    return {
      camera: {
        id: camera.id,
        code: camera.code,
        name: camera.name,
        locationType: camera.locationType,
        videoEnabled: camera.videoEnabled,
        audioEnabled: camera.audioEnabled,
        configuredVideoFps: camera.configuredVideoFps,
        videoStatus: camera.videoStatus,
        audioStatus: camera.audioStatus,
        overallStatus: camera.overallStatus
      },
      store,
      register,
      referenceImage: publicImageMetadata(camera),
      rois: {
        cashierRoi: camera.cashierRoi,
        scanRoi: camera.scanRoi,
        customerRoi: camera.customerRoi,
        recognitionRoi: camera.recognitionRoi,
        paymentRoi: camera.paymentRoi,
        receiptRoi: camera.receiptRoi,
        packagingRoi: camera.packagingRoi,
        receivingRoi: camera.receivingRoi
      },
      updatedAt: camera.updatedAt
    };
  });

  app.post('/api/v1/analytics/cameras/:cameraCode/roi-reference-image', async (request) => {
    requireApiPermission(request, 'analytics:write');
    const { cameraCode } = z.object({ cameraCode: z.string() }).parse(request.params);
    const camera = await findCameraByCode(cameraCode);
    const apiKey = request.apiKeyContext;
    if (apiKey?.allowedCameraIds.length && !apiKey.allowedCameraIds.includes(camera.id)) {
      throw new HttpError(403, 'API key camera access denied', 'CAMERA_ACCESS_DENIED');
    }
    if (apiKey?.allowedStoreIds.length && !apiKey.allowedStoreIds.includes(camera.storeId)) {
      throw new HttpError(403, 'API key store access denied', 'STORE_ACCESS_DENIED');
    }
    return saveReferenceImage(request, camera.id, camera.storeId, camera.code);
  });

  app.post('/api/v1/cameras/:id/roi-reference-image', async (request) => {
    requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'QUALITY_CONTROL', 'STORE_MANAGER']);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const camera = await findCameraById(id);
    canAccessStore(request, camera.storeId);
    return saveReferenceImage(request, camera.id, camera.storeId, camera.code);
  });

  app.get('/api/v1/cameras/:id/roi-reference-image', async (request, reply) => {
    requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const camera = await findCameraById(id);
    canAccessStore(request, camera.storeId);
    const image = publicImageMetadata(camera);
    const imageData = camera.roiReferenceImageData ?? (image ? await readLegacyImageBlob(camera.id, image) : null);
    if (!image || !imageData) {
      throw new HttpError(404, 'Reference image not found', 'REFERENCE_IMAGE_NOT_FOUND');
    }
    return reply.type(camera.roiReferenceImageMime ?? image.mimeType ?? 'image/jpeg').send(imageData);
  });

  app.patch('/api/v1/cameras/:id/rois', async (request) => {
    requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'QUALITY_CONTROL', 'STORE_MANAGER']);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const camera = await findCameraById(id);
    canAccessStore(request, camera.storeId);
    const input = roiUpdateSchema.parse(request.body);
    const analyticsConfiguration = {
      ...((camera.analyticsConfiguration ?? {}) as Record<string, any>),
      roiMarkup: {
        image: input.image,
        updatedAt: new Date().toISOString(),
        updatedByUserId: request.userContext?.id
      }
    };
    const updated = await prisma.camera.update({
      where: { id },
      data: {
        cashierRoi: input.cashierRoi,
        scanRoi: input.scanRoi,
        customerRoi: input.customerRoi,
        analyticsConfiguration
      }
    });
    await prisma.auditLog.create({
      data: {
        userId: request.userContext?.id,
        action: 'CAMERA_ROI_UPDATED',
        entityType: 'Camera',
        entityId: id,
        storeId: camera.storeId,
        metadata: {
          cashierPolygons: input.cashierRoi.length,
          scanPolygons: input.scanRoi.length,
          customerPolygons: input.customerRoi.length
        }
      }
    });
    return updated;
  });

  app.get('/api/v1/cameras/:id/rois', async (request) => {
    requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const camera = await findCameraById(id);
    canAccessStore(request, camera.storeId);
    return {
      cameraId: camera.id,
      cameraCode: camera.code,
      referenceImage: publicImageMetadata(camera),
      cashierRoi: camera.cashierRoi,
      scanRoi: camera.scanRoi,
      customerRoi: camera.customerRoi
    };
  });

  async function saveReferenceImage(
    request: FastifyRequest,
    cameraId: string,
    storeId: string,
    cameraCode: string
  ) {
    const file = await request.file();
    if (!file) throw new HttpError(400, 'Multipart image file is required', 'IMAGE_REQUIRED');
    const ext = extensionForMime(file.mimetype);
    const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const imageData = await readFileBuffer(file);
    const fields = (file as unknown as { fields?: Record<string, { value?: unknown }> }).fields ?? {};
    const width = fields.width?.value ? Number(fields.width.value) : undefined;
    const height = fields.height?.value ? Number(fields.height.value) : undefined;
    const capturedAt = fields.capturedAt?.value ? new Date(String(fields.capturedAt.value)) : new Date();
    const existing = await findCameraById(cameraId);
    const roiReferenceImage = {
      id: imageId,
      cameraId,
      cameraCode,
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: imageData.length,
      width,
      height,
      capturedAt: capturedAt.toISOString(),
      uploadedAt: new Date().toISOString(),
      uploadedBy: request.userContext?.id ? 'user' : 'analytics_service',
      url: `/api/v1/cameras/${cameraId}/roi-reference-image`
    };
    const analyticsConfiguration = {
      ...((existing.analyticsConfiguration ?? {}) as Record<string, any>),
      roiReferenceImage
    };
    await prisma.camera.update({
      where: { id: cameraId },
      data: {
        analyticsConfiguration,
        roiReferenceImageData: imageData,
        roiReferenceImageMime: file.mimetype,
        roiReferenceImageName: file.filename
      }
    });
    await prisma.auditLog.create({
      data: {
        userId: request.userContext?.id,
        apiKeyId: request.apiKeyContext?.id,
        action: 'CAMERA_ROI_REFERENCE_IMAGE_UPLOADED',
        entityType: 'Camera',
        entityId: cameraId,
        storeId,
        metadata: { imageId, mimeType: file.mimetype, width, height }
      }
    });
    return roiReferenceImage;
  }
}
