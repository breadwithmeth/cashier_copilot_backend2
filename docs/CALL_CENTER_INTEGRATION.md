# Документация для интеграции Call Center

Этот документ описывает контракт обмена между Call Center системой и backend. Интеграция передает звонки, записи разговоров, статусы агентов и сопутствующие события.

## Назначение интеграции

Backend сопоставляет данные Call Center с видео- и аудиоаналитикой:

- Запись звонка (аудио).
- Видеонаблюдение рабочего места агента.
- Идентификация агента (по `employeeExternalId`).
- Статусы звонка (начало, завершение, перевод).
- Оценка качества обслуживания (speech analytics).

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

- Для звонков: `externalEventId`.
- Дополнительно: `idempotencyKey`.

При повторной отправке того же события backend не должен создавать дубликаты.

Рекомендуемый формат:

```text
<source>:<storeCode>:<agentExternalId>:<callId>:<timestamp>
```

Примеры:

```text
callcenter:cc-almaty-01:agent-12:call-2026-000123:1720885000000
```

## Correlation ID

Если Call Center система может передать общий идентификатор операции, используйте `correlationId`.

Backend также коррелирует по:

- `storeCode`
- `cameraCode`
- времени события
- текущей смене
- сотруднику
- session

Но наличие `correlationId` повышает качество сопоставления.

## Call Center ingestion

Endpoint:

```http
POST /api/v1/integrations/pos-events
```

Batch:

```text
POST /api/v1/integrations/pos-events/batch
```

Batch принимает до 500 записей:

```json
{
  "records": []
}
```

### Call Center payload

```json
{
  "externalEventId": "callcenter-2026-07-13-000123",
  "idempotencyKey": "callcenter-2026-07-13-000123",
  "storeCode": "cc-almaty-01",
  "registerCode": "cc-cam-01",
  "operationType": "SHIFT_OPENED",
  "occurredAt": "2026-07-13T12:00:00.000Z",
  "correlationId": "call-2026-000123",
  "payload": {
    "agentExternalId": "agent-12",
    "callId": "call-2026-000123",
    "direction": "INBOUND",
    "durationSeconds": 180
  }
}
```

### Required fields

```text
externalEventId
storeCode
registerCode
operationType
occurredAt
payload
```

### Operation types

```text
SHIFT_OPENED
SHIFT_CLOSED
RECEIPT_OPENED
RECEIPT_COMPLETED
```

## Рекомендуемый порядок отправки

Идеально:

1. `SHIFT_OPENED` (начало смены агента)
2. `RECEIPT_OPENED` (начало звонка)
3. `RECEIPT_COMPLETED` (завершение звонка)
4. `SHIFT_CLOSED` (конец смены агента)

Допускается out-of-order доставка. Backend сохраняет raw events и коррелирует позже.

## Возвраты, отмены и void

Для возврата звонка или перевода:

```json
{
  "externalEventId": "call-transfer-000123",
  "storeCode": "cc-almaty-01",
  "registerCode": "cc-cam-01",
  "operationType": "RETURN_STARTED",
  "occurredAt": "2026-07-13T13:00:00.000Z",
  "correlationId": "call-2026-000123",
  "payload": {
    "originalCallId": "call-2026-000123",
    "reason": "transfer_to_supervisor"
  }
}
```

Затем отправьте чек с:

```json
{
  "operationType": "RETURN",
  "status": "RETURNED",
  "originalReceiptId": "call-2026-000123"
}
```

Если во время звонка видеоаналитика видит отсутствие агента на рабочем месте, backend создает high-risk событие для ручной проверки.

## Платежи и сдача

Для звонков не применимо, но если происходит продажа по телефону:

```text
paidAmount
expectedChangeAmount
actualChangeAmount
paymentMethod = CARD
```

Backend сравнивает:

- сумму чека;
- обнаруженную сумму оплаты;
- ожидаемую сдачу;
- фактическую сдачу;
- объявление суммы и сдачи в speech events.

## Containers and packaging

Не применимо для Call Center.

## Receiving documents

Не применимо для Call Center.

## Справочники

Перед отправкой событий должны существовать:

- Store с `code` (тип `CALL_CENTER`).
- Camera для analytics-сопоставления.
- Employee с `externalId` (агент).

Seed создает:

```text
storeCode: cc-almaty-01
cameraCode: cc-cam-01
employeeExternalId: agent-12
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

## Safe logging в Call Center адаптере

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
curl -X POST http://localhost:3000/api/v1/integrations/pos-events \
  -H "Content-Type: application/json" \
  -H "x-api-key: integration_key_REPLACE_ME" \
  -d '{
    "externalEventId": "callcenter-2026-07-13-000123",
    "idempotencyKey": "callcenter-2026-07-13-000123",
    "storeCode": "cc-almaty-01",
    "registerCode": "cc-cam-01",
    "operationType": "SHIFT_OPENED",
    "occurredAt": "2026-07-13T12:00:00.000Z",
    "correlationId": "call-2026-000123",
    "payload": {
      "agentExternalId": "agent-12",
      "callId": "call-2026-000123",
      "direction": "INBOUND",
      "durationSeconds": 180
    }
  }'
```

## Checklist готовности Call Center

- У каждого call center есть стабильный `storeCode`.
- У каждого агента есть `employeeExternalId`.
- Все события имеют `externalEventId`.
- Время отправляется в UTC.
- Batch не превышает 500 записей.
- API key хранится безопасно.
- Повторы отправки используют тот же idempotency key.
- Переводы/отмены отправляются отдельными событиями, а не затирают старый звонок.
