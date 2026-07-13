# Документация для интеграции 1С и POS

Этот документ описывает контракт обмена между 1С/POS и backend. Интеграция передает чеки, POS-события, смены, платежи, возвраты, отмены, void-операции и документы приемки.

## Назначение интеграции

Backend сопоставляет данные 1С/POS с видео- и аудиоаналитикой:

- Чек и позиции чека.
- Сканирования товаров.
- Удаления товаров.
- Возвраты, отмены, void.
- Платежи и сдача.
- Смены и сотрудники.
- Документы приемки.
- Ожидаемые и фактические количества.

Backend не подтверждает нарушения автоматически. Он создает подозрительное событие для проверки человеком.

## Базовый URL

```text
http://localhost:3000/api/v1
```

Swagger:

```text
http://localhost:3000/docs
```

## Авторизация

Все интеграционные запросы используют API key:

```http
x-api-key: <integration_api_key>
Content-Type: application/json
```

Seed выводит ключ в консоль:

```text
Integration service API key: integration_key_...
```

API key хранится в backend только как hash. Повторно получить raw key невозможно.

## Idempotency

Каждое внешнее событие должно иметь стабильный идентификатор:

- Для чеков: `externalId`.
- Для POS events: `externalEventId`.
- Дополнительно: `idempotencyKey`.

При повторной отправке того же события backend не должен создавать дубликаты.

Рекомендуемый формат:

```text
<source>:<storeCode>:<registerCode>:<businessObjectId>:<version-or-timestamp>
```

Примеры:

```text
1c:tolstogo-90:register-1:receipt-2026-000123:v1
pos:tolstogo-90:register-1:scan:1720885000000:line-2
```

## Correlation ID

Если POS/1C может передать общий идентификатор операции обслуживания, используйте `correlationId`.

Backend также коррелирует по:

- `storeCode`
- `registerCode`
- времени события
- текущей смене
- сотруднику
- чеку
- session

Но наличие `correlationId` повышает качество сопоставления.

## Receipt ingestion

Endpoint:

```http
POST /api/v1/integrations/receipts
```

Batch:

```http
POST /api/v1/integrations/receipts/batch
```

Batch принимает до 500 записей:

```json
{
  "records": []
}
```

### Receipt payload

```json
{
  "externalId": "receipt-2026-000123",
  "receiptNumber": "000123",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "employeeExternalId": "employee-45",
  "operationType": "SALE",
  "status": "COMPLETED",
  "openedAt": "2026-07-13T12:00:00.000Z",
  "completedAt": "2026-07-13T12:02:10.000Z",
  "paymentMethod": "CASH",
  "subtotalAmount": 5400,
  "discountAmount": 0,
  "totalAmount": 5400,
  "paidAmount": 6000,
  "expectedChangeAmount": 600,
  "actualChangeAmount": 600,
  "currency": "KZT",
  "items": [
    {
      "productCode": "BEER-001",
      "barcode": "1234567890",
      "productName": "Beer",
      "quantity": 2,
      "unit": "pcs",
      "unitPrice": 2000,
      "discountAmount": 0,
      "totalAmount": 4000,
      "isContainer": false,
      "metadata": {}
    },
    {
      "productCode": "CONTAINER-1L",
      "barcode": "9876543210",
      "productName": "Plastic container",
      "quantity": 1,
      "unit": "pcs",
      "unitPrice": 200,
      "discountAmount": 0,
      "totalAmount": 200,
      "isContainer": true,
      "containerType": "PLASTIC_CONTAINER",
      "metadata": {}
    }
  ],
  "metadata": {
    "source": "1C",
    "cashierWorkstation": "POS-01"
  }
}
```

### Required fields

```text
externalId
receiptNumber
storeCode
registerCode
operationType
status
openedAt
paymentMethod
subtotalAmount
totalAmount
paidAmount
items
```

### Operation types

```text
SALE
RETURN
CANCELLATION
VOID
RECEIPT_CORRECTION
```

### Receipt statuses

```text
OPEN
COMPLETED
CANCELLED
VOIDED
RETURNED
PARTIALLY_RETURNED
```

### Payment methods

```text
CASH
CARD
BONUS
MIXED
QR
OTHER
```

## Receipt version history

Если 1С отправляет обновление уже известного `externalId`, backend:

- увеличивает `version`;
- сохраняет новый `ReceiptVersion`;
- не удаляет исторический payload;
- обновляет текущую проекцию чека.

Используйте это для:

- исправлений чека;
- поздней доставки payment data;
- изменений статуса;
- возвратов и отмен.

## POS events

Endpoint:

```http
POST /api/v1/integrations/pos-events
```

Batch:

```http
POST /api/v1/integrations/pos-events/batch
```

Payload:

```json
{
  "externalEventId": "pos-2026-07-13-000001",
  "idempotencyKey": "pos-2026-07-13-000001",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "PRODUCT_SCANNED",
  "occurredAt": "2026-07-13T12:00:15.000Z",
  "correlationId": "receipt-2026-000123",
  "productCode": "BEER-001",
  "barcode": "1234567890",
  "quantity": 1,
  "amount": 2000,
  "payload": {
    "lineNumber": 1,
    "operator": "employee-45"
  }
}
```

### POS operation types

```text
RECEIPT_OPENED
PRODUCT_SCANNED
PRODUCT_MANUALLY_ADDED
PRODUCT_REMOVED
RECEIPT_COMPLETED
RECEIPT_CANCELLED
VOID
RETURN_STARTED
RETURN_COMPLETED
PAYMENT_STARTED
PAYMENT_COMPLETED
CASH_RECEIVED
CHANGE_CALCULATED
CASH_DRAWER_OPENED
SHIFT_OPENED
SHIFT_CLOSED
```

## Рекомендуемый порядок отправки

Идеально:

1. `RECEIPT_OPENED`
2. `PRODUCT_SCANNED` для каждой позиции
3. `PRODUCT_REMOVED`, если кассир удалил позицию
4. `PAYMENT_STARTED`
5. `CASH_RECEIVED` или карточное событие
6. `CHANGE_CALCULATED`, если cash
7. `PAYMENT_COMPLETED`
8. `RECEIPT_COMPLETED`
9. `POST /integrations/receipts`

Допускается out-of-order доставка. Backend сохраняет raw events и коррелирует позже.

## Возвраты, отмены и void

Для возврата:

```json
{
  "externalEventId": "return-start-000123",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "RETURN_STARTED",
  "occurredAt": "2026-07-13T13:00:00.000Z",
  "correlationId": "return-receipt-2026-000777",
  "payload": {
    "originalReceiptExternalId": "receipt-2026-000123",
    "reason": "customer_return"
  }
}
```

Затем отправьте чек с:

```json
{
  "operationType": "RETURN",
  "status": "RETURNED",
  "originalReceiptId": "receipt-2026-000123"
}
```

Если во время возврата/void видеоаналитика видит передачу товара клиенту, backend создает high-risk событие для ручной проверки.

## Платежи и сдача

Для наличных важно передавать:

```text
paidAmount
expectedChangeAmount
actualChangeAmount
paymentMethod = CASH
```

Backend сравнивает:

- сумму чека;
- обнаруженную сумму оплаты;
- ожидаемую сдачу;
- фактическую сдачу;
- объявление суммы и сдачи в speech events.

## Containers and packaging

Если тара или контейнер должны быть в чеке:

```json
{
  "productCode": "CONTAINER-1L",
  "productName": "Plastic container",
  "quantity": 1,
  "unit": "pcs",
  "unitPrice": 200,
  "totalAmount": 200,
  "isContainer": true,
  "containerType": "PLASTIC_CONTAINER"
}
```

Если видео видит передачу контейнера, но его нет в чеке, backend создает medium-risk событие.

## Receiving documents

Запланированный endpoint:

```http
POST /api/v1/integrations/receiving-documents
```

В текущей реализации generic CRUD route доступен как:

```http
POST /api/v1/receiving-documents
Authorization: Bearer <admin JWT>
```

Рекомендуемый интеграционный payload для адаптера:

```json
{
  "externalId": "recv-doc-2026-0001",
  "documentNumber": "ПН-0001",
  "documentDate": "2026-07-13T00:00:00.000Z",
  "storeCode": "tolstogo-90",
  "supplierExternalId": "supplier-001",
  "status": "EXPECTED",
  "expectedTotalQuantity": 120,
  "items": [
    {
      "externalItemId": "line-1",
      "productCode": "MILK-001",
      "barcode": "460000000001",
      "productName": "Milk 1L",
      "expectedQuantity": 40,
      "unit": "pcs",
      "expirationDate": "2026-08-01T00:00:00.000Z",
      "batchNumber": "BATCH-001"
    }
  ],
  "metadata": {}
}
```

Для production-интеграции стоит добавить dedicated endpoint по аналогии с receipt ingestion, чтобы принимать `storeCode` и `supplierExternalId`, а не внутренние IDs.

## Справочники

Перед отправкой событий должны существовать:

- Store с `code`.
- Register с `code` внутри store.
- Employee с `externalId`.
- Camera для analytics-сопоставления.

Seed создает:

```text
storeCode: tolstogo-90
registerCode: register-1
employeeExternalId: employee-45
cameraCode: cam10
```

## Time and timezone

Передавайте время в UTC:

```text
2026-07-13T12:00:00.000Z
```

Не передавайте локальное время без timezone.

## Retry policy

Рекомендуется:

- Retry на `5xx`.
- Retry на network timeout.
- Не retry бесконечно на `400`.
- На `401/403` проверить API key и permissions.
- На `409` считать событие уже доставленным, если idempotency совпадает.

Backoff:

```text
1s, 5s, 15s, 60s, 5m
```

## Safe logging в 1С/POS адаптере

Логировать:

- endpoint;
- externalId/externalEventId;
- status code;
- request duration;
- error code/message.

Не логировать:

- API key;
- персональные данные сверх необходимого;
- raw payment sensitive data, если это запрещено политикой.

## Проверка интеграции curl

```bash
curl -X POST http://localhost:3000/api/v1/integrations/receipts \
  -H "Content-Type: application/json" \
  -H "x-api-key: integration_key_REPLACE_ME" \
  -d '{
    "externalId": "receipt-2026-000123",
    "receiptNumber": "000123",
    "storeCode": "tolstogo-90",
    "registerCode": "register-1",
    "employeeExternalId": "employee-45",
    "operationType": "SALE",
    "status": "COMPLETED",
    "openedAt": "2026-07-13T12:00:00.000Z",
    "completedAt": "2026-07-13T12:02:10.000Z",
    "paymentMethod": "CASH",
    "subtotalAmount": 5400,
    "discountAmount": 0,
    "totalAmount": 5400,
    "paidAmount": 6000,
    "expectedChangeAmount": 600,
    "actualChangeAmount": 600,
    "currency": "KZT",
    "items": [],
    "metadata": {}
  }'
```

## Checklist готовности 1С/POS

- У каждого магазина есть стабильный `storeCode`.
- У каждой кассы есть стабильный `registerCode`.
- У сотрудника есть `employeeExternalId`.
- Все события имеют `externalEventId`.
- Все чеки имеют `externalId`.
- Время отправляется в UTC.
- Batch не превышает 500 записей.
- API key хранится безопасно.
- Повторы отправки используют тот же idempotency key.
- Возвраты/void/отмены отправляются отдельными событиями, а не затирают старый чек.

