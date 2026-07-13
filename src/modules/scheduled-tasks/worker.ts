import { randomUUID } from 'node:crypto';
import { prisma } from '../../common/services/prisma.js';
import { env } from '../../config/env.js';

export class ScheduledTaskWorker {
  private timer?: NodeJS.Timeout;
  private readonly workerId = randomUUID();

  start() {
    this.timer = setInterval(() => void this.tick(), env.SCHEDULED_TASK_POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const tasks = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "ScheduledTask"
        WHERE status = 'PENDING' AND "executeAt" <= now()
        ORDER BY "executeAt" ASC
        LIMIT ${env.SCHEDULED_TASK_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;
      if (!rows.length) return [];
      await tx.scheduledTask.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: 'PROCESSING', lockedAt: new Date(), lockedBy: this.workerId, attempts: { increment: 1 } }
      });
      return tx.scheduledTask.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    });
    for (const task of tasks) {
      try {
        await this.handle(task.type, task.payload);
        await prisma.scheduledTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', lockedAt: null, lockedBy: null } });
      } catch (error) {
        const failed = task.attempts >= task.maxAttempts;
        await prisma.scheduledTask.update({
          where: { id: task.id },
          data: { status: failed ? 'FAILED' : 'PENDING', lockedAt: null, lockedBy: null, lastError: error instanceof Error ? error.message : String(error) }
        });
      }
    }
  }

  private async handle(type: string, payload: unknown) {
    if (type === 'camera_offline_checks') {
      const now = Date.now();
      await prisma.camera.updateMany({
        where: { videoEnabled: true, lastVideoFrameAt: { lt: new Date(now - env.VIDEO_OFFLINE_AFTER_SECONDS * 1000) } },
        data: { videoStatus: 'OFFLINE', overallStatus: 'DEGRADED' }
      });
      await prisma.camera.updateMany({
        where: { audioEnabled: true, lastAudioPacketAt: { lt: new Date(now - env.AUDIO_OFFLINE_AFTER_SECONDS * 1000) } },
        data: { audioStatus: 'OFFLINE', overallStatus: 'DEGRADED' }
      });
      return;
    }
    if (type === 'close_inactive_sessions') {
      await prisma.checkoutSession.updateMany({
        where: { status: 'OPEN', lastActivityAt: { lt: new Date(Date.now() - env.SESSION_INACTIVITY_TIMEOUT_SECONDS * 1000) } },
        data: { status: 'COMPLETED', endedAt: new Date() }
      });
      return;
    }
    if (type === 'notification_retry') {
      await prisma.employeeNotification.updateMany({ where: { status: 'FAILED' }, data: { status: 'PENDING' } });
      return;
    }
    await prisma.auditLog.create({ data: { action: 'SCHEDULED_TASK_EXECUTED', entityType: type, metadata: (payload as any) ?? {} } });
  }
}
