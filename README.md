# Labelling Program API

FastAPI 기반의 OCR/Layout API 게이트웨이입니다.

이 서비스는 프론트엔드에서 업로드한 문서 이미지를 외부 모델 컨테이너로 전달하고,
각 모델 응답을 라벨링 화면에서 쓰기 쉬운 공통 box 형식으로 정규화해서 반환합니다.
현재 역할은 OCR 모델과 layout 모델 호출에 집중하며, key-value 모델 로직은 이 서비스에서 분리되어 있습니다.

## 주요 역할

- Paddle OCR 단일 이미지 및 대용량 배치 OCR 요청 처리
- DeepSeek OCR 단일 이미지 및 대용량 배치 OCR 요청 처리
- DocLayout-YOLO 문서 layout detection 요청 처리
- PP-StructureV3 문서 구조 분석 요청 처리
- 서버 폴더 탐색 및 배치 작업 결과 이미지 제공
- OCR 배치 완료 알림 및 Google email 인증 흐름 유지

## 프로젝트 구조

```text
.
├── app.py                 # FastAPI 앱 생성 및 health/index endpoint
├── config.py              # 환경변수 기반 서비스 설정
├── docker-compose.yml     # labeling-program 컨테이너 실행 설정
├── Dockerfile             # API 컨테이너 이미지 빌드 설정
├── routes/
│   ├── layout.py          # layout API route
│   └── ocr.py             # OCR router 조립
├── services/
│   ├── deepseek_ocr.py    # DeepSeek OCR API, batch job, 결과 변환
│   ├── doclayout.py       # DocLayout-YOLO API 호출
│   ├── paddle_ocr.py      # Paddle OCR API, batch job, 알림/인증 route
│   └── ppstructure.py     # PP-StructureV3 API 호출 및 layout box 변환
└── utils/
    ├── email_notification.py
    ├── file_utils.py
    ├── google_email.py
    ├── labeling_boxes.py
    ├── ocr_result_files.py
    └── responses.py
```

## 실행

### Docker Compose

모델 컨테이너들이 같은 Docker network에서 실행되어 있어야 합니다.

```bash
docker network create model-network
docker compose up -d --build labeling-program
```

이미 `model-network`가 존재한다면 network 생성 명령은 생략하면 됩니다.

서비스 확인:

```bash
curl http://127.0.0.1:5001/health
```

정상 응답:

```json
{"service":"labeling-program","mode":"api-only","status":"ok"}
```

### 로컬 실행

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

기본 포트는 `5001`입니다.

## API

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/` | 서비스 인덱스 |
| `GET` | `/health` | health check |
| `GET` | `/api/health` | health check alias |
| `POST` | `/api/labeling/paddle_ocr` | Paddle OCR 단일 이미지 분석 |
| `POST` | `/api/labeling/paddle_ocr/bulk` | Paddle OCR 업로드 이미지 배치 분석 |
| `POST` | `/api/labeling/paddle_ocr/bulk/jobs` | Paddle OCR 서버 경로 기반 배치 작업 시작 |
| `GET` | `/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}` | Paddle OCR 배치 작업 상태 조회 |
| `POST` | `/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}/stop` | Paddle OCR 배치 작업 중지 요청 |
| `GET` | `/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}/images/{image_index}` | Paddle OCR 배치 이미지 조회 |
| `GET` | `/api/labeling/paddle_ocr/server-folders` | 서버 폴더 목록 조회 |
| `POST` | `/api/labeling/paddle_ocr/server-folders` | 서버 폴더 생성 |
| `GET` | `/api/labeling/paddle_ocr/email/google/status` | Google email 연결 상태 |
| `GET` | `/api/labeling/paddle_ocr/email/google/auth-url` | Google OAuth 인증 URL 생성 |
| `GET` | `/api/labeling/paddle_ocr/email/google/callback` | Google OAuth redirect callback |
| `POST` | `/api/labeling/paddle_ocr/email/google/code` | Google OAuth popup code 처리 |
| `POST` | `/api/labeling/deepseek_ocr` | DeepSeek OCR 단일 이미지 분석 |
| `POST` | `/api/labeling/deepseek_ocr/bulk` | DeepSeek OCR 업로드 이미지 배치 분석 |
| `POST` | `/api/labeling/deepseek_ocr/bulk/jobs` | DeepSeek OCR 서버 경로 기반 배치 작업 시작 |
| `GET` | `/api/labeling/deepseek_ocr/bulk/jobs/{bulk_job_id}` | DeepSeek OCR 배치 작업 상태 조회 |
| `POST` | `/api/labeling/deepseek_ocr/bulk/jobs/{bulk_job_id}/stop` | DeepSeek OCR 배치 작업 중지 요청 |
| `GET` | `/api/labeling/deepseek_ocr/bulk/jobs/{bulk_job_id}/images/{image_index}` | DeepSeek OCR 배치 이미지 조회 |
| `GET` | `/api/labeling/deepseek_ocr/server-folders` | 서버 폴더 목록 조회 |
| `POST` | `/api/labeling/deepseek_ocr/server-folders` | 서버 폴더 생성 |
| `POST` | `/api/labeling/layout` | DocLayout-YOLO 또는 PP-StructureV3 layout 분석 |

## 요청 예시

### Paddle OCR

```bash
curl -X POST http://127.0.0.1:5001/api/labeling/paddle_ocr \
  -F "image=@sample.png"
```

### DeepSeek OCR

```bash
curl -X POST http://127.0.0.1:5001/api/labeling/deepseek_ocr \
  -F "image=@sample.png"
```

### Layout

기본 모델은 `doclayout-yolo`입니다.

```bash
curl -X POST http://127.0.0.1:5001/api/labeling/layout \
  -F "image=@sample.png" \
  -F "model=doclayout-yolo"
```

PP-StructureV3를 사용하려면 `model=pp-structurev3`를 전달합니다.

```bash
curl -X POST http://127.0.0.1:5001/api/labeling/layout \
  -F "image=@sample.png" \
  -F "model=pp-structurev3"
```

## 주요 환경변수

### 앱

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `APP_PORT` | `5001` | API 서버 포트 |
| `APP_DEBUG` | `0` | `1`이면 uvicorn reload 활성화 |
| `SERVER_FOLDER_ROOT` | `/mnt/h` | 서버 폴더 탐색 루트 |
| `SERVER_BULK_OUTPUT_ROOT` | `/mnt/h` | 배치 결과 저장 루트 |

### 모델 API

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PADDLE_OCR_API_URL` | `http://paddle-ocr:8001/inference` | Paddle OCR inference endpoint |
| `PADDLE_OCR_RELEASE_URL` | `http://paddle-ocr:8001/release` | Paddle OCR resource release endpoint |
| `DEEPSEEK_OCR_API_URL` | `http://deepseek-ocr:8002/inference` | DeepSeek OCR inference endpoint |
| `DEEPSEEK_OCR_RELEASE_URL` | `http://deepseek-ocr:8002/release` | DeepSeek OCR resource release endpoint |
| `DOCLAYOUT_API_URL` | `http://doclayout:8003/inference` | DocLayout-YOLO inference endpoint |
| `PP_STRUCTURE_API_URL` | `http://pp-structurev3:8004/inference` | PP-StructureV3 inference endpoint |

### 알림 및 인증

| 변수 | 설명 |
| --- | --- |
| `OCR_NOTIFY_EMAIL_ENABLED` | OCR 배치 완료 email 알림 활성화 여부 |
| `OCR_NOTIFY_EMAIL_TO` | 알림 수신 email |
| `OCR_NOTIFY_EMAIL_AUTH_MODE` | `smtp` 또는 Google 인증 방식 |
| `SMTP_NOTIFY_EMAIL_HOST` | SMTP 서버 host |
| `SMTP_NOTIFY_EMAIL_USERNAME` | SMTP 계정 |
| `SMTP_NOTIFY_EMAIL_PASSWORD` | SMTP 비밀번호 또는 앱 비밀번호 |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client id |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Google OAuth redirect URI |
| `GOOGLE_EMAIL_SECRET_DIR` | Google 인증 상태 저장 디렉터리 |

## 개발 확인

```bash
python3 -m py_compile app.py config.py routes/*.py services/*.py utils/*.py
docker compose config --quiet
curl http://127.0.0.1:5001/health
```

## 범위

이 저장소는 프론트엔드가 OCR/Layout 모델을 호출하기 위한 API 계층입니다.
Key-value 모델 및 key-value 매핑 로직은 이 서비스에서 제거되었으며,
별도 modelAPI 영역에서 관리하는 것을 전제로 합니다.
