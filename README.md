# Cashier Copilot Backend

Production-oriented modular monolith for cashier sales, service, payment, checkout, receiving, evidence, and review monitoring.

## Stack

Node.js, TypeScript, Fastify, Prisma, PostgreSQL, Zod, JWT, bcrypt, Swagger/OpenAPI, Docker Compose, ESLint, Prettier, Vitest.

## Run

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run dev
```

Swagger is exposed at `/docs`. Health checks are `/health` and `/ready`.

## Production

```bash
npm run build
npm start
```

Docker:

```bash
docker compose up --build
```

## Architecture

The backend is a modular monolith. The Python analytics service performs RTSP, YOLO, tracking, pose, speech, and clip generation. This service stores configuration, ingests analytics and integration events, correlates them with receipts and sessions, evaluates database rules, creates reviewable violations, stores evidence metadata, sends workstation notifications, and generates reports.

Access control uses roles, store access, city access, register/camera API-key allow lists, and dedicated API key permissions. There is no organization model.

## Integrations

Use `x-api-key` for ingestion:

- `POST /api/v1/integrations/receipts`
- `POST /api/v1/integrations/receipts/batch`
- `POST /api/v1/integrations/pos-events`
- `POST /api/v1/analytics/video/events`
- `POST /api/v1/analytics/audio/events`

Batch endpoints accept up to 500 records. Raw analytics events are immutable; receipt updates create `ReceiptVersion` history.

Detailed integration guides:

- [1C full guide](docs/1C_FULL_GUIDE.md)
- [1C API contract](docs/1C_INTEGRATION.md)
- [Python full guide](docs/PYTHON_FULL_GUIDE.md)
- [Python analytics service](docs/PYTHON_ANALYTICS_SERVICE.md)
- [Frontend](docs/FRONTEND.md)
- [Service standards summary](docs/SERVICE_STANDARDS.md)

## Workflow

Violations are created as suspicions with `NEW` status. They are never auto-confirmed and never assign penalties. Authorized users review with `/api/v1/violations/:id/review` or the confirm/reject/false-positive/corrected/escalate/resolve shortcuts. Review history is preserved.

Employee workstation notifications are delivered over WebSocket:

```text
GET /api/v1/workstations/:workstationId/notifications
```

## Evidence

Evidence clips store protected metadata and playback URLs. Normal camera endpoints mask RTSP credentials. Raw stream credentials require `/api/v1/cameras/:id/stream-credentials` and are audit logged.

## Scheduled Tasks

The worker uses PostgreSQL row locking with `FOR UPDATE SKIP LOCKED`. It supports camera offline checks, inactive session closing, notification retry, report hooks, retention hooks, and generic task auditing.

## Reports

`POST /api/v1/reports/generate` supports daily violation, weekly employee/store/receiving, monthly service-standard, receiving, and service-standard report shapes. JSON, CSV, XLSX, and PDF-ready formats are represented; PDF rendering can be delegated to an adapter.

## Tests

```bash
npm test
```
