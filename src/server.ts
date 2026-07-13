import { buildApp } from './app.js';
import { env } from './config/env.js';
import { ScheduledTaskWorker } from './modules/scheduled-tasks/worker.js';

const app = await buildApp();
const worker = new ScheduledTaskWorker();
worker.start();

const shutdown = async () => {
  worker.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: env.HOST, port: env.PORT });
