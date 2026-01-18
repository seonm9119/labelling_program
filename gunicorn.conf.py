# Gunicorn 설정 파일
# GPU 작업을 위한 최적화된 설정

import multiprocessing

# 바인드 주소
bind = "0.0.0.0:5000"

# 워커 설정
# GPU 작업은 단일 워커가 더 효율적 (GPU 메모리 공유 문제)
workers = 1

# 스레드 수 - 동시 요청 처리용
threads = 4

# 워커 클래스 - gevent로 비동기 처리
worker_class = "gevent"

# 타임아웃 설정 (초)
# GPU 배치 처리에 충분한 시간 확보
timeout = 600  # 10분

# Keep-alive 타임아웃
keepalive = 65

# 요청 처리 타임아웃
graceful_timeout = 300  # 5분

# 최대 요청 수 (메모리 누수 방지)
max_requests = 1000
max_requests_jitter = 50

# 로깅 설정
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s - %(r)s - %(s)s - %(b)s - %(T)ss'

# 프리로드 앱 (모델 로딩을 한 번만)
preload_app = True

# 워커 시작 시 출력
def on_starting(server):
    print("[Gunicorn] 서버 시작 중...")

def when_ready(server):
    print("[Gunicorn] 서버 준비 완료")

def worker_int(worker):
    print(f"[Gunicorn] 워커 {worker.pid} 인터럽트")

def worker_abort(worker):
    print(f"[Gunicorn] 워커 {worker.pid} 중단")
