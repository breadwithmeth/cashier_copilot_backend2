# Документация для Call Center Analytics

Этот документ описывает контракт между Python-сервисом видео/аудиоаналитики и backend для Call Center. Python-сервис отвечает за RTSP, YOLO, tracking, pose, speech recognition, audio classification, correlation внутри media pipeline и генерацию evidence clips. Backend принимает уже обработанные события.

Call Center среды не используют POS, чеки или кассовые аппараты. Вместо этого они фокусируются на взаимодействии оператора и клиента, качестве обслуживания и безопасности.

## Граница ответственности

Python-сервис делает:

- Подключение к video RTSP.
- Подключение к audio RTSP или внешнему микрофону.
- YOLO/object detection.
- Object tracking.
- Person/hand/pose tracking.
- Headset detection.
- Speech recognition.
- Audio event classification.
- Audio-video correlation внутри media stream.
- Генерацию коротких evidence clips.
- Отправку результатов в backend по HTTP.

Backend делает:

- Хранение конфигурации камер.
- Прием analytics events.
- Создание сессий (CheckoutSession без registerId).
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

- `cashierRoi` (или `agentRoi`)
- `customerRoi` (или `callerRoi`)

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

Получить ROI по `cameraCode`:

```http
GET /api/v1/analytics/cameras/:cameraCode/rois
x-api-key: <analytics_api_key>
```

Пример:

```bash
curl "http://localhost:3020/api/v1/analytics/cameras/cam10/rois" \
  -H "x-api-key: analytics_key_REPLACE_ME"
```

## Camera model для analytics

Важные поля:

```text
id
storeId
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
  "eventType": "HEADSET_WORN",
  "source": "yolo_tracker",
  "occurredAt": "2026-07-13T12:00:00.000Z",
  "frameTimestampMs": 1720885000000,
  "confidence": 0.91,
  "trackId": "track-42",
  "modelName": "yolo11",
  "modelVersion": "best.pt",
  "correlationId": "call-session-temp-123",
  "payload": {
    "detections": [
      {
        "detectionType": "HEADSET",
        "className": "headset",
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
          "zone": "agent_zone"
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

`registerCode` не используется для Call Center.

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
  "eventType": "SPEECH_RECOGNIZED",
  "source": "whisper",
  "occurredAt": "2026-07-13T12:00:00.000Z",
  "startedAt": "2026-07-13T12:00:00.000Z",
  "endedAt": "2026-07-13T12:00:03.200Z",
  "speakerType": "CALL_CENTER_AGENT",
  "language": "ru",
  "text": "Здравствуйте. Чем могу помочь?",
  "confidence": 0.91,
  "audioSource": "EXTERNAL_MICROPHONE_RTSP",
  "correlationId": "call-session-temp-123",
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

Для `speakerType = CALL_CENTER_AGENT` backend автоматически проверяет `text` на мат. При срабатывании создается `PROFANITY_DETECTED` action, violation `profanity-detected` и уведомление для оператора.

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
  "eventType": "PHONE_RINGING_DETECTED",
  "source": "audio_classifier",
  "occurredAt": "2026-07-13T12:00:14.500Z",
  "confidence": 0.88,
  "audioTimestampMs": 1720885014500,
  "correlationId": "call-session-temp-123",
  "payload": {
    "className": "phone_ringing",
    "durationMs": 180
  }
}
```

## Event types

Рекомендуемые `eventType` для video/audio в Call Center:

```text
CALL_STARTED
CALL_ENDED
AGENT_PRESENT
AGENT_ABSENT
GREETING_DETECTED
NEED_IDENTIFICATION_DETECTED
CONSULTATION_DETECTED
INCORRECT_TONE_DETECTED
PHONE_DISTRACTION_DETECTED
HEADSET_WORN
HEADSET_REMOVED
PROFANITY_DETECTED
UNAUTHORIZED_PERSON_PRESENT
```

## Detection types

```text
CALL_CENTER_AGENT
CALLER
HEADSET
PHONE
HAND
FACE
POSE
OTHER
```

## Speaker types

```text
CALL_CENTER_AGENT
CALLER
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
- `correlationId`
- `trackId`
- `frameTimestampMs`
- `audioTimestampMs`
- `occurredAt`
- `startedAt`/`endedAt`

Backend env:

```text
AUDIO_VIDEO_CORRELATION_TOLERANCE_MS=3000
```

Python-сервис должен учитывать:

- аудио может приходить раньше видео;
- видео может приходить раньше аудио;
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
  "cameraId": "camera_id",
  "sessionId": "session_id",
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
    "eventType": "HEADSET_WORN",
    "source": "yolo_tracker",
    "occurredAt": "2026-07-13T12:00:00.000Z",
    "confidence": 0.91,
    "payload": {"detections": []},
})
```

## Checklist готовности Python-сервиса для Call Center

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
