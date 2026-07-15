# Frontend API Documentation

Документ описывает контракт frontend с backend Cashier Copilot: авторизация, роли, типовой REST-клиент, CRUD-ресурсы, workflow нарушений, уведомления кассы, ROI-разметка, отчеты, ошибки и UI-правила.

## 1. Базовая информация

Локальная среда:

```text
API base: http://localhost:3000
REST prefix: /api/v1
Swagger UI: http://localhost:3000/docs
Health: GET /health
Ready: GET /ready
WebSocket: ws://localhost:3000
```

Все даты backend принимает и возвращает как ISO-8601. В базе время хранится как UTC. На фронте отображайте время в timezone пользователя или магазина, но в запросы отправляйте ISO-строки.

Денежные поля приходят из Prisma Decimal. В JSON они могут быть строками или числами в зависимости от сериализации окружения. На фронте обрабатывайте суммы как decimal-safe значения, не как float для расчетов с деньгами.

## 2. Авторизация

Пользовательский frontend использует JWT в заголовке:

```http
Authorization: Bearer <accessToken>
```

Интеграционные и analytics-сервисы могут использовать API key:

```http
x-api-key: <api_key>
```

Обычный web UI должен работать через JWT. API key не хранить в браузере.

### 2.1 Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

Request:

```json
{
  "email": "admin@gradusy24.kz",
  "password": "password"
}
```

Response:

```json
{
  "user": {
    "id": "user_id",
    "email": "admin@gradusy24.kz",
    "firstName": "Admin",
    "lastName": "Gradusy24",
    "role": "ADMIN",
    "isActive": true,
    "lastLoginAt": "2026-07-15T08:30:00.000Z",
    "createdAt": "2026-07-13T17:00:00.000Z",
    "updatedAt": "2026-07-15T08:30:00.000Z"
  },
  "accessToken": "jwt_access",
  "refreshToken": "jwt_refresh"
}
```

Backend не возвращает `passwordHash` и `refreshTokenHash`.

### 2.2 Refresh

```http
POST /api/v1/auth/refresh
Content-Type: application/json
```

Request:

```json
{
  "refreshToken": "jwt_refresh"
}
```

Response:

```json
{
  "accessToken": "new_jwt_access",
  "refreshToken": "new_jwt_refresh"
}
```

При refresh backend ротирует refresh token. Старый refresh token после успешного refresh становится невалидным.

### 2.3 Logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
```

Response:

```json
{ "ok": true }
```

### 2.4 Current User

```http
GET /api/v1/auth/me
Authorization: Bearer <accessToken>
```

Response: объект пользователя без sensitive-полей.

### 2.5 Рекомендации по хранению токенов

- `accessToken` держать в памяти приложения.
- `refreshToken` хранить в выбранном защищенном storage, если проект пока не использует httpOnly cookies.
- При `401` один раз вызвать refresh, заменить оба токена и повторить исходный запрос.
- Если refresh вернул `401`, очистить сессию и отправить пользователя на login.
- Не выполнять несколько refresh-запросов параллельно: используйте single-flight mutex в API-клиенте.

## 3. Роли и доступ

Enum `UserRole`:

```text
SUPER_ADMIN
ADMIN
OPERATIONS_DIRECTOR
REGIONAL_MANAGER
STORE_MANAGER
QUALITY_CONTROL
HR
ANALYST
OPERATOR
EMPLOYEE
VIEWER
ANALYTICS_SERVICE
INTEGRATION_SERVICE
```

Полный доступ к store-scoped данным имеют `SUPER_ADMIN`, `ADMIN`, `OPERATIONS_DIRECTOR`. Остальные пользователи ограничиваются назначенными магазинами. Backend проверяет store access для store-scoped single-item/detail операций и create/update, когда есть `storeId`.

Рекомендуемая навигация:

| Роль | Основной UI |
| --- | --- |
| `SUPER_ADMIN` | Все экраны, системные настройки, пользователи, интеграции |
| `ADMIN` | Магазины, кассы, камеры, правила, пользователи, интеграции |
| `OPERATIONS_DIRECTOR` | Дашборды, отчеты, нарушения, аналитика по сети |
| `REGIONAL_MANAGER` | Дашборды и отчеты по доступным городам/магазинам |
| `STORE_MANAGER` | Свой магазин, сотрудники, смены, нарушения, приемка |
| `QUALITY_CONTROL` | Очередь нарушений, review, evidence, service quality |
| `HR` | Service quality и коммуникационные события |
| `ANALYST` | Read-only аналитика и отчеты |
| `OPERATOR` | Очередь алертов, первичная обработка нарушений |
| `EMPLOYEE` | Рабочий экран/уведомления, без административных данных |
| `VIEWER` | Read-only доступ |

Важно для UI-текста: AI-события являются подозрениями. До решения человека не называйте их доказанной виной. Для `NEW` и `IN_PROGRESS` используйте формулировки вроде “требует проверки”.

## 4. Ошибки

Формат ошибки:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid request",
  "details": {}
}
```

Типовые статусы:

| HTTP | Что значит | UI-действие |
| --- | --- | --- |
| `400` | Невалидный request body/query | Показать ошибки формы |
| `401` | Нет/истек JWT или нужен API key | Refresh или logout |
| `403` | Недостаточно прав или нет доступа к магазину | Показать access denied |
| `404` | Сущность не найдена | Показать not found / обновить список |
| `409` | Конфликт уникальности или constraint | Показать конфликт данных |
| `500` | Ошибка backend | Показать generic error и request id, если есть |

Zod validation error приходит как `VALIDATION_ERROR` с `details.fieldErrors` и `details.formErrors`.

Prisma unique/constraint ошибки сейчас мапятся в:

```json
{
  "error": "DATABASE_CONSTRAINT",
  "message": "Request conflicts with existing data"
}
```

## 5. Общий REST-клиент

Все пользовательские endpoints, кроме health/ready и открытых кассовых notification endpoints, требуют JWT.

Рекомендуемый клиент:

```ts
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error, body?.message, body?.details);
  }

  return res.json();
}
```

Для `multipart/form-data` не задавайте `Content-Type` вручную: browser сам поставит boundary.

## 6. Списки, сортировка и поиск

Generic CRUD list endpoints возвращают:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 0
  }
}
```

Поддерживаемые query params:

```text
page: number, default 1, min 1
limit: number, default 25, max 100
sortBy: string, default createdAt
sortOrder: asc | desc, default desc
search: string
createdFrom: ISO datetime
createdTo: ISO datetime
city: string
storeId: string
registerId: string
cameraId: string
employeeId: string
shiftId: string
sessionId: string
receiptId: string
receiptNumber: string
operationType: string
status: string
severity: string
eventType: string
violationType: string
mediaType: string
source: string
supplierId: string
evidenceStatus: string
```

Фактический generic CRUD-фильтр применяет только часть полей к `where`: `storeId`, `registerId`, `cameraId`, `employeeId`, `shiftId`, `sessionId`, `receiptId`, `status`, `severity`, `createdFrom`, `createdTo`, `search`. Остальные параметры есть в общей схеме и могут использоваться специализированными endpoints позже.

`search` работает по searchFields из registry для конкретного ресурса.

## 7. Generic CRUD endpoints

Для большинства доменных сущностей backend регистрирует однотипные endpoints:

```text
GET    /api/v1/<resource>
GET    /api/v1/<resource>/:id
POST   /api/v1/<resource>
PATCH  /api/v1/<resource>/:id
```

Request body для `POST` и `PATCH` сейчас валидируется как object и передается в Prisma почти напрямую. Фронтенд должен отправлять только поля, существующие в Prisma model, иначе получите `500`/Prisma validation error в текущей реализации.

Важное правило для создания магазина: `Store.code` обязателен и уникален. Payload должен включать минимум:

```json
{
  "name": "Shaterov 52",
  "code": "shaterov-52",
  "address": "Shaterov 52",
  "city": "KRG",
  "isActive": true
}
```

Если UI принимает только `name` и `city`, фронт должен либо показывать поле `code`, либо генерировать slug из названия до отправки.

### 7.1 Ресурсы CRUD

| Resource | Model | Search fields | Store-scoped |
| --- | --- | --- | --- |
| `/stores` | `Store` | `name`, `code`, `city` | no |
| `/registers` | `Register` | `name`, `code` | yes |
| `/cameras` | `Camera` | `name`, `code` | yes |
| `/employees` | `Employee` | `firstName`, `lastName`, `employeeNumber` | yes |
| `/shifts` | `Shift` | `externalId` | yes |
| `/receipts` | `Receipt` | `receiptNumber`, `externalId` | yes |
| `/payments` | `Payment` | `externalId` | no |
| `/pos-operations` | `PosOperation` | `externalEventId` | yes |
| `/checkout-sessions` | `CheckoutSession` | `correlationId` | yes |
| `/analytics-events` | `AnalyticsEvent` | `externalEventId`, `eventType` | yes |
| `/detections` | `Detection` | `className` | yes |
| `/speech-events` | `SpeechEvent` | `text`, `externalEventId` | yes |
| `/cashier-actions` | `CashierAction` | `source` | yes |
| `/action-types` | `ActionType` | `code`, `name` | no |
| `/reconciliations` | `SaleReconciliation` | `status` | no |
| `/service-standards` | `ServiceStandard` | `name` | no |
| `/service-evaluations` | `ServiceEvaluation` | `result` | no |
| `/suppliers` | `Supplier` | `name`, `code` | no |
| `/receiving-documents` | `ReceivingDocument` | `documentNumber`, `externalId` | yes |
| `/receiving-sessions` | `ReceivingSession` | `status` | yes |
| `/rules` | `Rule` | `name`, `code` | no |
| `/violations` | `Violation` | `title`, `violationType` | yes |
| `/violation-reviews` | `ViolationReview` | `comment` | no |
| `/evidence-clips` | `EvidenceClip` | `storageKey` | yes |
| `/employee-notifications` | `EmployeeNotification` | `title`, `message` | yes |
| `/manager-notifications` | `EmployeeNotification` | `title`, `message` | yes |
| `/alerts` | `Violation` | `title`, `violationType` | yes |
| `/integration-events` | `IntegrationEvent` | `externalEventId`, `eventType` | no |
| `/integration-errors` | `IntegrationError` | `message`, `errorType` | no |
| `/scheduled-tasks` | `ScheduledTask` | `type` | no |
| `/reports` | `Report` | `type`, `format` | no |
| `/audit-logs` | `AuditLog` | `action`, `entityType` | no |

`/manager-notifications` и `/employee-notifications` используют одну Prisma model (`EmployeeNotification`). `/alerts` и `/violations` используют одну model (`Violation`) с разными UI-смыслами.

## 8. Основные модели для UI

Ниже перечислены поля, которые фронт чаще всего отображает или отправляет. Полный источник истины - `prisma/schema.prisma`.

### 8.1 Store

Ключевые поля:

```text
id, name, code, address, city, timezone, isActive, metadata, createdAt, updatedAt
```

Create example:

```json
{
  "name": "Tolstogo 90",
  "code": "tolstogo-90",
  "address": "Tolstogo 90",
  "city": "Almaty",
  "timezone": "Asia/Almaty",
  "isActive": true,
  "metadata": {}
}
```

`code` уникален и используется во внешних интеграциях, кассовых notification URL и analytics payload. Не меняйте `code` без миграционного сценария.

### 8.2 Register

Ключевые поля:

```text
id, storeId, name, code, registerNumber, externalId, workstationId,
notificationClientId, allowMultipleOpenSessions, isActive, metadata
```

Create example:

```json
{
  "storeId": "store_id",
  "name": "Register 1",
  "code": "register-1",
  "registerNumber": 1,
  "workstationId": "workstation-1",
  "isActive": true
}
```

`code` уникален внутри магазина: `(storeId, code)`.

### 8.3 Camera

Ключевые поля:

```text
id, storeId, registerId, name, code, externalId, locationType, isActive,
videoEnabled, videoRtspUrl, videoAnalyticsStreamUrl, videoStatus,
audioEnabled, audioRtspUrl, audioAnalyticsStreamUrl, audioStatus,
overallStatus, lastSeenAt, cashierRoi, scanRoi, customerRoi,
analyticsConfiguration, createdAt, updatedAt
```

Create example:

```json
{
  "storeId": "store_id",
  "registerId": "register_id",
  "name": "Checkout camera",
  "code": "cam10",
  "locationType": "CHECKOUT",
  "videoEnabled": true,
  "videoRtspUrl": "rtsp://user:pass@camera/video",
  "audioEnabled": true,
  "audioRtspUrl": "rtsp://user:pass@camera/audio"
}
```

Обычные camera CRUD responses маскируют RTSP URL:

```json
{
  "videoRtspUrl": "rtsp://user:***@host/video",
  "audioRtspUrl": "rtsp://user:***@host/audio"
}
```

Для просмотра реальных stream credentials:

```http
POST /api/v1/cameras/:id/stream-credentials
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "videoRtspUrl": "rtsp://user:pass@camera/video",
  "audioRtspUrl": "rtsp://user:pass@camera/audio",
  "videoAnalyticsStreamUrl": "rtsp://...",
  "audioAnalyticsStreamUrl": "rtsp://..."
}
```

Этот endpoint пишет audit log. Показывайте доступ только администраторам или явно разрешенным ролям.

### 8.4 Employee

Ключевые поля:

```text
id, storeId, externalId, employeeNumber, firstName, lastName,
position, isActive, metadata, createdAt, updatedAt
```

### 8.5 Shift

Ключевые поля:

```text
id, storeId, registerId, employeeId, externalId, startedAt, endedAt,
status, metadata, createdAt, updatedAt
```

`ShiftStatus`: `PLANNED`, `ACTIVE`, `COMPLETED`, `CANCELLED`.

### 8.6 Receipt

Ключевые поля:

```text
id, storeId, registerId, employeeId, shiftId, checkoutSessionId,
externalId, receiptNumber, operationType, status, openedAt, completedAt,
subtotalAmount, discountAmount, totalAmount, paidAmount, bonusAmount,
currency, paymentMethod, expectedChangeAmount, actualChangeAmount,
customerAgeRestrictedPurchase, version, originalReceiptId, metadata
```

Enums:

```text
ReceiptOperationType: SALE, RETURN, CANCELLATION, VOID, RECEIPT_CORRECTION
ReceiptStatus: OPEN, COMPLETED, CANCELLED, VOIDED, RETURNED, PARTIALLY_RETURNED
PaymentMethod: CASH, CARD, BONUS, MIXED, QR, OTHER
```

Карточка чека должна показывать магазин, кассу, номер чека, тип операции, статус, суммы, payment method, сотрудника/смену, связанные нарушения и timeline.

### 8.7 CheckoutSession

Ключевые поля:

```text
id, storeId, registerId, cameraId, employeeId, shiftId, receiptId,
externalOrderId, correlationId, customerTrackId, startedAt, endedAt,
lastActivityAt, status, customerWaitSeconds, cashierAbsentSeconds,
interactionDurationSeconds, detectedProductCount, scannedProductCount,
transferredProductCount, unmatchedDetectedProductCount,
unmatchedReceiptItemCount, totalAmount, paidAmount, expectedChangeAmount,
actualChangeAmount, financialRiskAmount, serviceScore, confidence, metadata
```

`CheckoutSessionStatus`: `OPEN`, `COMPLETED`, `ABANDONED`, `CANCELLED`, `NEEDS_REVIEW`.

### 8.8 Violation

Ключевые поля:

```text
id, ruleId, storeId, registerId, cameraId, employeeId, shiftId,
sessionId, receiptId, receivingSessionId, actionId, analyticsEventId,
speechEventId, reconciliationId, operationType, violationType, severity,
confidence, title, description, occurredAt, status, financialRiskAmount,
assignedToUserId, assignedDepartment, reviewedByUserId, reviewedAt,
resolutionComment, correctedAt, correctionConfirmedByUserId, details,
createdAt, updatedAt
```

Enums:

```text
Severity: LOW, MEDIUM, HIGH, CRITICAL
ViolationOperationType: SALE, RETURN, CANCELLATION, VOID, RECEIVING, SERVICE, CAMERA, INTEGRATION
ViolationStatus: NEW, IN_PROGRESS, CONFIRMED, REJECTED, FALSE_POSITIVE, CORRECTED, RESOLVED, ESCALATED_TO_MANAGER, ESCALATED_TO_HR, ESCALATED_TO_QUALITY_CONTROL, IGNORED
```

### 8.9 EvidenceClip

Ключевые поля:

```text
id, storeId, registerId, cameraId, sessionId, receiptId,
receivingSessionId, violationId, mediaType, storageProvider, storageKey,
playbackUrl, eventOccurredAt, clipStartAt, clipEndAt, secondsBefore,
secondsAfter, durationSeconds, status, errorCode, errorMessage,
expiresAt, fileSizeBytes, checksum, metadata
```

`EvidenceStatus`: `REQUESTED`, `GENERATING`, `AVAILABLE`, `NOT_FOUND`, `CAMERA_UNAVAILABLE`, `RECORDING_ERROR`, `FAILED`, `EXPIRED`, `DELETED`.

### 8.10 EmployeeNotification

Ключевые поля:

```text
id, storeId, registerId, employeeId, sessionId, receiptId, violationId,
type, title, message, priority, displayMode, status, createdAt,
deliveredAt, displayedAt, acknowledgedAt, dismissedAt, correctedAt,
expiresAt, metadata
```

Enums:

```text
NotificationDisplayMode: TOAST, BANNER, MODAL_NON_BLOCKING
NotificationStatus: PENDING, DELIVERED, DISPLAYED, ACKNOWLEDGED, DISMISSED, CORRECTED, FAILED, EXPIRED
```

## 9. Dashboard

Endpoints:

```text
GET /api/v1/dashboard/summary
GET /api/v1/dashboard/sales-risk
GET /api/v1/dashboard/service-quality
GET /api/v1/dashboard/receiving
GET /api/v1/dashboard/camera-health
GET /api/v1/dashboard/integration-health
GET /api/v1/dashboard/employees
GET /api/v1/dashboard/stores
GET /api/v1/dashboard/registers
GET /api/v1/dashboard/violations-trend
```

Все endpoints требуют JWT. Сейчас каждый path возвращает одинаковую агрегированную структуру с разным `scope`:

```json
{
  "scope": "summary",
  "totalReceipts": 123,
  "totalViolations": 12,
  "highRiskViolations": 4,
  "totalPossibleFinancialRiskAmount": "15000.00",
  "cameraAvailability": [
    {
      "videoStatus": "ONLINE",
      "audioStatus": "ONLINE",
      "_count": 10
    }
  ],
  "integrationErrors": 1
}
```

Рекомендуемые виджеты:

- Total receipts.
- Total violations.
- High/critical risk violations.
- Possible financial risk amount.
- Camera availability grouped by video/audio status.
- Integration errors.

## 10. Timeline

### 10.1 Checkout session timeline

```http
GET /api/v1/checkout-sessions/:id/timeline
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "data": [
    {
      "type": "pos",
      "at": "2026-07-15T08:00:00.000Z",
      "data": {}
    },
    {
      "type": "violation",
      "at": "2026-07-15T08:01:00.000Z",
      "data": {}
    }
  ]
}
```

Типы элементов checkout timeline:

```text
pos
analytics
speech
action
violation
notification
evidence
payment
```

### 10.2 Receipt timeline

```http
GET /api/v1/receipts/:id/timeline
Authorization: Bearer <accessToken>
```

Если чек не связан с checkout session, вернется пустой `data`.

### 10.3 Receiving session timeline

```http
GET /api/v1/receiving-sessions/:id/timeline
Authorization: Bearer <accessToken>
```

Типы элементов:

```text
receiving-session
evidence
violation
```

## 11. Violation Workflow

### 11.1 Review

```http
POST /api/v1/violations/:id/review
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Доступные роли: `QUALITY_CONTROL`, `ADMIN`, `OPERATOR`, `STORE_MANAGER`, также `SUPER_ADMIN` как глобальная роль.

Request:

```json
{
  "decision": "CONFIRM",
  "comment": "На видео подтверждается передача товара без сканирования."
}
```

`ReviewDecision`:

```text
CONFIRM
REJECT
FALSE_POSITIVE
REQUEST_MORE_INFORMATION
MARK_CORRECTED
ESCALATE
RESOLVE
```

Маппинг decision -> new violation status:

| Decision | New status |
| --- | --- |
| `CONFIRM` | `CONFIRMED` |
| `REJECT` | `REJECTED` |
| `FALSE_POSITIVE` | `FALSE_POSITIVE` |
| `REQUEST_MORE_INFORMATION` | `IN_PROGRESS` |
| `MARK_CORRECTED` | `CORRECTED` |
| `ESCALATE` | `ESCALATED_TO_MANAGER` |
| `RESOLVE` | `RESOLVED` |

Backend создает `ViolationReview` и `AuditLog`.

### 11.2 Shortcut actions

```text
POST /api/v1/violations/:id/confirm
POST /api/v1/violations/:id/reject
POST /api/v1/violations/:id/false-positive
POST /api/v1/violations/:id/corrected
POST /api/v1/violations/:id/escalate
POST /api/v1/violations/:id/resolve
```

Body optional:

```json
{
  "comment": "Комментарий ревьюера"
}
```

Эти endpoints внутри вызывают review endpoint с нужным `decision`.

### 11.3 Assign

```http
POST /api/v1/violations/:id/assign
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{
  "assignedToUserId": "user_id",
  "assignedDepartment": "QUALITY_CONTROL"
}
```

Можно отправить одно из двух полей или оба.

## 12. Evidence Playback

### 12.1 Получить playback URL

```http
GET /api/v1/evidence-clips/:id/playback
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "playbackUrl": "https://signed-or-protected-url",
  "expiresAt": "2026-07-15T09:00:00.000Z"
}
```

Endpoint вернет `404 EVIDENCE_NOT_AVAILABLE`, если clip не найден или `status != AVAILABLE`.

UI-правила:

- Запрашивать playback URL только при открытии просмотра.
- Не хранить playback URL в localStorage/sessionStorage.
- Учитывать `expiresAt`; при истечении запросить URL заново.

### 12.2 Regenerate evidence

```http
POST /api/v1/evidence-clips/:id/regenerate
Authorization: Bearer <accessToken>
```

Доступные роли: `ADMIN`, `QUALITY_CONTROL`, `OPERATOR`, `SUPER_ADMIN`.

Response: обновленный `EvidenceClip` со `status = REQUESTED`, очищенными `errorCode` и `errorMessage`.

## 13. Employee Notifications и кассовый экран

### 13.1 CRUD list/detail

Обычный административный список:

```text
GET /api/v1/employee-notifications
GET /api/v1/employee-notifications/:id
```

Требует JWT.

### 13.2 Notification actions

```text
POST /api/v1/employee-notifications/:id/acknowledge
POST /api/v1/employee-notifications/:id/dismiss
POST /api/v1/employee-notifications/:id/corrected
```

Все требуют JWT.

Маппинг:

| Action | Updated field | Status |
| --- | --- | --- |
| `acknowledge` | `acknowledgedAt` | `ACKNOWLEDGED` |
| `dismiss` | `dismissedAt` | `DISMISSED` |
| `corrected` | `correctedAt` | `CORRECTED` |

### 13.3 Открытые endpoints для кассы

Эти endpoints специально открыты без JWT/API key, чтобы кассовый экран мог poll-ить уведомления:

```text
GET /api/v1/registers/:id/violation-notifications
GET /api/v1/stores/:storeCode/registers/:registerCode/violation-notifications
```

Query params:

```text
limit: 1..100, default 50
status: comma-separated statuses, default PENDING,DELIVERED,DISPLAYED
markDelivered: boolean, default false
```

Example:

```http
GET /api/v1/stores/tolstogo-90/registers/register-1/violation-notifications?markDelivered=true&limit=20
```

Response:

```json
{
  "register": {
    "id": "register_id",
    "code": "register-1",
    "name": "Register 1",
    "storeId": "store_id"
  },
  "data": [
    {
      "id": "notification_id",
      "type": "product-transferred-not-scanned",
      "title": "Product transferred but not scanned",
      "message": "Check the receipt: a product was transferred but not scanned.",
      "priority": "HIGH",
      "displayMode": "BANNER",
      "status": "DELIVERED",
      "createdAt": "2026-07-15T08:00:00.000Z",
      "deliveredAt": "2026-07-15T08:00:03.000Z",
      "displayedAt": null,
      "acknowledgedAt": null,
      "dismissedAt": null,
      "correctedAt": null,
      "expiresAt": null,
      "store": {
        "id": "store_id",
        "code": "tolstogo-90",
        "name": "Tolstogo 90",
        "city": "Almaty"
      },
      "register": {
        "id": "register_id",
        "code": "register-1",
        "name": "Register 1"
      },
      "camera": null,
      "employee": null,
      "receipt": null,
      "violation": {
        "id": "violation_id",
        "ruleId": "rule_id",
        "violationType": "product-transferred-not-scanned",
        "operationType": "SALE",
        "severity": "HIGH",
        "confidence": 0.92,
        "title": "Product transferred but not scanned",
        "description": "...",
        "occurredAt": "2026-07-15T08:00:00.000Z",
        "status": "NEW",
        "financialRiskAmount": "2500.00",
        "details": {}
      },
      "evidence": [],
      "metadata": {}
    }
  ]
}
```

Если `markDelivered=true`, backend переводит `PENDING` notifications в `DELIVERED`.

Если найден мат в речи кассира, notification приходит с `type = profanity-detected`, а `violation.violationType` тоже `profanity-detected`.

### 13.4 Workstation WebSocket

```text
ws://localhost:3000/api/v1/workstations/:workstationId/notifications
```

Backend ищет register по `workstationId`. Если register не найден, socket закрывается с code `1008` и reason `Unknown workstation`.

Каждые 3 секунды backend отправляет pending notifications и переводит их в `DELIVERED`.

Message:

```json
{
  "type": "notifications",
  "data": [
    {
      "id": "notification_id",
      "type": "product-transferred-not-scanned",
      "title": "Product transferred but not scanned",
      "message": "Check the receipt: a product was transferred but not scanned.",
      "priority": "HIGH",
      "displayMode": "BANNER",
      "status": "PENDING"
    }
  ]
}
```

UI должен:

- Подключаться по стабильному `workstationId` из настройки кассового места.
- Поддерживать reconnect с exponential backoff.
- Показывать `TOAST`, `BANNER`, `MODAL_NON_BLOCKING` согласно `displayMode`.
- Не блокировать POS-операцию модальным окном, если `displayMode != MODAL_NON_BLOCKING`.
- Для подтверждения/скрытия использовать authenticated workflow endpoints, если пользователь авторизован. Если кассовый экран без JWT, используйте только отображение и polling/WebSocket delivery.

## 14. Camera ROI

ROI хранится в normalized coordinates: `x` и `y` от `0` до `1`, где `0,0` - левый верхний угол изображения, `1,1` - правый нижний.

### 14.1 Получить ROI для UI

```http
GET /api/v1/cameras/:id/rois
Authorization: Bearer <accessToken>
```

Response:

```json
{
  "cameraId": "camera_id",
  "cameraCode": "cam10",
  "referenceImage": {
    "id": "image_id",
    "cameraId": "camera_id",
    "cameraCode": "cam10",
    "storageKey": "camera_id/image.jpg",
    "filename": "frame.jpg",
    "mimeType": "image/jpeg",
    "width": 1920,
    "height": 1080,
    "capturedAt": "2026-07-15T08:00:00.000Z",
    "uploadedAt": "2026-07-15T08:00:02.000Z",
    "uploadedBy": "user",
    "url": "/api/v1/cameras/camera_id/roi-reference-image"
  },
  "cashierRoi": [],
  "scanRoi": [],
  "customerRoi": []
}
```

### 14.2 Получить reference image

```http
GET /api/v1/cameras/:id/roi-reference-image
Authorization: Bearer <accessToken>
```

Response body: binary image stream. Content-Type: `image/jpeg`, `image/png` или `image/webp`.

### 14.3 Загрузить reference image вручную

```http
POST /api/v1/cameras/:id/roi-reference-image
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

Form fields:

```text
file: image/jpeg | image/png | image/webp, required
width: number, optional
height: number, optional
capturedAt: ISO datetime, optional
```

Доступные роли: `ADMIN`, `SUPER_ADMIN`, `QUALITY_CONTROL`, `STORE_MANAGER`.

### 14.4 Сохранить ROI

```http
PATCH /api/v1/cameras/:id/rois
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{
  "image": {
    "id": "image_id",
    "width": 1920,
    "height": 1080,
    "capturedAt": "2026-07-15T08:00:00.000Z"
  },
  "cashierRoi": [
    {
      "label": "cashier-main",
      "points": [
        { "x": 0.12, "y": 0.18 },
        { "x": 0.38, "y": 0.18 },
        { "x": 0.39, "y": 0.78 }
      ],
      "confidence": 1,
      "metadata": {}
    }
  ],
  "scanRoi": [],
  "customerRoi": []
}
```

Polygon schema:

```text
id?: string
label?: string
points: Array<{ x: number 0..1, y: number 0..1 }>, min 3
confidence?: number 0..1
metadata: object, default {}
```

Сейчас frontend endpoint сохраняет только `cashierRoi`, `scanRoi`, `customerRoi`. В analytics read endpoint также возвращаются `recognitionRoi`, `paymentRoi`, `receiptRoi`, `packagingRoi`, `receivingRoi`, но frontend patch их не обновляет.

UI-правила ROI editor:

- Хранить состояние в normalized coordinates, а не в пикселях.
- При resize canvas пересчитывать только отображение.
- Требовать минимум 3 точки на polygon.
- Разрешить несколько polygon в каждой ROI-группе.
- Запрещать точки вне `0..1`.
- Давать отдельные цвета для `cashierRoi`, `scanRoi`, `customerRoi`.
- Не сохранять пустые случайные polygon после отмены рисования.

### 14.5 Analytics ROI endpoints

Для analytics-сервиса, не для browser UI:

```text
GET  /api/v1/analytics/cameras/:cameraCode/rois
POST /api/v1/analytics/cameras/:cameraCode/roi-reference-image
```

Требуют API key permission `analytics:write`. Не использовать эти endpoints из браузера.

## 15. Reports

### 15.1 Generate report

```http
POST /api/v1/reports/generate
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{
  "type": "daily_violation",
  "format": "json",
  "filters": {
    "storeId": "store_id",
    "from": "2026-07-01T00:00:00.000Z",
    "to": "2026-07-15T23:59:59.999Z"
  }
}
```

Allowed `type`:

```text
daily_violation
weekly_employee
weekly_store
weekly_receiving
monthly_service_standard
receiving
service_standard
```

Allowed `format`:

```text
json
csv
xlsx
pdf-ready
```

Response: created `Report` with `status = READY` and `result` object:

```json
{
  "id": "report_id",
  "type": "daily_violation",
  "format": "json",
  "filters": {},
  "status": "READY",
  "createdByUserId": "user_id",
  "result": {
    "violations": [],
    "service": {
      "_avg": { "percentage": 92.5 },
      "_count": 15
    },
    "receiving": [],
    "generatedAt": "2026-07-15T08:00:00.000Z"
  }
}
```

### 15.2 List/detail/download

```text
GET /api/v1/reports
GET /api/v1/reports/:id
GET /api/v1/reports/:id/download
```

`download` сейчас возвращает объект `Report`, а не binary-файл. UI может использовать `result` для построения таблицы/экспорта на клиенте, пока backend не добавит файловую генерацию.

## 16. Reconciliation

CRUD:

```text
GET /api/v1/reconciliations
GET /api/v1/reconciliations/:id
```

Retry:

```http
POST /api/v1/reconciliations/:id/retry
Authorization: Bearer <accessToken>
```

Доступные роли: `ADMIN`, `QUALITY_CONTROL`, `ANALYST`, `SUPER_ADMIN`.

Response: updated reconciliation со `status = PENDING`, `startedAt = now`, `completedAt = null`.

UI показывает:

- статус reconciliation;
- detected/scanned/transferred counts;
- unmatched counts;
- payment/change mismatch;
- possible financial risk;
- items с `matchStatus`.

`MatchStatus`:

```text
MATCHED
POSSIBLE_MATCH
TRANSFERRED_NOT_SCANNED
SCANNED_NOT_DETECTED
QUANTITY_MISMATCH
CONTAINER_MISMATCH
UNKNOWN
```

## 17. Service Quality

CRUD endpoints:

```text
GET /api/v1/service-standards
GET /api/v1/service-standards/:id
GET /api/v1/service-evaluations
GET /api/v1/service-evaluations/:id
```

Ключевые поля `ServiceEvaluation`:

```text
id, serviceStandardId, sessionId, receiptId, employeeId, shiftId,
totalScore, maximumScore, percentage, applicableCriteriaCount,
passedCriteriaCount, failedCriteriaCount, notRequiredCriteriaCount,
notDeterminedCriteriaCount, evaluatedAt, result
```

`CriterionResult`:

```text
PASSED
FAILED
NOT_REQUIRED
NOT_DETERMINED
MANUAL_REVIEW
```

UI-правила:

- `NOT_REQUIRED` не снижает score.
- `NOT_DETERMINED` показывать отдельно от failed.
- HR/quality UI не должен показывать sensitive payment details без отдельного разрешения.

## 18. Receiving

CRUD endpoints:

```text
GET /api/v1/receiving-documents
GET /api/v1/receiving-documents/:id
GET /api/v1/receiving-sessions
GET /api/v1/receiving-sessions/:id
GET /api/v1/receiving-sessions/:id/timeline
```

`ReceivingDocumentStatus`:

```text
EXPECTED
RECEIVING
COMPLETED
COMPLETED_WITH_DIFFERENCES
CANCELLED
```

`ReceivingSessionStatus`:

```text
OPEN
PROCESSING
COMPLETED
COMPLETED_WITH_DIFFERENCES
NEEDS_REVIEW
CANCELLED
```

Экран приемки показывает:

- поставщика и документ;
- expected/actual/detected/confirmed quantity;
- discrepancy quantity;
- проверку срока годности;
- проверку целостности упаковки;
- отделены ли damaged goods;
- записано ли расхождение;
- evidence и нарушения по session timeline.

## 19. Integration Monitoring

CRUD endpoints:

```text
GET /api/v1/integration-events
GET /api/v1/integration-events/:id
GET /api/v1/integration-errors
GET /api/v1/integration-errors/:id
PATCH /api/v1/integration-errors/:id
```

В текущем backend нет специализированных endpoints `retry`/`resolve` для integration errors. Для изменения статуса используйте generic `PATCH /api/v1/integration-errors/:id`, если роль имеет доступ и UI поддерживает эту операцию.

`IntegrationErrorStatus`:

```text
OPEN
RETRYING
RESOLVED
IGNORED
FAILED
```

## 20. Analytics/POS ingestion endpoints

Эти endpoints предназначены для 1C/POS/Python analytics-сервисов и требуют API key с нужными permissions. Browser frontend обычно их не вызывает.

Основной модуль ingestion принимает события продаж, video/audio analytics, speech, receiving и создает POS operations, analytics events, cashier actions, violations, notifications и evidence requests.

Для frontend важно:

- `storeCode`, `registerCode`, `cameraCode` во внешних payload должны совпадать с `Store.code`, `Register.code`, `Camera.code`.
- Если UI позволяет редактировать `code`, надо предупредить об impact на интеграции.
- `externalEventId` и `idempotencyKey` должны быть уникальными для ingestion.

Подробные контракты интеграций находятся в:

```text
docs/1C_INTEGRATION.md
docs/1C_FULL_GUIDE.md
docs/PYTHON_ANALYTICS_SERVICE.md
docs/PYTHON_FULL_GUIDE.md
```

## 21. Справочник enum values

```text
Severity: LOW, MEDIUM, HIGH, CRITICAL
LocationType: CHECKOUT, RECEIVING_AREA, WAREHOUSE, SALES_FLOOR, OTHER
StreamStatus: ONLINE, OFFLINE, DEGRADED, DISABLED, UNKNOWN
ShiftStatus: PLANNED, ACTIVE, COMPLETED, CANCELLED
ReceiptOperationType: SALE, RETURN, CANCELLATION, VOID, RECEIPT_CORRECTION
ReceiptStatus: OPEN, COMPLETED, CANCELLED, VOIDED, RETURNED, PARTIALLY_RETURNED
PaymentMethod: CASH, CARD, BONUS, MIXED, QR, OTHER
PaymentStatus: PENDING, COMPLETED, FAILED, CANCELLED, REFUNDED
PosOperationType: RECEIPT_OPENED, PRODUCT_SCANNED, PRODUCT_MANUALLY_ADDED, PRODUCT_REMOVED, RECEIPT_COMPLETED, RECEIPT_CANCELLED, VOID, RETURN_STARTED, RETURN_COMPLETED, PAYMENT_STARTED, PAYMENT_COMPLETED, CASH_RECEIVED, CHANGE_CALCULATED, CASH_DRAWER_OPENED, SHIFT_OPENED, SHIFT_CLOSED
CheckoutSessionStatus: OPEN, COMPLETED, ABANDONED, CANCELLED, NEEDS_REVIEW
MediaType: VIDEO, AUDIO, MULTIMODAL, POS, RECEIVING, SYSTEM, MANUAL, AUDIO_VIDEO
DetectionType: CUSTOMER, CASHIER, PRODUCT, SCANNER, RECEIPT, BUSINESS_CARD, PACKAGE, CONTAINER, MONEY, PAYMENT_CARD, PHONE, AGE_DOCUMENT, HAND, FACE, POSE, LABEL, EXPIRATION_DATE, DAMAGED_PACKAGE, BOX, PALLET, OTHER
SpeakerType: CASHIER, CUSTOMER, SUPPLIER, EMPLOYEE, UNKNOWN, MULTIPLE
AudioSource: CAMERA_AUDIO_RTSP, EXTERNAL_MICROPHONE_RTSP, EMBEDDED_VIDEO_AUDIO, UPLOADED_AUDIO, OTHER
ActionStatus: DETECTED, CONFIRMED, REJECTED, NEEDS_REVIEW
ReconciliationStatus: PENDING, PROCESSING, MATCHED, MISMATCH, NEEDS_REVIEW, FAILED
RuleDomain: SALES, PAYMENT, SERVICE, RECEIVING, CAMERA_HEALTH, INTEGRATION
TriggerType: ANALYTICS_EVENT, ACTION, SPEECH_EVENT, POS_OPERATION, RECEIPT, SESSION, RECONCILIATION, RECEIVING_SESSION, CAMERA_HEALTH, INTEGRATION_ERROR
ViolationOperationType: SALE, RETURN, CANCELLATION, VOID, RECEIVING, SERVICE, CAMERA, INTEGRATION
ReviewDecision: CONFIRM, REJECT, FALSE_POSITIVE, REQUEST_MORE_INFORMATION, MARK_CORRECTED, ESCALATE, RESOLVE
EvidenceStatus: REQUESTED, GENERATING, AVAILABLE, NOT_FOUND, CAMERA_UNAVAILABLE, RECORDING_ERROR, FAILED, EXPIRED, DELETED
NotificationStatus: PENDING, DELIVERED, DISPLAYED, ACKNOWLEDGED, DISMISSED, CORRECTED, FAILED, EXPIRED
NotificationDisplayMode: TOAST, BANNER, MODAL_NON_BLOCKING
CriterionResult: PASSED, FAILED, NOT_REQUIRED, NOT_DETERMINED, MANUAL_REVIEW
ReceivingDocumentStatus: EXPECTED, RECEIVING, COMPLETED, COMPLETED_WITH_DIFFERENCES, CANCELLED
ReceivingSessionStatus: OPEN, PROCESSING, COMPLETED, COMPLETED_WITH_DIFFERENCES, NEEDS_REVIEW, CANCELLED
ReceivingItemStatus: MATCHED, QUANTITY_MISMATCH, NOT_COUNTED, EXPIRATION_NOT_CHECKED, PACKAGE_NOT_CHECKED, DAMAGED, DAMAGED_NOT_SEPARATED, DIFFERENCE_NOT_RECORDED, UNKNOWN
IntegrationErrorStatus: OPEN, RETRYING, RESOLVED, IGNORED, FAILED
ScheduledTaskStatus: PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED
ReportStatus: REQUESTED, GENERATING, READY, FAILED
```

## 22. Рекомендованные frontend экраны

### Login

Endpoints:

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

### Operations Dashboard

Endpoints:

```text
GET /api/v1/dashboard/summary
GET /api/v1/dashboard/sales-risk
GET /api/v1/dashboard/camera-health
GET /api/v1/dashboard/integration-health
GET /api/v1/violations?status=NEW&limit=25
GET /api/v1/evidence-clips?status=AVAILABLE&limit=25
```

### Store Admin

Endpoints:

```text
GET/POST/PATCH /api/v1/stores
GET/POST/PATCH /api/v1/registers
GET/POST/PATCH /api/v1/cameras
POST /api/v1/cameras/:id/stream-credentials
GET/PATCH /api/v1/cameras/:id/rois
```

### Violation Queue

Endpoints:

```text
GET /api/v1/violations?status=NEW&sortBy=occurredAt&sortOrder=desc
GET /api/v1/violations/:id
GET /api/v1/evidence-clips?receiptId=<receipt_id>
GET /api/v1/evidence-clips/:id/playback
POST /api/v1/violations/:id/review
POST /api/v1/violations/:id/assign
```

### Receipt/Session Detail

Endpoints:

```text
GET /api/v1/receipts/:id
GET /api/v1/receipts/:id/timeline
GET /api/v1/checkout-sessions/:id
GET /api/v1/checkout-sessions/:id/timeline
GET /api/v1/reconciliations?sessionId=<id>
```

### Cashier Workstation

Endpoints:

```text
GET /api/v1/stores/:storeCode/registers/:registerCode/violation-notifications?markDelivered=true
WS  /api/v1/workstations/:workstationId/notifications
```

### Reports

Endpoints:

```text
POST /api/v1/reports/generate
GET /api/v1/reports
GET /api/v1/reports/:id/download
```

## 23. UX and Safety Rules

- Не показывать AI violation как доказанную вину до `CONFIRMED`.
- Показывать confidence как вспомогательный сигнал, а не как финальное решение.
- Для `CRITICAL` и `HIGH` нарушений использовать заметный, но не блокирующий workflow review.
- Playback URL получать just-in-time и не сохранять в persistent storage.
- Для store/register/camera `code` показывать как технический идентификатор интеграций.
- При редактировании RTSP показывать masked value в списке, раскрывать реальный URL только через отдельное действие и роль.
- Все destructive или status-changing actions подтверждать явно, кроме обычного acknowledge notification.
- В таблицах сохранять page/filter/sort в URL query, чтобы менеджеры могли делиться ссылками.
- Для polling кассы использовать backoff при ошибках и не делать частоту чаще 3 секунд, если WebSocket доступен.

## 24. Известные ограничения текущего backend

- Generic CRUD create/update почти напрямую передает body в Prisma. Фронт должен отправлять валидные поля модели.
- Store create требует `code` и `address`; если не отправить `code`, будет Prisma validation error.
- Generic list query schema шире, чем фактически применяемый `where` в CRUD service.
- `/api/v1/reports/:id/download` возвращает объект report, а не binary download.
- Integration errors пока не имеют специализированных `retry`/`resolve` endpoints.
- Frontend ROI patch обновляет только `cashierRoi`, `scanRoi`, `customerRoi`.
- Некоторые analytics endpoints требуют API key и не предназначены для browser UI.
