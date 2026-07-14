# Полная инструкция для Python analytics-сервиса

Документ описывает, как Python-сервис видео/аудиоаналитики должен работать с Cashier Copilot Backend: конфигурация, RTSP, ROI, YOLO/tracking, speech, отправка событий, evidence clips, retry, локальная очередь и проверка интеграции.

## 1. Роль Python-сервиса

Python-сервис отвечает за обработку медиа:

- подключается к video RTSP;
- подключается к audio RTSP или внешнему микрофону;
- получает кадры и аудиофрагменты;
- запускает YOLO/object detection;
- ведет object tracking;
- определяет людей, руки, позу, товары, сканер, деньги, документы, контейнеры;
- распознает речь;
- классифицирует аудио-события;
- сопоставляет видео и аудио внутри своего pipeline;
- формирует короткие evidence clips;
- отправляет в backend только готовые события и metadata.

Python-сервис не должен:

- напрямую писать нарушения в базу;
- подтверждать нарушения;
- назначать штрафы;
- отправлять raw video/audio в backend;
- хранить API key или RTSP credentials в логах.

Backend делает:

- хранит камеры и ROI;
- принимает analytics events;
- связывает события с чеками, POS и сменами;
- создает подозрения;
- отправляет уведомления;
- хранит evidence metadata;
- показывает данные фронтенду.

## 2. Backend URL

Локально:

```text
http://localhost:3000/api/v1
```

Health:

```text
GET http://localhost:3000/health
GET http://localhost:3000/ready
```

Production URL должен быть задан через env Python-сервиса.

## 3. API key

Все запросы от Python-сервиса используют:

```http
x-api-key: <analytics api key>
```

Ключ лежит в `.env` backend:

```env
ANALYTICS_API_KEY=analytics_key_...
```

В Python-сервисе он должен лежать в env:

```env
BACKEND_BASE_URL=http://localhost:3000/api/v1
BACKEND_ANALYTICS_API_KEY=analytics_key_...
```

Не хардкодьте ключ в коде.

## 4. Рекомендуемая структура Python-сервиса

Пример структуры:

```text
python-analytics-service/
  app/
    main.py
    config.py
    backend_client.py
    camera_registry.py
    rtsp/
      video_reader.py
      audio_reader.py
    vision/
      detector.py
      tracker.py
      roi.py
      events.py
    audio/
      recognizer.py
      classifier.py
      events.py
    evidence/
      clip_writer.py
      storage.py
    queue/
      local_queue.py
      retry_worker.py
    models/
      schemas.py
  requirements.txt
  .env
```

## 5. Python env

Минимальный `.env`:

```env
BACKEND_BASE_URL=http://localhost:3000/api/v1
BACKEND_ANALYTICS_API_KEY=analytics_key_REPLACE_ME

SERVICE_NAME=python-analytics-service
SERVICE_INSTANCE_ID=analytics-worker-1

REQUEST_TIMEOUT_SECONDS=10
SEND_BATCH_SIZE=100
SEND_BATCH_INTERVAL_SECONDS=2
LOCAL_QUEUE_PATH=./data/outbox.sqlite

DEFAULT_MODEL_NAME=yolo11
DEFAULT_MODEL_VERSION=best.pt

EVIDENCE_STORAGE_PROVIDER=local
EVIDENCE_OUTPUT_DIR=./data/evidence
EVIDENCE_SECONDS_BEFORE=10
EVIDENCE_SECONDS_AFTER=10
```

## 6. Какие камеры обрабатывать

Backend хранит камеры:

```text
Camera.code
Camera.storeId
Camera.registerId
Camera.videoEnabled
Camera.audioEnabled
Camera.videoRtspUrl
Camera.audioRtspUrl
Camera.cashierRoi
Camera.scanRoi
Camera.customerRoi
Camera.receivingRoi
```

Сейчас обычный `GET /api/v1/cameras` требует JWT и маскирует RTSP. Для production лучше добавить отдельный backend endpoint для analytics-service config по API key.

В текущей реализации реальные stream credentials доступны через:

```http
POST /api/v1/cameras/:id/stream-credentials
Authorization: Bearer <admin JWT>
```

Этот endpoint audit-логируется.

Практичный вариант для первого запуска:

1. Настроить список камер в Python env/config.
2. Использовать `cameraCode`, совпадающий с backend.
3. RTSP URL хранить на стороне Python-сервиса в secret config.
4. ROI брать из backend после разметки.

## 7. Camera code

Во всех событиях обязательно передавайте:

```json
{
  "cameraCode": "cam10"
}
```

Seed создает:

```text
cam10
receiving-cam1
```

`cameraCode` должен совпадать с `Camera.code` в backend.

## 8. Register code

Для кассовых камер передавайте:

```json
{
  "registerCode": "register-1"
}
```

Это помогает backend связать видео с кассой и чеком.

Для receiving/warehouse cameras `registerCode` можно не передавать.

## 9. ROI reference image

Чтобы фронтенд мог размечать зоны, Python-сервис должен загрузить reference image.

Endpoint:

```http
POST /api/v1/analytics/cameras/:cameraCode/roi-reference-image
x-api-key: <analytics api key>
Content-Type: multipart/form-data
```

Form fields:

```text
file: image/jpeg | image/png | image/webp
width: ширина кадра
height: высота кадра
capturedAt: UTC ISO datetime
```

Пример:

```python
from datetime import datetime, timezone
import requests

def upload_roi_reference_image(base_url: str, api_key: str, camera_code: str, image_path: str, width: int, height: int) -> dict:
    with open(image_path, "rb") as image_file:
        response = requests.post(
            f"{base_url}/analytics/cameras/{camera_code}/roi-reference-image",
            headers={"x-api-key": api_key},
            files={"file": ("reference.jpg", image_file, "image/jpeg")},
            data={
                "width": str(width),
                "height": str(height),
                "capturedAt": datetime.now(timezone.utc).isoformat(),
            },
            timeout=15,
        )
    response.raise_for_status()
    return response.json()
```

Ответ:

```json
{
  "id": "image_id",
  "cameraId": "camera_id",
  "cameraCode": "cam10",
  "mimeType": "image/jpeg",
  "width": 1920,
  "height": 1080,
  "capturedAt": "2026-07-14T10:00:00.000Z",
  "url": "/api/v1/cameras/camera_id/roi-reference-image"
}
```

## 10. ROI polygons

Фронтенд сохраняет ROI в backend:

```text
cashierRoi
scanRoi
customerRoi
```

Формат:

```json
{
  "cashierRoi": [
    {
      "label": "cashier-main",
      "points": [
        { "x": 0.12, "y": 0.18 },
        { "x": 0.38, "y": 0.18 },
        { "x": 0.39, "y": 0.78 }
      ],
      "metadata": {}
    }
  ],
  "scanRoi": [],
  "customerRoi": []
}
```

Координаты всегда нормализованные `0..1`.

Чтобы применить ROI к кадру:

```python
def normalized_polygon_to_pixels(points: list[dict], width: int, height: int) -> list[tuple[int, int]]:
    return [(int(p["x"] * width), int(p["y"] * height)) for p in points]
```

## 11. Рекомендуемый pipeline видео

1. Подключиться к RTSP.
2. Читать кадры.
3. Нормализовать timestamp кадра.
4. Применить ROI masks.
5. Запустить detector.
6. Запустить tracker.
7. Определить бизнес-события:
   - покупатель вошел;
   - кассир присутствует;
   - сканер поднесен к товару;
   - товар передан покупателю;
   - чек передан;
   - контейнер передан;
   - телефон в руках сотрудника.
8. Сформировать analytics event.
9. Положить event в local outbox.
10. Retry worker отправляет event в backend.

## 12. Рекомендуемый pipeline аудио

1. Подключиться к audio RTSP или microphone stream.
2. Читать audio chunks.
3. Выполнить VAD/speech segmentation.
4. Запустить speech recognition.
5. Определить speaker type, если возможно.
6. Классифицировать фразы:
   - приветствие;
   - сумма покупки;
   - сумма сдачи;
   - upsell;
   - прощание.
7. Классифицировать звуки:
   - scanner beep;
   - cash drawer;
   - payment terminal.
8. Отправить speech/audio event в backend.

## 13. Video event endpoint

Одиночное событие:

```http
POST /api/v1/analytics/video/events
```

Batch:

```http
POST /api/v1/analytics/video/events/batch
```

Batch:

```json
{
  "records": []
}
```

Максимум 500 records.

## 14. Video event payload

```json
{
  "externalEventId": "cam10-video-1720885000000-123",
  "idempotencyKey": "cam10-video-1720885000000-123",
  "cameraCode": "cam10",
  "registerCode": "register-1",
  "eventType": "PRODUCT_TRANSFERRED",
  "source": "yolo_tracker",
  "occurredAt": "2026-07-14T08:10:05.000Z",
  "frameTimestampMs": 1720885000000,
  "confidence": 0.91,
  "trackId": "track-42",
  "modelName": "yolo11",
  "modelVersion": "best.pt",
  "correlationId": "receipt-2026-000123",
  "payload": {
    "detections": [
      {
        "detectionType": "PRODUCT",
        "className": "glass_bottle",
        "classId": "39",
        "confidence": 0.91,
        "trackId": "track-42",
        "boundingBox": {
          "x1": 120,
          "y1": 80,
          "x2": 240,
          "y2": 430,
          "normalized": false
        },
        "attributes": {
          "roi": "customerRoi",
          "direction": "cashier_to_customer"
        }
      }
    ]
  }
}
```

## 15. Required video fields

```text
externalEventId
cameraCode
eventType
source
occurredAt
payload
```

Очень желательно:

```text
idempotencyKey
registerCode
confidence
trackId
modelName
modelVersion
correlationId
```

## 16. Detection types

```text
CUSTOMER
CASHIER
PRODUCT
SCANNER
RECEIPT
BUSINESS_CARD
PACKAGE
CONTAINER
MONEY
PAYMENT_CARD
PHONE
AGE_DOCUMENT
HAND
FACE
POSE
LABEL
EXPIRATION_DATE
DAMAGED_PACKAGE
BOX
PALLET
OTHER
```

## 17. Audio speech endpoint

Одиночное событие:

```http
POST /api/v1/analytics/audio/events
```

Batch:

```http
POST /api/v1/analytics/audio/events/batch
```

## 18. Speech event payload

```json
{
  "externalEventId": "cam10-audio-1720885000000-1",
  "idempotencyKey": "cam10-audio-1720885000000-1",
  "cameraCode": "cam10",
  "registerCode": "register-1",
  "eventType": "SPEECH_RECOGNIZED",
  "source": "whisper",
  "occurredAt": "2026-07-14T08:10:20.000Z",
  "startedAt": "2026-07-14T08:10:20.000Z",
  "endedAt": "2026-07-14T08:10:23.200Z",
  "speakerType": "CASHIER",
  "language": "ru",
  "text": "Здравствуйте. С вас пять тысяч четыреста тенге.",
  "confidence": 0.91,
  "audioSource": "EXTERNAL_MICROPHONE_RTSP",
  "correlationId": "receipt-2026-000123",
  "words": [
    {
      "text": "Здравствуйте",
      "startMs": 0,
      "endMs": 800,
      "confidence": 0.94
    }
  ],
  "metadata": {
    "audioTrackId": "mic-1",
    "phraseClassifications": ["GREETING_DETECTED", "PURCHASE_AMOUNT_ANNOUNCED"]
  },
  "payload": {}
}
```

Когда `speakerType = CASHIER`, backend автоматически проверяет `text` на запрещенную лексику. Если найден мат:

- в `SpeechEvent.phrases` добавляется `PROFANITY_DETECTED`;
- создается `CashierAction` с action type `PROFANITY_DETECTED`;
- создается violation `profanity-detected` со статусом `NEW`;
- для кассы создается employee notification, если правило активно.

Python-сервису не нужно самому подтверждать нарушение. Он должен отправить обычный транскрипт, а backend выполнит проверку.

## 19. Audio classification endpoint

Для звуков без текста:

```http
POST /api/v1/analytics/audio/classifications
```

Пример scanner beep:

```json
{
  "externalEventId": "cam10-audio-class-1720885014500-1",
  "idempotencyKey": "cam10-audio-class-1720885014500-1",
  "cameraCode": "cam10",
  "registerCode": "register-1",
  "eventType": "SCANNER_BEEP_DETECTED",
  "source": "audio_classifier",
  "occurredAt": "2026-07-14T08:10:14.500Z",
  "confidence": 0.88,
  "audioTimestampMs": 1720885014500,
  "correlationId": "receipt-2026-000123",
  "payload": {
    "className": "scanner_beep",
    "durationMs": 180
  }
}
```

## 20. Speaker types

```text
CASHIER
CUSTOMER
SUPPLIER
EMPLOYEE
UNKNOWN
MULTIPLE
```

## 21. Audio sources

```text
CAMERA_AUDIO_RTSP
EXTERNAL_MICROPHONE_RTSP
EMBEDDED_VIDEO_AUDIO
UPLOADED_AUDIO
OTHER
```

## 22. Event types

Основные event types:

```text
CUSTOMER_ENTERED
CUSTOMER_LEFT
CUSTOMER_WAITING
CASHIER_PRESENT
CASHIER_ABSENT
GREETING_DETECTED
NEED_IDENTIFICATION_DETECTED
CONSULTATION_DETECTED
UPSELL_DETECTED
CASH_SCRIPT_DETECTED
PURCHASE_AMOUNT_ANNOUNCED
CHANGE_AMOUNT_ANNOUNCED
GOODBYE_DETECTED
INCORRECT_TONE_DETECTED
PHONE_DISTRACTION_DETECTED
PRODUCT_PICKED
PRODUCT_MOVED_TO_CUSTOMER
PRODUCT_TRANSFERRED
PRODUCT_SCANNED
PRODUCT_NOT_SCANNED
SCANNER_PRESENTED
SCANNER_BEEP_DETECTED
SCAN_SIMULATION_SUSPECTED
PRODUCT_REMOVED_FROM_RECEIPT
CONTAINER_USED
CONTAINER_TRANSFERRED
CONTAINER_SCANNED
CONTAINER_NOT_SCANNED
PAYMENT_STARTED
CASH_PAYMENT_DETECTED
CARD_PAYMENT_DETECTED
QR_PAYMENT_DETECTED
MONEY_RECEIVED
CHANGE_GIVEN
PAYMENT_METHOD_MISMATCH
PAYMENT_AMOUNT_MISMATCH
RECEIPT_PRINTED
RECEIPT_GIVEN
RECEIPT_PLACED_IN_BAG
RECEIPT_NOT_GIVEN
BUSINESS_CARD_GIVEN
BUSINESS_CARD_NOT_GIVEN
AGE_DOCUMENT_REQUESTED
AGE_DOCUMENT_SHOWN
RETURN_DETECTED
VOID_DETECTED
PRODUCT_TRANSFER_DURING_RETURN
PRODUCT_TRANSFER_DURING_VOID
RECEIVING_STARTED
INVOICE_CHECKED
PRODUCT_COUNT_STARTED
PRODUCT_COUNT_COMPLETED
EXPIRATION_DATE_CHECKED
PACKAGE_INTEGRITY_CHECKED
DAMAGED_PRODUCT_SEPARATED
RECEIVING_DIFFERENCE_RECORDED
PRODUCT_MOVED_WITHOUT_COUNT
RECEIVING_COMPLETED
```

## 23. Idempotency

Каждое событие должно иметь стабильный `externalEventId`.

Формат:

```text
<cameraCode>-<media>-<timestampMs>-<sequence>
```

Примеры:

```text
cam10-video-1720885000000-123
cam10-audio-1720885000000-1
receiving-cam1-video-1720885000000-22
```

Если событие отправляется повторно, используйте тот же:

```text
externalEventId
idempotencyKey
```

## 24. Correlation ID

Если Python знает receipt/session ID от POS, передавайте:

```json
{
  "correlationId": "receipt-2026-000123"
}
```

Если Python не знает чек, можно использовать временный ID:

```text
checkout-temp-<cameraCode>-<customerTrackId>-<timestamp>
```

Backend умеет связывать delayed events по времени, кассе и камере, но хороший `correlationId` повышает точность.

## 25. Time

Все времена отправляйте в UTC:

```text
2026-07-14T08:10:05.000Z
```

Для timestamp кадра:

```json
{
  "frameTimestampMs": 1720885000000
}
```

Для audio:

```json
{
  "audioTimestampMs": 1720885014500
}
```

## 26. Batch отправка

Используйте batch, если событий много:

```http
POST /api/v1/analytics/video/events/batch
POST /api/v1/analytics/audio/events/batch
```

Payload:

```json
{
  "records": [
    {
      "externalEventId": "cam10-video-1720885000000-123",
      "idempotencyKey": "cam10-video-1720885000000-123",
      "cameraCode": "cam10",
      "registerCode": "register-1",
      "eventType": "PRODUCT_TRANSFERRED",
      "source": "yolo_tracker",
      "occurredAt": "2026-07-14T08:10:05.000Z",
      "confidence": 0.91,
      "payload": {}
    }
  ]
}
```

Максимум 500 records.

## 27. Backend client пример

```python
from __future__ import annotations

import requests

class BackendClient:
    def __init__(self, base_url: str, api_key: str, timeout: int = 10) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def post_json(self, path: str, payload: dict) -> dict:
        response = requests.post(
            f"{self.base_url}{path}",
            json=payload,
            headers=self._headers(),
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise BackendError(response.status_code, response.text)
        return response.json()

    def send_video_event(self, event: dict) -> dict:
        return self.post_json("/analytics/video/events", event)

    def send_audio_event(self, event: dict) -> dict:
        return self.post_json("/analytics/audio/events", event)

class BackendError(Exception):
    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"Backend error {status_code}: {body}")
        self.status_code = status_code
        self.body = body
```

## 28. Local outbox queue

Python-сервис должен иметь локальную очередь, чтобы не терять события при падении backend.

Можно использовать:

- SQLite;
- disk-backed JSONL;
- embedded queue.

Минимальная таблица:

```sql
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
```

Статусы:

```text
pending
sending
sent
failed
dead
```

## 29. Retry policy

Retry:

- network timeout;
- connection error;
- `500`;
- `502`;
- `503`;
- `504`.

Не retry без ручного исправления:

- `400 VALIDATION_ERROR`;
- `401 API_KEY_REQUIRED`;
- `403 API_KEY_FORBIDDEN`;
- `404 CAMERA_NOT_FOUND`;
- `409 DATABASE_CONSTRAINT`, если это ожидаемый дубль.

Backoff:

```text
1s
3s
10s
30s
2m
5m
15m
```

## 30. Evidence clips

Python-сервис генерирует файл клипа сам, затем сообщает backend metadata.

Создание:

```http
POST /api/v1/analytics/evidence-clips
```

Payload:

```json
{
  "storeId": "store_id",
  "registerId": "register_id",
  "cameraId": "camera_id",
  "sessionId": "session_id",
  "receiptId": "receipt_id",
  "violationId": "violation_id",
  "mediaType": "AUDIO_VIDEO",
  "storageProvider": "s3-compatible",
  "storageKey": "evidence/cam10/2026/07/14/event-123.mp4",
  "eventOccurredAt": "2026-07-14T08:10:05.000Z",
  "metadata": {
    "codec": "h264",
    "source": "python-analytics-service"
  }
}
```

Обновление статуса:

```http
PATCH /api/v1/analytics/evidence-clips/:id/status
```

```json
{
  "status": "AVAILABLE",
  "playbackUrl": "https://protected.example.com/signed/evidence.mp4"
}
```

Статусы:

```text
REQUESTED
GENERATING
AVAILABLE
NOT_FOUND
CAMERA_UNAVAILABLE
RECORDING_ERROR
FAILED
EXPIRED
DELETED
```

`playbackUrl` должен быть подписанным или защищенным. Не отправляйте публичный raw path.

## 31. Receiving analytics

Для зоны приемки используйте camera:

```text
receiving-cam1
```

Пример события:

```json
{
  "externalEventId": "receiving-cam1-video-1720885000000-1",
  "idempotencyKey": "receiving-cam1-video-1720885000000-1",
  "cameraCode": "receiving-cam1",
  "eventType": "PRODUCT_COUNT_COMPLETED",
  "source": "receiving_yolo_tracker",
  "occurredAt": "2026-07-14T10:00:00.000Z",
  "confidence": 0.87,
  "correlationId": "recv-doc-2026-0001",
  "payload": {
    "documentExternalId": "recv-doc-2026-0001",
    "detectedQuantity": 118,
    "detections": [
      {
        "detectionType": "BOX",
        "className": "milk_box",
        "confidence": 0.9
      }
    ]
  }
}
```

## 32. Heartbeats

Спецификация предусматривает dedicated heartbeat endpoints:

```text
POST /api/v1/analytics/cameras/:cameraCode/video-heartbeat
POST /api/v1/analytics/cameras/:cameraCode/audio-heartbeat
POST /api/v1/analytics/cameras/:cameraCode/heartbeat
```

В текущем backend dedicated endpoints еще не выделены. Пока отправляйте technical analytics event:

```json
{
  "externalEventId": "cam10-video-heartbeat-1720885000000",
  "idempotencyKey": "cam10-video-heartbeat-1720885000000",
  "cameraCode": "cam10",
  "registerCode": "register-1",
  "eventType": "VIDEO_HEARTBEAT",
  "source": "python-analytics-service",
  "occurredAt": "2026-07-14T08:10:00.000Z",
  "confidence": 1,
  "payload": {
    "videoStatus": "ONLINE",
    "fps": 25,
    "latencyMs": 120
  }
}
```

## 33. Logging

Логировать:

- `externalEventId`;
- `cameraCode`;
- `eventType`;
- HTTP status;
- duration;
- attempts;
- modelName;
- modelVersion;
- confidence;
- queue status.

Не логировать:

- API key;
- RTSP username/password;
- private storage credentials;
- полный speech text, если политика приватности это запрещает;
- персональные данные сверх необходимого.

## 34. Метрики Python-сервиса

Рекомендуемые метрики:

```text
camera_video_connected
camera_audio_connected
frames_processed_total
frames_dropped_total
detections_total
events_created_total
events_sent_total
events_failed_total
outbox_pending_total
backend_request_duration_ms
model_inference_duration_ms
evidence_clips_generated_total
```

## 35. Тестирование интеграции

1. Проверить backend:

```bash
curl http://localhost:3000/ready
```

2. Проверить API key:

```bash
curl -X POST http://localhost:3000/api/v1/analytics/video/events \
  -H "Content-Type: application/json" \
  -H "x-api-key: analytics_key_REPLACE_ME" \
  -d '{
    "externalEventId": "cam10-video-test-1",
    "idempotencyKey": "cam10-video-test-1",
    "cameraCode": "cam10",
    "registerCode": "register-1",
    "eventType": "PRODUCT_TRANSFERRED",
    "source": "manual-test",
    "occurredAt": "2026-07-14T08:10:05.000Z",
    "confidence": 0.91,
    "payload": {"detections": []}
  }'
```

3. Проверить upload ROI image:

```bash
curl -X POST http://localhost:3000/api/v1/analytics/cameras/cam10/roi-reference-image \
  -H "x-api-key: analytics_key_REPLACE_ME" \
  -F "file=@reference.jpg;type=image/jpeg" \
  -F "width=1920" \
  -F "height=1080" \
  -F "capturedAt=2026-07-14T08:10:00.000Z"
```

4. Проверить, что event появился в `GET /api/v1/analytics-events` через admin frontend/JWT.

## 36. Частые ошибки

### 401 API_KEY_REQUIRED

Не передан `x-api-key` или ключ неверный.

### 403 API_KEY_FORBIDDEN

Ключ есть, но у него нет permission `analytics:write`.

### 404 CAMERA_NOT_FOUND

`cameraCode` не совпадает с backend `Camera.code`.

### 400 VALIDATION_ERROR

Не хватает обязательного поля или поле неверного типа.

### Дубли событий

Проверьте `externalEventId` и `idempotencyKey`.

## 37. Production checklist

- `BACKEND_BASE_URL` задан.
- `BACKEND_ANALYTICS_API_KEY` задан.
- API key не логируется.
- RTSP credentials не логируются.
- Для каждой камеры задан `cameraCode`.
- ROI reference image загружен.
- ROI polygons размечены во frontend.
- Есть local outbox queue.
- Retry использует тот же idempotency key.
- Batch не превышает 500 records.
- Время отправляется в UTC.
- Evidence playback URL защищен.
- High-risk detection не подтверждается на стороне Python.
- При недоступности backend события не теряются.
