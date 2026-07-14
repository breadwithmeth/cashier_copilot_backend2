# Документация для фронтенда

Этот документ описывает, как фронтенд должен работать с backend API кассового AI-мониторинга: авторизация, роли, основные экраны, REST-контракты, WebSocket-уведомления, обработка ошибок и ограничения безопасности.

## Базовые адреса

Локально:

```text
API: http://localhost:3000
REST prefix: /api/v1
Swagger: http://localhost:3000/docs
Health: http://localhost:3000/health
Ready: http://localhost:3000/ready
```

Все даты и времена backend хранит и возвращает в UTC ISO-8601.

## Авторизация

Фронтенд для пользователей использует JWT.

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "admin@example.com",
  "password": "Password123!"
}
```

Ответ:

```json
{
  "user": {
    "id": "user_id",
    "email": "admin@example.com",
    "firstName": "ADMIN",
    "lastName": "User",
    "role": "ADMIN",
    "isActive": true,
    "lastLoginAt": "2026-07-13T17:00:00.000Z",
    "createdAt": "2026-07-13T17:00:00.000Z",
    "updatedAt": "2026-07-13T17:00:00.000Z"
  },
  "accessToken": "jwt_access",
  "refreshToken": "jwt_refresh"
}
```

`passwordHash` и `refreshTokenHash` никогда не возвращаются.

### Refresh

```http
POST /api/v1/auth/refresh
Content-Type: application/json
```

```json
{
  "refreshToken": "jwt_refresh"
}
```

### Logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
```

### Current user

```http
GET /api/v1/auth/me
Authorization: Bearer <accessToken>
```

## Хранение токенов на фронтенде

Рекомендуемый вариант:

- `accessToken` держать в памяти приложения.
- `refreshToken` хранить в защищенном storage, если нет cookie-based auth.
- При `401` один раз выполнить refresh и повторить исходный запрос.
- При повторном `401` очистить сессию и отправить пользователя на login.

## Роли и доступ

Backend возвращает роль пользователя в `user.role`.

Ключевые сценарии UI:

| Роль | UI-доступ |
| --- | --- |
| `SUPER_ADMIN` | Все экраны и настройки |
| `ADMIN` | Пользователи, магазины, кассы, камеры, правила, интеграции |
| `OPERATIONS_DIRECTOR` | Дашборды, отчеты, нарушения, аналитика по всем магазинам |
| `REGIONAL_MANAGER` | Дашборды и отчеты по разрешенным городам/магазинам |
| `STORE_MANAGER` | Магазин, сотрудники, смены, нарушения, приемка, отчеты |
| `QUALITY_CONTROL` | Разбор нарушений, доказательства, service evaluations |
| `HR` | Service quality, коммуникация, повторяющиеся low-risk события |
| `ANALYST` | Read-only аналитика и отчеты |
| `OPERATOR` | Очередь алертов и нарушений |
| `EMPLOYEE` | Только собственные уведомления рабочего места |
| `VIEWER` | Read-only по разрешенным магазинам |

Важно: AI-события являются подозрениями. UI не должен показывать их как доказанную вину до решения человека.

## Общий формат списков

Большинство list endpoints поддерживают:

```text
page
limit
sortBy
sortOrder
search
createdFrom
createdTo
city
storeId
registerId
cameraId
employeeId
shiftId
sessionId
receiptId
receiptNumber
operationType
status
severity
eventType
violationType
mediaType
source
supplierId
evidenceStatus
```

Максимальный `limit`: `100`.

Пример:

```http
GET /api/v1/violations?page=1&limit=25&severity=HIGH&status=NEW&storeId=store_id
Authorization: Bearer <accessToken>
```

Типовой ответ:

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

## Обработка ошибок

Backend возвращает безопасные ошибки:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid request",
  "details": {}
}
```

Типовые статусы:

- `400` - ошибка валидации.
- `401` - нет токена, токен истек или API key невалиден.
- `403` - роль или доступ к магазину запрещены.
- `404` - сущность не найдена.
- `409` - конфликт уникальности или idempotency.
- `500` - внутренняя ошибка без stack trace в production.

## Основные экраны

### Login

Использует:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### Dashboard

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

Рекомендуемые виджеты:

- Всего чеков.
- Проверенные чеки.
- High-risk отклонения.
- Возможная финансовая сумма риска.
- Ошибки интеграции.
- Доступность видео и аудио.
- Service score.
- Приемка с расхождениями.
- False-positive rate.
- Среднее время review.

### Stores, registers, cameras

Endpoints:

```text
GET /api/v1/stores
GET /api/v1/stores/:id
POST /api/v1/stores
PATCH /api/v1/stores/:id

GET /api/v1/registers
GET /api/v1/registers/:id
POST /api/v1/registers
PATCH /api/v1/registers/:id

GET /api/v1/cameras
GET /api/v1/cameras/:id
POST /api/v1/cameras
PATCH /api/v1/cameras/:id
POST /api/v1/cameras/:id/stream-credentials
POST /api/v1/cameras/:id/roi-reference-image
GET  /api/v1/cameras/:id/roi-reference-image
GET  /api/v1/cameras/:id/rois
PATCH /api/v1/cameras/:id/rois
```

Обычные camera endpoints маскируют RTSP:

```json
{
  "videoRtspUrl": "rtsp://user:***@host/video",
  "audioRtspUrl": "rtsp://user:***@host/audio"
}
```

`POST /api/v1/cameras/:id/stream-credentials` возвращает реальные URL и создает audit log. Показывать этот экран только администраторам.

### ROI разметка камеры

Фронтенд должен позволять разметить на reference image три типа зон:

- `cashierRoi` - зона кассира.
- `scanRoi` - зона сканера/сканирования.
- `customerRoi` - зона покупателя.

Картинку обычно загружает Python analytics-сервис из видеопотока. Администратор также может загрузить ее вручную:

```http
POST /api/v1/cameras/:id/roi-reference-image
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

Form fields:

```text
file: image/jpeg | image/png | image/webp
width: optional number
height: optional number
capturedAt: optional ISO datetime
```

Получить картинку:

```http
GET /api/v1/cameras/:id/roi-reference-image
Authorization: Bearer <accessToken>
```

Получить текущую разметку:

```http
GET /api/v1/cameras/:id/rois
Authorization: Bearer <accessToken>
```

Сохранить полигоны:

```http
PATCH /api/v1/cameras/:id/rois
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "image": {
    "id": "image_id",
    "width": 1920,
    "height": 1080,
    "capturedAt": "2026-07-14T10:00:00.000Z"
  },
  "cashierRoi": [
    {
      "label": "cashier-main",
      "points": [
        { "x": 0.12, "y": 0.18 },
        { "x": 0.38, "y": 0.18 },
        { "x": 0.39, "y": 0.78 },
        { "x": 0.1, "y": 0.8 }
      ],
      "metadata": {}
    }
  ],
  "scanRoi": [
    {
      "label": "scanner",
      "points": [
        { "x": 0.42, "y": 0.44 },
        { "x": 0.58, "y": 0.44 },
        { "x": 0.58, "y": 0.62 },
        { "x": 0.42, "y": 0.62 }
      ],
      "metadata": {}
    }
  ],
  "customerRoi": [
    {
      "label": "customer-area",
      "points": [
        { "x": 0.62, "y": 0.15 },
        { "x": 0.96, "y": 0.15 },
        { "x": 0.96, "y": 0.9 },
        { "x": 0.62, "y": 0.9 }
      ],
      "metadata": {}
    }
  ]
}
```

Координаты нормализованные: `0..1`, где `x=0,y=0` - левый верхний угол изображения, `x=1,y=1` - правый нижний.

UI-рекомендации:

- Хранить полигоны в normalized coordinates, а не в пикселях.
- При изменении размера canvas пересчитывать только отображение.
- Требовать минимум 3 точки на polygon.
- Разрешить несколько полигонов на одну ROI-группу.
- Перед сохранением валидировать, что точки не выходят за `0..1`.
- Показывать отдельные цвета для `cashierRoi`, `scanRoi`, `customerRoi`.

### Employees and shifts

```text
GET /api/v1/employees
GET /api/v1/shifts
```

Фильтры: `storeId`, `registerId`, `employeeId`, `status`, `createdFrom`, `createdTo`.

### Receipts

```text
GET /api/v1/receipts
GET /api/v1/receipts/:id
GET /api/v1/receipts/:id/timeline
```

Карточка чека должна показывать:

- Магазин и кассу.
- Номер чека.
- Тип операции: `SALE`, `RETURN`, `CANCELLATION`, `VOID`, `RECEIPT_CORRECTION`.
- Статус.
- Суммы: subtotal, discount, total, paid, expectedChange, actualChange.
- Payment method.
- Employee/shift.
- Связанные нарушения.
- Timeline.

### Checkout sessions

```text
GET /api/v1/checkout-sessions
GET /api/v1/checkout-sessions/:id
GET /api/v1/checkout-sessions/:id/timeline
```

Timeline объединяет:

- POS операции.
- Video/audio analytics events.
- Speech events.
- Cashier actions.
- Reconciliation.
- Violations.
- Reviews.
- Evidence clips.
- Payments.
- Notifications.

### Violations

Endpoints:

```text
GET /api/v1/violations
GET /api/v1/violations/:id
POST /api/v1/violations/:id/assign
POST /api/v1/violations/:id/review
POST /api/v1/violations/:id/confirm
POST /api/v1/violations/:id/reject
POST /api/v1/violations/:id/false-positive
POST /api/v1/violations/:id/corrected
POST /api/v1/violations/:id/escalate
POST /api/v1/violations/:id/resolve
```

Review request:

```json
{
  "decision": "CONFIRM",
  "comment": "На видео подтверждается передача товара без сканирования."
}
```

Allowed `decision`:

```text
CONFIRM
REJECT
FALSE_POSITIVE
REQUEST_MORE_INFORMATION
MARK_CORRECTED
ESCALATE
RESOLVE
```

Статусы:

```text
NEW
IN_PROGRESS
CONFIRMED
REJECTED
FALSE_POSITIVE
CORRECTED
RESOLVED
ESCALATED_TO_MANAGER
ESCALATED_TO_HR
ESCALATED_TO_QUALITY_CONTROL
IGNORED
```

UI-правило: `NEW` и `IN_PROGRESS` показывать как “требует проверки”, а не как подтвержденное нарушение.

### Evidence clips

```text
GET /api/v1/evidence-clips
GET /api/v1/evidence-clips/:id
GET /api/v1/evidence-clips/:id/playback
POST /api/v1/evidence-clips/:id/regenerate
```

Playback URL запрашивать только при открытии просмотра. Не хранить URL в localStorage.

### Employee notifications

```text
GET /api/v1/employee-notifications
POST /api/v1/employee-notifications/:id/acknowledge
POST /api/v1/employee-notifications/:id/dismiss
POST /api/v1/employee-notifications/:id/corrected
```

Сообщения для кассира не должны блокировать POS-операцию.

Для polling по конкретной кассе используйте enriched endpoint:

```text
GET /api/v1/registers/:id/violation-notifications
GET /api/v1/stores/:storeCode/registers/:registerCode/violation-notifications
```

Пример:

```http
GET /api/v1/stores/tolstogo-90/registers/register-1/violation-notifications?markDelivered=true
```

Query params:

```text
limit=50
status=PENDING,DELIVERED,DISPLAYED
markDelivered=true
```

Ответ содержит notification, violation, store/register/camera/employee/receipt и evidence metadata.

Эти два endpoint специально открыты без JWT/API key для кассового экрана. Остальные notification workflow endpoints, включая acknowledge/dismiss/corrected, требуют авторизацию.

Если в речи кассира найден мат, уведомление придет с `type = profanity-detected`, а внутри `violation.violationType` также будет `profanity-detected`.

### Workstation WebSocket

```text
ws://localhost:3000/api/v1/workstations/:workstationId/notifications
```

Пример сообщения:

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

- Подключаться по `workstationId`.
- Показывать `TOAST`, `BANNER` или `MODAL_NON_BLOCKING`.
- Вызывать acknowledge/dismiss/corrected.
- Автоматически переподключаться с backoff.

### Service quality

```text
GET /api/v1/service-standards
GET /api/v1/service-evaluations
GET /api/v1/service-evaluations/:id
```

Важно:

- `NOT_REQUIRED` не снижает score.
- `NOT_DETERMINED` показывать отдельно.
- HR UI не должен показывать чувствительные платежные данные без отдельного разрешения.

### Receiving

```text
GET /api/v1/receiving-documents
GET /api/v1/receiving-sessions
GET /api/v1/receiving-sessions/:id
GET /api/v1/receiving-sessions/:id/timeline
```

Показывать:

- Документ поставки.
- Ожидаемое количество.
- Фактическое/детектированное количество.
- Расхождение.
- Проверка срока годности.
- Проверка упаковки.
- Отделены ли поврежденные товары.
- Зафиксировано ли расхождение.

### Integration errors

```text
GET /api/v1/integration-errors
POST /api/v1/integration-errors/:id/retry
POST /api/v1/integration-errors/:id/resolve
```

Экран полезен для поддержки интеграций 1С/POS/analytics.

### Reports

```text
POST /api/v1/reports/generate
GET /api/v1/reports
GET /api/v1/reports/:id
GET /api/v1/reports/:id/download
```

Generate:

```json
{
  "type": "daily_violation",
  "format": "json",
  "filters": {
    "storeId": "store_id",
    "createdFrom": "2026-07-13T00:00:00.000Z",
    "createdTo": "2026-07-14T00:00:00.000Z"
  }
}
```

## Recommended frontend state model

Минимальные сущности:

```ts
type AuthState = {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
};

type ListState<T> = {
  data: T[];
  page: number;
  limit: number;
  total: number;
  loading: boolean;
  filters: Record<string, string | number | boolean | undefined>;
};
```

## Security checklist для фронтенда

- Не показывать raw RTSP обычным пользователям.
- Не сохранять playback URL доказательств надолго.
- Не показывать `passwordHash`, `keyHash`, `refreshTokenHash`.
- Не показывать платежные sensitive поля HR без разрешения.
- Не называть `NEW` violation “доказанным нарушением”.
- Всегда показывать review history в карточке нарушения.
- Все destructive/workflow actions подтверждать через modal.
- Логировать request id из ответа/ошибки, если он добавлен reverse proxy.
