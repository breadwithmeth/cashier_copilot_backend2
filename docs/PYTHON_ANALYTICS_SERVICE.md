# Документация для Python analytics-сервиса

Этот документ описывает контракт между Python-сервисом видео/аудиоаналитики и backend. Python-сервис отвечает за RTSP, YOLO, tracking, pose, speech recognition, audio classification, correlation внутри media pipeline и генерацию evidence clips. Backend принимает уже обработанные события.

Если нужна инструкция по внедрению “с нуля”, используйте подробный guide: [PYTHON_FULL_GUIDE.md](PYTHON_FULL_GUIDE.md).

## Граница ответственности

Python-сервис делает:

- Подключение к video RTSP.
- Подключение к audio RTSP или внешнему микрофону.
- YOLO/object detection.
- Object tracking.
- Person/hand/pose tracking.
- Scanner interaction detection.
- Product movement/transfer detection.
- Receipt/business-card/document/money/package/container detection.
- Speech recognition.
- Audio event classification.
- Audio-video correlation внутри media stream.
- Генерацию коротких evidence clips.
- Отправку результатов в backend по HTTP.

Backend делает:

- Хранение конфигурации камер.
- Прием analytics events.
- Корреляцию с чеками, POS и сменами.
- Создание checkout sessions.
- Rule evaluation.
- Создание reviewable violations.
- Уведомления сотрудников и менеджеров.
- Evidence metadata.
- Reports/dashboards.

Backend не принимает raw frames/audio chunks и не запускает ML inference.

## Базовый URL

```text
http://localhost:3000/api/v1
```

Health:

```text
GET /health
GET /ready
```

## Авторизация

Все запросы analytics-сервиса используют API key:

```http
x-api-key: <analytics_api_key>
Content-Type: application/json
```

Seed выводит ключ:

```text
Analytics service API key: analytics_key_...
```

Нужное permission:

```text
analytics:write
```

## Получение конфигурации камер

Обычный endpoint:

```http
GET /api/v1/cameras
Authorization: Bearer <admin JWT>
```

Обычный ответ маскирует RTSP credentials. Для production лучше завести отдельный service endpoint для выдачи stream config analytics-сервису по API key. В текущей реализации реальные stream credentials выдаются так:

```http
POST /api/v1/cameras/:id/stream-credentials
Authorization: Bearer <admin JWT>
```

Этот вызов audit-логируется. Не логируйте raw RTSP URL в Python-сервисе.

## Загрузка reference image для ROI-разметки

Python-сервис может загрузить кадр с камеры, чтобы фронтенд потом разметил на нем зоны:

- `cashierRoi`
- `scanRoi`
- `customerRoi`

Endpoint:

```http
POST /api/v1/analytics/cameras/:cameraCode/roi-reference-image
x-api-key: <analytics_api_key>
Content-Type: multipart/form-data
```

Form fields:

```text
file: required image/jpeg | image/png | image/webp
width: optional frame width
height: optional frame height
capturedAt: optional ISO datetime
```

Пример Python:

```python
from datetime import datetime, timezone
import requests

BASE_URL = "http://localhost:3000/api/v1"
API_KEY = "analytics_key_REPLACE_ME"

def upload_roi_reference_image(camera_code: str, image_path: str, width: int, height: int) -> dict:
    with open(image_path, "rb") as image_file:
        response = requests.post(
            f"{BASE_URL}/analytics/cameras/{camera_code}/roi-reference-image",
            headers={"x-api-key": API_KEY},
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
  "storageKey": "camera_id/image_id.jpg",
  "filename": "reference.jpg",
  "mimeType": "image/jpeg",
  "width": 1920,
  "height": 1080,
  "capturedAt": "2026-07-14T10:00:00.000Z",
  "uploadedAt": "2026-07-14T10:00:01.000Z",
  "uploadedBy": "analytics_service",
  "url": "/api/v1/cameras/camera_id/roi-reference-image"
}
```

После загрузки frontend получает изображение через protected endpoint:

```http
GET /api/v1/cameras/:id/roi-reference-image
Authorization: Bearer <accessToken>
```

И сохраняет полигоны:

```http
PATCH /api/v1/cameras/:id/rois
Authorization: Bearer <accessToken>
```

Координаты ROI всегда нормализованные `0..1`, а не пиксельные. Python-сервис при чтении ROI должен умножать `x` на текущую ширину кадра, `y` на текущую высоту кадра.

## Camera model для analytics

Важные поля:

```text
id
storeId
registerId
name
code
locationType
videoEnabled
videoRtspUrl
videoAnalyticsStreamUrl
videoChannel
videoSubType
videoCodec
configuredVideoFps
audioEnabled
audioRtspUrl
audioAnalyticsStreamUrl
audioChannel
audioSubType
audioCodec
audioSampleRate
audioChannels
recognitionRoi
scanRoi
customerRoi
cashierRoi
paymentRoi
receiptRoi
packagingRoi
receivingRoi
videoConfiguration
audioConfiguration
analyticsConfiguration
```

`camera.code` используется во всех analytics payload как `cameraCode`.

## Video event ingestion

Endpoint:

```http
POST /api/v1/analytics/video/events
```

Batch:

```http
POST /api/v1/analytics/video/events/batch
```

Batch формат:

```json
{
  "records": []
}
```

Максимум 500 событий.

### Video event payload

```json
{
  "externalEventId": "cam10-video-1720885000000-123",
  "idempotencyKey": "cam10-video-1720885000000-123",
  "cameraCode": "cam10",
  "registerCode": "register-1",
  "eventType": "PRODUCT_TRANSFERRED",
  "source": "yolo_tracker",
  "occurredAt": "2026-07-13T12:00:00.000Z",
  "frameTimestampMs": 1720885000000,
  "confidence": 0.91,
  "trackId": "track-42",
  "modelName": "yolo11",
  "modelVersion": "best.pt",
  "correlationId": "checkout-temp-123",
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
          "zone": "customer_transfer_zone"
        }
      }
    ]
  }
}
```

### Required fields

```text
externalEventId
cameraCode
eventType
source
occurredAt
payload
```

`registerCode` желательно передавать для checkout cameras.

## Audio/speech event ingestion

Endpoint:

```http
POST /api/v1/analytics/audio/events
```

Batch:

```http
POST /api/v1/analytics/audio/events/batch
```

Payload:

```json
{
  "externalEventId": "cam10-audio-1720885000000-1",
  "idempotencyKey": "cam10-audio-1720885000000-1",
  "cameraCode": "cam10",
  "registerCode": "register-1",
  "eventType": "SPEECH_RECOGNIZED",
  "source": "whisper",
  "occurredAt": "2026-07-13T12:00:00.000Z",
  "startedAt": "2026-07-13T12:00:00.000Z",
  "endedAt": "2026-07-13T12:00:03.200Z",
  "speakerType": "CASHIER",
  "language": "ru",
  "text": "Здравствуйте. С вас пять тысяч четыреста тенге.",
  "confidence": 0.91,
  "audioSource": "EXTERNAL_MICROPHONE_RTSP",
  "correlationId": "checkout-temp-123",
  "words": [
    {
      "text": "Здравствуйте",
      "startMs": 0,
      "endMs": 800,
      "confidence": 0.94
    }
  ],
  "metadata": {
    "audioTrackId": "mic-1"
  },
  "payload": {}
}
```

Для `speakerType = CASHIER` backend автоматически проверяет `text` на мат. При срабатывании создается `PROFANITY_DETECTED` action, violation `profanity-detected` и уведомление для кассы.

## Audio classifications

Endpoint:

```http
POST /api/v1/analytics/audio/classifications
```

Используйте для событий без распознанного текста:

```json
{
  "externalEventId": "cam10-audio-class-1720885000000-1",
  "idempotencyKey": "cam10-audio-class-1720885000000-1",
  "cameraCode": "cam10",
  "registerCode": "register-1",
  "eventType": "SCANNER_BEEP_DETECTED",
  "source": "audio_classifier",
  "occurredAt": "2026-07-13T12:00:14.500Z",
  "confidence": 0.88,
  "audioTimestampMs": 1720885014500,
  "correlationId": "checkout-temp-123",
  "payload": {
    "className": "scanner_beep",
    "durationMs": 180
  }
}
```

## Event types

Рекомендуемые `eventType` для video/audio:

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

## Detection types

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

## Speaker types

```text
CASHIER
CUSTOMER
SUPPLIER
EMPLOYEE
UNKNOWN
MULTIPLE
```

## Audio sources

```text
CAMERA_AUDIO_RTSP
EXTERNAL_MICROPHONE_RTSP
EMBEDDED_VIDEO_AUDIO
UPLOADED_AUDIO
OTHER
```

## Correlation

Передавайте максимум доступных идентификаторов:

- `cameraCode`
- `registerCode`
- `correlationId`
- `trackId`
- `frameTimestampMs`
- `audioTimestampMs`
- `occurredAt`
- `startedAt`/`endedAt`

Backend env:

```text
AUDIO_VIDEO_CORRELATION_TOLERANCE_MS=3000
RECEIPT_VIDEO_CORRELATION_TOLERANCE_SECONDS=30
```

Python-сервис должен учитывать:

- аудио может приходить раньше видео;
- видео может приходить раньше аудио;
- чек может прийти позже analytics events;
- POS clock drift;
- разные latency для audio и video.

Не удаляйте локальные raw events до успешной доставки или истечения локальной retention policy.

## Idempotency

`externalEventId` должен быть стабильным для одного и того же события.

Рекомендуемый формат:

```text
<cameraCode>-<media>-<timestampMs>-<sequence>
```

Примеры:

```text
cam10-video-1720885000000-123
cam10-audio-1720885000000-1
receiving-cam1-video-1720885000000-22
```

Если запрос повторяется, используйте тот же `externalEventId` и `idempotencyKey`.

## Heartbeats

Спецификация предусматривает:

```text
POST /api/v1/analytics/cameras/:cameraCode/video-heartbeat
POST /api/v1/analytics/cameras/:cameraCode/audio-heartbeat
POST /api/v1/analytics/cameras/:cameraCode/heartbeat
```

В текущей реализации dedicated heartbeat endpoints еще не выделены. До их добавления можно отправлять технические analytics events:

```json
{
  "externalEventId": "cam10-video-heartbeat-1720885000000",
  "idempotencyKey": "cam10-video-heartbeat-1720885000000",
  "cameraCode": "cam10",
  "registerCode": "register-1",
  "eventType": "VIDEO_HEARTBEAT",
  "source": "python-analytics-service",
  "occurredAt": "2026-07-13T12:00:00.000Z",
  "confidence": 1,
  "payload": {
    "videoStatus": "ONLINE",
    "fps": 25,
    "latencyMs": 120
  }
}
```

Рекомендуется добавить dedicated heartbeat routes, которые обновляют:

```text
videoStatus
videoFps
videoLatencyMs
lastVideoFrameAt
audioStatus
audioBitrate
audioLatencyMs
lastAudioPacketAt
overallStatus
lastSeenAt
```

## Evidence clips

Создание metadata/request:

```http
POST /api/v1/analytics/evidence-clips
```

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
  "storageKey": "evidence/cam10/2026/07/13/event-123.mp4",
  "eventOccurredAt": "2026-07-13T12:00:00.000Z",
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

Не отправляйте raw storage path в публичное поле. `playbackUrl` должен быть подписанным или защищенным.

## Receiving analytics

Для приемки используйте те же video/audio endpoints, но `cameraCode` обычно относится к камере зоны приемки:

```json
{
  "externalEventId": "receiving-cam1-video-1720885000000-1",
  "idempotencyKey": "receiving-cam1-video-1720885000000-1",
  "cameraCode": "receiving-cam1",
  "eventType": "PRODUCT_COUNT_COMPLETED",
  "source": "receiving_yolo_tracker",
  "occurredAt": "2026-07-13T10:00:00.000Z",
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

Receiving red flags:

- приемка без пересчета;
- расхождение количества;
- срок годности не проверен;
- упаковка не проверена;
- поврежденный товар не отделен;
- расхождение не зафиксировано;
- приемка выполнена слишком быстро.

## Retry policy

Python-сервис должен retry:

- network timeout;
- `502`, `503`, `504`;
- временные `500`.

Не retry без изменения payload на:

- `400 VALIDATION_ERROR`;
- `401 API_KEY_REQUIRED`;
- `403 API_KEY_FORBIDDEN`;
- `404 CAMERA_NOT_FOUND`, пока конфигурация не обновлена.

Backoff:

```text
1s, 3s, 10s, 30s, 2m, 5m
```

Для retry используйте тот же idempotency key.

## Local queue

Рекомендуется иметь локальную durable очередь в Python-сервисе:

- SQLite или disk-backed queue.
- Статусы: `pending`, `sending`, `sent`, `failed`.
- Хранить payload, endpoint, attempts, last error.
- Удалять только после успешного `2xx`.

Backend не использует Redis/RabbitMQ/Kafka; scheduled worker внутри backend использует PostgreSQL.

## Logging

Логировать:

- `externalEventId`;
- `cameraCode`;
- `eventType`;
- HTTP status;
- duration;
- attempts;
- modelName/modelVersion;
- confidence.

Не логировать:

- API key;
- raw RTSP credentials;
- private storage credentials;
- полный speech text, если политика приватности запрещает.

## Minimal Python sender example

```python
import requests

BASE_URL = "http://localhost:3000/api/v1"
API_KEY = "analytics_key_REPLACE_ME"

def send_video_event(event: dict) -> dict:
    response = requests.post(
        f"{BASE_URL}/analytics/video/events",
        json=event,
        headers={
            "x-api-key": API_KEY,
            "Content-Type": "application/json",
        },
        timeout=5,
    )
    response.raise_for_status()
    return response.json()

send_video_event({
    "externalEventId": "cam10-video-1720885000000-123",
    "idempotencyKey": "cam10-video-1720885000000-123",
    "cameraCode": "cam10",
    "registerCode": "register-1",
    "eventType": "PRODUCT_TRANSFERRED",
    "source": "yolo_tracker",
    "occurredAt": "2026-07-13T12:00:00.000Z",
    "confidence": 0.91,
    "payload": {"detections": []},
})
```

## Checklist готовности Python-сервиса

- Есть API key с `analytics:write`.
- Каждая камера использует backend `camera.code`.
- Не логируются raw RTSP credentials.
- Все события имеют стабильный `externalEventId`.
- Все retry используют тот же `idempotencyKey`.
- Время отправляется в UTC.
- Batch не больше 500 событий.
- Видео и аудио могут отправляться независимо.
- Speech events включают `startedAt` и `endedAt`.
- Evidence clips используют protected/signed playback URL.
- High-risk detections не трактуются как подтвержденное нарушение на стороне Python.
