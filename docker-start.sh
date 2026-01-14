#!/bin/bash

# CLIP 이미지 분류기 Docker 서버 시작 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "   Labelling Programs - Docker 서버"
echo "============================================"

# GPU 확인
if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
    echo "[GPU] NVIDIA GPU 감지됨 - GPU 모드로 실행"
    GPU_MODE="gpu"
else
    echo "[CPU] GPU 없음 - CPU 모드로 실행"
    GPU_MODE="cpu"
fi

# 인자 확인
case "${1:-auto}" in
    gpu)
        echo "[모드] GPU 강제 실행 (빌드 + 실행)"
        docker compose up -d --build labelling-program
        ;;
    cpu)
        echo "[모드] CPU 강제 실행 (빌드 + 실행)"
        docker compose --profile cpu up -d --build labelling-program-cpu
        ;;
    build)
        echo "[빌드] Docker 이미지 빌드만 실행..."
        docker compose build
        exit 0
        ;;
    stop)
        echo "[중지] 컨테이너 중지 중..."
        docker compose down
        exit 0
        ;;
    logs)
        docker compose logs -f
        exit 0
        ;;
    rebuild)
        echo "[재빌드] 캐시 없이 처음부터 빌드..."
        docker compose build --no-cache
        exit 0
        ;;
    *)
        # 자동 감지 (빌드 + 실행)
        if [ "$GPU_MODE" = "gpu" ]; then
            docker compose up -d --build labelling-program
        else
            docker compose --profile cpu up -d --build labelling-program-cpu
        fi
        ;;
esac

echo ""
echo "============================================"
echo "  접속 주소:"
IP_ADDR=$(hostname -I | awk '{print $1}')
echo "  - 로컬: http://127.0.0.1:5000"
echo "  - 네트워크: http://${IP_ADDR}:5000"
echo "============================================"
echo ""
echo "명령어:"
echo "  로그 확인: ./docker-start.sh logs"
echo "  서버 중지: ./docker-start.sh stop"
echo "  빌드만: ./docker-start.sh build"
echo "  캐시 없이 재빌드: ./docker-start.sh rebuild"
echo ""
