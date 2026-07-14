# Полная инструкция по интеграции 1С с Cashier Copilot Backend

Документ описывает, как подключить 1С или POS-адаптер к backend: какие данные отправлять, когда отправлять, как формировать JSON, как хранить очередь отправки, как обрабатывать ошибки и как проверить интеграцию.

## 1. Что должна делать 1С

1С передает в backend фактические учетные данные по кассе:

- открытие чека;
- сканирование товара;
- ручное добавление товара;
- удаление товара из чека;
- оплату;
- получение наличных;
- расчет сдачи;
- завершение чека;
- отмену чека;
- возврат;
- void-операции;
- итоговый чек со всеми позициями;
- документы приемки, если приемка ведется в 1С.

Backend сопоставляет эти данные с видео- и аудиоаналитикой. Например:

- 1С говорит: товар отсканирован.
- Python analytics говорит: товар передан покупателю.
- Backend сравнивает оба факта.
- Если товар передан, но в чеке его нет, backend создает подозрение.
- Человек в интерфейсе подтверждает или отклоняет подозрение.

Важно: backend не назначает штрафы и не подтверждает нарушения автоматически.

## 2. Адрес backend

Локально:

```text
http://localhost:3000/api/v1
```

Swagger:

```text
http://localhost:3000/docs
```

Production URL должен быть выдан администратором.

## 3. API key

Все запросы от 1С идут с HTTP header:

```http
x-api-key: <integration api key>
Content-Type: application/json
```

Ключ лежит в `.env` backend:

```env
INTEGRATION_API_KEY=integration_key_...
```

В запросе из 1С:

```text
x-api-key: integration_key_...
```

Не логируйте API key в 1С.

## 4. Справочники, которые должны совпадать

Перед отправкой чеков и событий в backend должны быть заведены одинаковые коды.

### Магазин

В backend:

```text
Store.code = tolstogo-90
```

В 1С нужно хранить такой же код магазина:

```text
storeCode = tolstogo-90
```

### Касса

В backend:

```text
Register.code = register-1
```

В 1С:

```text
registerCode = register-1
```

Код кассы уникален внутри магазина.

### Сотрудник

В backend:

```text
Employee.externalId = employee-45
```

В 1С:

```text
employeeExternalId = employee-45
```

### Минимальные seed-значения

После seed уже есть:

```text
storeCode: tolstogo-90
registerCode: register-1
employeeExternalId: employee-45
```

## 5. Главное правило корреляции

Для одного обслуживания покупателя используйте один общий `correlationId`.

Рекомендуется:

```text
correlationId = externalId чека
```

Пример:

```text
externalId = receipt-2026-000123
correlationId = receipt-2026-000123
```

Так backend проще связывает:

- POS events;
- итоговый чек;
- видеоаналитику;
- аудиоаналитику;
- checkout session;
- нарушения;
- evidence clips.

## 6. Idempotency

Каждое событие должно иметь постоянный уникальный идентификатор.

Для чека:

```text
externalId
```

Для POS-события:

```text
externalEventId
idempotencyKey
```

Если 1С отправляет событие повторно, значения должны быть теми же. Тогда backend не создаст дубликат.

Хороший формат:

```text
1c:<storeCode>:<registerCode>:<operation>:<document-id>:<line-or-timestamp>
```

Пример:

```text
1c:tolstogo-90:register-1:product-scanned:receipt-2026-000123:line-1
```

## 7. Время

Всегда отправляйте время в UTC ISO-8601:

```text
2026-07-14T08:10:00.000Z
```

Не отправляйте локальное время без timezone.

Если в 1С время локальное, адаптер должен преобразовать его в UTC.

## 8. Какие endpoints использует 1С

### POS events

Для событий кассы:

```http
POST /api/v1/integrations/pos-events
```

Batch:

```http
POST /api/v1/integrations/pos-events/batch
```

### Итоговый чек

Для полного чека:

```http
POST /api/v1/integrations/receipts
```

Batch:

```http
POST /api/v1/integrations/receipts/batch
```

Batch принимает максимум 500 записей.

## 9. Рекомендуемый порядок отправки событий

Для обычной продажи:

1. `RECEIPT_OPENED`
2. `PRODUCT_SCANNED` для каждой отсканированной позиции
3. `PRODUCT_MANUALLY_ADDED`, если товар добавлен вручную
4. `PRODUCT_REMOVED`, если позиция удалена
5. `PAYMENT_STARTED`
6. `CASH_RECEIVED`, если наличные
7. `CHANGE_CALCULATED`, если наличные и есть сдача
8. `PAYMENT_COMPLETED`
9. `RECEIPT_COMPLETED`
10. `POST /integrations/receipts` с полным чеком

Если 1С может отправить только итоговый чек, это допустимо, но качество корреляции будет ниже. Лучший вариант - отправлять и POS events, и полный чек.

## 10. POS operation types

Backend принимает такие `operationType` для POS events:

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

## 11. Пример: открыт чек

```bash
curl -X POST http://localhost:3000/api/v1/integrations/pos-events \
  -H "Content-Type: application/json" \
  -H "x-api-key: integration_key_REPLACE_ME" \
  -d '{
    "externalEventId": "1c:tolstogo-90:register-1:receipt-opened:receipt-2026-000123",
    "idempotencyKey": "1c:tolstogo-90:register-1:receipt-opened:receipt-2026-000123",
    "storeCode": "tolstogo-90",
    "registerCode": "register-1",
    "operationType": "RECEIPT_OPENED",
    "occurredAt": "2026-07-14T08:10:00.000Z",
    "correlationId": "receipt-2026-000123",
    "payload": {
      "receiptExternalId": "receipt-2026-000123",
      "receiptNumber": "000123",
      "cashierExternalId": "employee-45",
      "source": "1C"
    }
  }'
```

## 12. Пример: товар отсканирован

```bash
curl -X POST http://localhost:3000/api/v1/integrations/pos-events \
  -H "Content-Type: application/json" \
  -H "x-api-key: integration_key_REPLACE_ME" \
  -d '{
    "externalEventId": "1c:tolstogo-90:register-1:product-scanned:receipt-2026-000123:line-1",
    "idempotencyKey": "1c:tolstogo-90:register-1:product-scanned:receipt-2026-000123:line-1",
    "storeCode": "tolstogo-90",
    "registerCode": "register-1",
    "operationType": "PRODUCT_SCANNED",
    "occurredAt": "2026-07-14T08:10:05.000Z",
    "correlationId": "receipt-2026-000123",
    "productCode": "BEER-001",
    "barcode": "1234567890",
    "quantity": 1,
    "amount": 2000,
    "payload": {
      "receiptExternalId": "receipt-2026-000123",
      "receiptNumber": "000123",
      "lineNumber": 1,
      "productName": "Beer",
      "unit": "pcs",
      "unitPrice": 2000,
      "cashierExternalId": "employee-45",
      "source": "1C"
    }
  }'
```

## 13. Пример: товар добавлен вручную

Используйте, если кассир добавил товар без сканера.

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:manual-add:receipt-2026-000123:line-2",
  "idempotencyKey": "1c:tolstogo-90:register-1:manual-add:receipt-2026-000123:line-2",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "PRODUCT_MANUALLY_ADDED",
  "occurredAt": "2026-07-14T08:10:10.000Z",
  "correlationId": "receipt-2026-000123",
  "productCode": "BREAD-001",
  "barcode": "460000000001",
  "quantity": 1,
  "amount": 350,
  "payload": {
    "receiptExternalId": "receipt-2026-000123",
    "lineNumber": 2,
    "productName": "Bread",
    "reason": "barcode_not_readable"
  }
}
```

## 14. Пример: товар удален из чека

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:product-removed:receipt-2026-000123:line-2",
  "idempotencyKey": "1c:tolstogo-90:register-1:product-removed:receipt-2026-000123:line-2",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "PRODUCT_REMOVED",
  "occurredAt": "2026-07-14T08:10:20.000Z",
  "correlationId": "receipt-2026-000123",
  "productCode": "BREAD-001",
  "barcode": "460000000001",
  "quantity": 1,
  "amount": 350,
  "payload": {
    "receiptExternalId": "receipt-2026-000123",
    "lineNumber": 2,
    "reason": "customer_refused"
  }
}
```

## 15. Пример: оплата начата

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:payment-started:receipt-2026-000123",
  "idempotencyKey": "1c:tolstogo-90:register-1:payment-started:receipt-2026-000123",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "PAYMENT_STARTED",
  "occurredAt": "2026-07-14T08:11:00.000Z",
  "correlationId": "receipt-2026-000123",
  "amount": 5400,
  "payload": {
    "receiptExternalId": "receipt-2026-000123",
    "paymentMethod": "CASH"
  }
}
```

## 16. Пример: получены наличные

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:cash-received:receipt-2026-000123",
  "idempotencyKey": "1c:tolstogo-90:register-1:cash-received:receipt-2026-000123",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "CASH_RECEIVED",
  "occurredAt": "2026-07-14T08:11:05.000Z",
  "correlationId": "receipt-2026-000123",
  "amount": 6000,
  "payload": {
    "receiptExternalId": "receipt-2026-000123",
    "currency": "KZT"
  }
}
```

## 17. Пример: рассчитана сдача

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:change-calculated:receipt-2026-000123",
  "idempotencyKey": "1c:tolstogo-90:register-1:change-calculated:receipt-2026-000123",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "CHANGE_CALCULATED",
  "occurredAt": "2026-07-14T08:11:06.000Z",
  "correlationId": "receipt-2026-000123",
  "amount": 600,
  "payload": {
    "receiptExternalId": "receipt-2026-000123",
    "paidAmount": 6000,
    "receiptTotalAmount": 5400,
    "expectedChangeAmount": 600,
    "currency": "KZT"
  }
}
```

## 18. Пример: оплата завершена

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:payment-completed:receipt-2026-000123",
  "idempotencyKey": "1c:tolstogo-90:register-1:payment-completed:receipt-2026-000123",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "PAYMENT_COMPLETED",
  "occurredAt": "2026-07-14T08:11:10.000Z",
  "correlationId": "receipt-2026-000123",
  "amount": 5400,
  "payload": {
    "receiptExternalId": "receipt-2026-000123",
    "paymentMethod": "CASH",
    "paidAmount": 6000,
    "changeAmount": 600,
    "currency": "KZT"
  }
}
```

## 19. Пример: чек завершен

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:receipt-completed:receipt-2026-000123",
  "idempotencyKey": "1c:tolstogo-90:register-1:receipt-completed:receipt-2026-000123",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "RECEIPT_COMPLETED",
  "occurredAt": "2026-07-14T08:11:15.000Z",
  "correlationId": "receipt-2026-000123",
  "amount": 5400,
  "payload": {
    "receiptExternalId": "receipt-2026-000123",
    "receiptNumber": "000123"
  }
}
```

## 20. Итоговый чек

После завершения чека отправьте полный документ.

Endpoint:

```http
POST /api/v1/integrations/receipts
```

Payload:

```json
{
  "externalId": "receipt-2026-000123",
  "receiptNumber": "000123",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "employeeExternalId": "employee-45",
  "operationType": "SALE",
  "status": "COMPLETED",
  "openedAt": "2026-07-14T08:10:00.000Z",
  "completedAt": "2026-07-14T08:11:15.000Z",
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
      "externalItemId": "line-1",
      "productCode": "BEER-001",
      "barcode": "1234567890",
      "productName": "Beer",
      "categoryCode": "ALCOHOL",
      "quantity": 2,
      "unit": "pcs",
      "unitPrice": 2000,
      "discountAmount": 0,
      "totalAmount": 4000,
      "isContainer": false,
      "isAgeRestricted": true,
      "wasRemoved": false,
      "metadata": {}
    },
    {
      "externalItemId": "line-2",
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
      "isAgeRestricted": false,
      "wasRemoved": false,
      "metadata": {}
    }
  ],
  "metadata": {
    "source": "1C",
    "fiscalNumber": "FN-123",
    "shiftNumber": "SHIFT-2026-07-14-1",
    "cashierWorkstation": "POS-01"
  }
}
```

## 21. Типы операций чека

Для итогового чека `operationType`:

```text
SALE
RETURN
CANCELLATION
VOID
RECEIPT_CORRECTION
```

## 22. Статусы чека

```text
OPEN
COMPLETED
CANCELLED
VOIDED
RETURNED
PARTIALLY_RETURNED
```

## 23. Способы оплаты

```text
CASH
CARD
BONUS
MIXED
QR
OTHER
```

## 24. Поля денег

Деньги передавайте числами в основной валютной единице.

Для тенге:

```json
{
  "totalAmount": 5400,
  "paidAmount": 6000,
  "expectedChangeAmount": 600
}
```

Не передавайте деньги строкой:

```json
{
  "totalAmount": "5400"
}
```

Так делать не нужно.

## 25. Тара и упаковка

Если тара должна быть пробита в чеке, позиция должна иметь:

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

Если видео видит передачу контейнера, а 1С не прислала контейнер в чеке, backend создаст подозрение `container-transferred-not-scanned`.

## 26. Возврат

Возврат лучше отправлять двумя частями:

1. POS event `RETURN_STARTED`.
2. Итоговый чек с `operationType = RETURN`.

### RETURN_STARTED

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:return-started:return-2026-000777",
  "idempotencyKey": "1c:tolstogo-90:register-1:return-started:return-2026-000777",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "RETURN_STARTED",
  "occurredAt": "2026-07-14T09:00:00.000Z",
  "correlationId": "return-2026-000777",
  "payload": {
    "returnReceiptExternalId": "return-2026-000777",
    "originalReceiptExternalId": "receipt-2026-000123",
    "reason": "customer_return"
  }
}
```

### RETURN receipt

```json
{
  "externalId": "return-2026-000777",
  "receiptNumber": "000777",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "employeeExternalId": "employee-45",
  "operationType": "RETURN",
  "status": "RETURNED",
  "openedAt": "2026-07-14T09:00:00.000Z",
  "completedAt": "2026-07-14T09:02:00.000Z",
  "paymentMethod": "CASH",
  "subtotalAmount": 2000,
  "discountAmount": 0,
  "totalAmount": 2000,
  "paidAmount": 2000,
  "currency": "KZT",
  "items": [
    {
      "productCode": "BEER-001",
      "barcode": "1234567890",
      "productName": "Beer",
      "quantity": 1,
      "unit": "pcs",
      "unitPrice": 2000,
      "discountAmount": 0,
      "totalAmount": 2000,
      "isContainer": false,
      "metadata": {
        "originalReceiptExternalId": "receipt-2026-000123"
      }
    }
  ],
  "metadata": {
    "originalReceiptExternalId": "receipt-2026-000123",
    "returnReason": "customer_return"
  }
}
```

## 27. Отмена чека

Если чек отменен:

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:receipt-cancelled:receipt-2026-000124",
  "idempotencyKey": "1c:tolstogo-90:register-1:receipt-cancelled:receipt-2026-000124",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "RECEIPT_CANCELLED",
  "occurredAt": "2026-07-14T09:10:00.000Z",
  "correlationId": "receipt-2026-000124",
  "payload": {
    "receiptExternalId": "receipt-2026-000124",
    "reason": "cashier_cancelled"
  }
}
```

Итоговый чек отправляйте со статусом:

```json
{
  "operationType": "CANCELLATION",
  "status": "CANCELLED"
}
```

## 28. Void operation

Если операция void есть в вашей POS/1С:

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:void:receipt-2026-000125",
  "idempotencyKey": "1c:tolstogo-90:register-1:void:receipt-2026-000125",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "VOID",
  "occurredAt": "2026-07-14T09:20:00.000Z",
  "correlationId": "receipt-2026-000125",
  "payload": {
    "receiptExternalId": "receipt-2026-000125",
    "reason": "operator_void"
  }
}
```

## 29. Смена

При открытии смены:

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:shift-opened:shift-2026-07-14-1",
  "idempotencyKey": "1c:tolstogo-90:register-1:shift-opened:shift-2026-07-14-1",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "SHIFT_OPENED",
  "occurredAt": "2026-07-14T06:00:00.000Z",
  "correlationId": "shift-2026-07-14-1",
  "payload": {
    "shiftExternalId": "shift-2026-07-14-1",
    "cashierExternalId": "employee-45"
  }
}
```

При закрытии смены:

```json
{
  "externalEventId": "1c:tolstogo-90:register-1:shift-closed:shift-2026-07-14-1",
  "idempotencyKey": "1c:tolstogo-90:register-1:shift-closed:shift-2026-07-14-1",
  "storeCode": "tolstogo-90",
  "registerCode": "register-1",
  "operationType": "SHIFT_CLOSED",
  "occurredAt": "2026-07-14T18:00:00.000Z",
  "correlationId": "shift-2026-07-14-1",
  "payload": {
    "shiftExternalId": "shift-2026-07-14-1",
    "cashierExternalId": "employee-45"
  }
}
```

## 30. Batch отправка

Если 1С не может отправлять события сразу, складывайте их в локальную очередь и отправляйте пачками.

Endpoint:

```http
POST /api/v1/integrations/pos-events/batch
```

Payload:

```json
{
  "records": [
    {
      "externalEventId": "event-1",
      "idempotencyKey": "event-1",
      "storeCode": "tolstogo-90",
      "registerCode": "register-1",
      "operationType": "PRODUCT_SCANNED",
      "occurredAt": "2026-07-14T08:10:05.000Z",
      "correlationId": "receipt-2026-000123",
      "productCode": "BEER-001",
      "barcode": "1234567890",
      "quantity": 1,
      "amount": 2000,
      "payload": {}
    }
  ]
}
```

Максимум 500 записей за один запрос.

## 31. Очередь отправки в 1С

Рекомендуется создать регистр сведений или отдельную таблицу очереди.

Минимальные поля:

```text
Id
Endpoint
PayloadJson
IdempotencyKey
Status
Attempts
NextRetryAt
LastError
CreatedAt
SentAt
```

Статусы:

```text
PENDING
SENDING
SENT
FAILED
DEAD
```

Логика:

1. При кассовом событии сформировать JSON.
2. Записать JSON в очередь со статусом `PENDING`.
3. Фоновое задание берет `PENDING`, у которых `NextRetryAt <= Сейчас`.
4. Отправляет HTTP request.
5. При `2xx` ставит `SENT`.
6. При временной ошибке увеличивает `Attempts` и назначает `NextRetryAt`.
7. После лимита попыток ставит `DEAD`.

## 32. Retry policy

Повторять:

- network timeout;
- backend недоступен;
- `500`;
- `502`;
- `503`;
- `504`.

Не повторять бесконечно:

- `400` - ошибка JSON или обязательных полей;
- `401` - неправильный API key;
- `403` - нет permissions;
- `404` - не найден магазин/касса;
- `409` - конфликт, чаще всего дубль.

Backoff:

```text
1 минута
5 минут
15 минут
1 час
3 часа
```

## 33. Пример кода 1С: отправка HTTP POST

Ниже примерный шаблон. Его нужно адаптировать под вашу конфигурацию 1С.

```bsl
Функция ОтправитьJsonВBackend(Путь, JsonСтрока, ApiKey) Экспорт

    Сервер = "localhost";
    Порт = 3000;
    ИспользоватьSSL = Ложь;

    Соединение = Новый HTTPСоединение(Сервер, Порт,,,, ИспользоватьSSL);

    Заголовки = Новый Соответствие;
    Заголовки.Вставить("Content-Type", "application/json");
    Заголовки.Вставить("x-api-key", ApiKey);

    Запрос = Новый HTTPЗапрос("/api/v1" + Путь, Заголовки);
    Запрос.УстановитьТелоИзСтроки(JsonСтрока, КодировкаТекста.UTF8);

    Попытка
        Ответ = Соединение.ОтправитьДляОбработки(Запрос);
        Код = Ответ.КодСостояния;
        Тело = Ответ.ПолучитьТелоКакСтроку();

        Результат = Новый Структура;
        Результат.Вставить("Код", Код);
        Результат.Вставить("Тело", Тело);
        Результат.Вставить("Успешно", Код >= 200 И Код < 300);
        Возврат Результат;

    Исключение
        Результат = Новый Структура;
        Результат.Вставить("Код", 0);
        Результат.Вставить("Тело", ОписаниеОшибки());
        Результат.Вставить("Успешно", Ложь);
        Возврат Результат;
    КонецПопытки;

КонецФункции
```

## 34. Пример кода 1С: товар отсканирован

```bsl
Процедура ОтправитьСобытиеСканирования(Чек, СтрокаТовара) Экспорт

    ApiKey = ПолучитьIntegrationApiKeyИзНастроек();

    ExternalIdЧека = Чек.ВнешнийИдентификатор;
    StoreCode = "tolstogo-90";
    RegisterCode = "register-1";

    EventId = "1c:" + StoreCode + ":" + RegisterCode
        + ":product-scanned:" + ExternalIdЧека
        + ":line-" + Формат(СтрокаТовара.НомерСтроки, "ЧГ=0");

    Данные = Новый Структура;
    Данные.Вставить("externalEventId", EventId);
    Данные.Вставить("idempotencyKey", EventId);
    Данные.Вставить("storeCode", StoreCode);
    Данные.Вставить("registerCode", RegisterCode);
    Данные.Вставить("operationType", "PRODUCT_SCANNED");
    Данные.Вставить("occurredAt", ТекущаяДатаUTCISO());
    Данные.Вставить("correlationId", ExternalIdЧека);
    Данные.Вставить("productCode", СтрокаТовара.КодНоменклатуры);
    Данные.Вставить("barcode", СтрокаТовара.Штрихкод);
    Данные.Вставить("quantity", СтрокаТовара.Количество);
    Данные.Вставить("amount", СтрокаТовара.Сумма);

    Payload = Новый Структура;
    Payload.Вставить("receiptExternalId", ExternalIdЧека);
    Payload.Вставить("receiptNumber", Чек.Номер);
    Payload.Вставить("lineNumber", СтрокаТовара.НомерСтроки);
    Payload.Вставить("productName", СтрокаТовара.НоменклатураНаименование);
    Payload.Вставить("unit", СтрокаТовара.Единица);
    Payload.Вставить("unitPrice", СтрокаТовара.Цена);
    Payload.Вставить("cashierExternalId", Чек.КассирВнешнийИдентификатор);
    Payload.Вставить("source", "1C");

    Данные.Вставить("payload", Payload);

    Json = ЗаписатьJSONВСтроку(Данные);
    Результат = ОтправитьJsonВBackend("/integrations/pos-events", Json, ApiKey);

    Если Не Результат.Успешно Тогда
        ЗаписатьВОчередьПовтора("/integrations/pos-events", Json, EventId, Результат.Тело);
    КонецЕсли;

КонецПроцедуры
```

`ТекущаяДатаUTCISO()` и `ЗаписатьJSONВСтроку()` зависят от версии платформы 1С. Если в конфигурации уже есть HTTP/JSON utility-модуль, используйте его.

## 35. Пример кода 1С: формирование JSON

Общий принцип:

```bsl
Функция ЗаписатьJSONВСтроку(Данные) Экспорт

    ЗаписьJSON = Новый ЗаписьJSON;
    ЗаписьJSON.УстановитьСтроку();
    ЗаписатьJSON(ЗаписьJSON, Данные);
    Возврат ЗаписьJSON.Закрыть();

КонецФункции
```

Если ваша версия 1С иначе работает с JSON, используйте штатный сериализатор конфигурации.

## 36. Маппинг 1С -> backend

| 1С | Backend |
| --- | --- |
| Код магазина | `storeCode` |
| Код кассы / рабочее место | `registerCode` |
| Уникальный ID чека | `externalId` |
| Номер чека | `receiptNumber` |
| Кассир | `employeeExternalId` |
| Номенклатура.Код | `productCode` |
| Штрихкод | `barcode` |
| Номенклатура.Наименование | `productName` |
| Количество | `quantity` |
| Единица | `unit` |
| Цена | `unitPrice` |
| Скидка по строке | `discountAmount` |
| Сумма строки | `totalAmount` |
| Итого чек | `totalAmount` |
| Получено от клиента | `paidAmount` |
| Сдача расчетная | `expectedChangeAmount` |
| Сдача фактическая | `actualChangeAmount` |
| Вид оплаты | `paymentMethod` |

## 37. Ошибки backend

Пример ошибки:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid request",
  "details": {}
}
```

Типовые ошибки:

| HTTP | Что значит | Что делать |
| --- | --- | --- |
| `400` | Неверный JSON или поля | Исправить mapping |
| `401` | Нет или неверный API key | Проверить `INTEGRATION_API_KEY` |
| `403` | Нет permission | Проверить ключ в backend |
| `404` | Не найден store/register | Синхронизировать справочники |
| `409` | Дубль или конфликт | Проверить idempotency |
| `500` | Ошибка backend | Retry |

## 38. Что логировать в 1С

Логировать:

- endpoint;
- `externalId`;
- `externalEventId`;
- HTTP status;
- текст ошибки backend;
- время отправки;
- номер попытки.

Не логировать:

- API key;
- пароли;
- лишние персональные данные;
- полные данные платежных карт.

## 39. Проверка интеграции по шагам

1. Убедиться, что backend запущен.

```bash
curl http://localhost:3000/ready
```

2. Проверить, что API key есть в `.env`.

```env
INTEGRATION_API_KEY=integration_key_...
```

3. Отправить `RECEIPT_OPENED`.

4. Отправить `PRODUCT_SCANNED`.

5. Отправить `PAYMENT_COMPLETED`.

6. Отправить итоговый чек.

7. Открыть список чеков:

```http
GET /api/v1/receipts
Authorization: Bearer <admin JWT>
```

8. Открыть timeline чека или session.

9. Проверить, что POS events появились в backend.

## 40. Минимальный набор для первого запуска

Если нужно быстро проверить интеграцию, достаточно отправить:

1. `PRODUCT_SCANNED`
2. полный чек `/integrations/receipts`

Но для production нужно отправлять полный поток событий.

## 41. Частые проблемы

### 401 Unauthorized

Причина:

- не передан `x-api-key`;
- ключ отличается от `INTEGRATION_API_KEY`;
- seed не был запущен после изменения ключа.

Решение:

```bash
npx prisma db seed
```

### 404 Store not found

`storeCode` в 1С не совпадает с `Store.code` в backend.

### 404 Register not found

`registerCode` не найден внутри указанного магазина.

### Дубли событий

Проверьте, что:

- один и тот же факт имеет один и тот же `externalEventId`;
- разные факты не используют одинаковый `externalEventId`.

### Чек не связывается с видео

Проверьте:

- `correlationId`;
- время в UTC;
- `storeCode`;
- `registerCode`;
- что камера привязана к этой кассе.

## 42. Production checklist

- `INTEGRATION_API_KEY` задан в `.env`.
- После изменения ключа выполнен `npx prisma db seed`.
- Store/register/employee коды согласованы.
- Время отправляется в UTC.
- Есть очередь повторной отправки.
- Есть idempotency.
- API key не пишется в логи.
- Batch не больше 500 записей.
- Возвраты и отмены не затирают исходные чеки.
- Тара передается как `isContainer = true`.
- Наличные передают `paidAmount`, `expectedChangeAmount`, `actualChangeAmount`.
- Ошибки `400/401/403/404` разбираются вручную, а не retry бесконечно.

