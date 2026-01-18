#!/bin/bash

# CLIP 이미지 분류기 Docker 서버 시작 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "   Labelling Programs - Docker 서버"
echo "============================================"

# GPU 하드웨어 확인
GPU_HARDWARE=false
if command -v lspci &> /dev/null; then
    if lspci | grep -i nvidia &> /dev/null; then
        GPU_HARDWARE=true
    fi
fi

# GPU 확인 및 nvidia-container-toolkit 설치
if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
    echo "[GPU] NVIDIA GPU 감지됨 - GPU 모드로 실행"
elif [ "$GPU_HARDWARE" = true ]; then
    echo "[GPU] NVIDIA GPU 하드웨어가 감지되었지만 nvidia-smi를 사용할 수 없습니다."
    echo "[설치] nvidia-container-toolkit 설치를 시도합니다..."
    
    # 배포판 확인
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRIBUTION=$ID$VERSION_ID
    else
        echo "[오류] OS 배포판을 확인할 수 없습니다."
        DISTRIBUTION=""
    fi
    
    # Ubuntu/Debian 계열
    if [[ "$ID" == "ubuntu" ]] || [[ "$ID" == "debian" ]]; then
        echo "[설치] Ubuntu/Debian용 nvidia-container-toolkit 설치 중..."
        
        # GPG 키 추가
        if ! curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null; then
            echo "[오류] GPG 키 추가 실패. sudo 권한이 필요할 수 있습니다."
        else
            # 저장소 추가
            curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
                sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
                sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
            
            # 패키지 설치
            if sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit; then
                echo "[설치] nvidia-container-toolkit 설치 완료"
                echo "[재시작] Docker 데몬 재시작 중..."
                sudo systemctl restart docker
                echo "[완료] Docker 재시작 완료"
                
                # 다시 GPU 확인
                if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
                    echo "[GPU] NVIDIA GPU 감지됨 - GPU 모드로 실행"
                else
                    echo "[경고] nvidia-container-toolkit 설치 후에도 GPU가 감지되지 않습니다."
                    echo "[경고] 시스템 재부팅이 필요할 수 있습니다."
                fi
            else
                echo "[오류] nvidia-container-toolkit 설치 실패. sudo 권한이 필요할 수 있습니다."
            fi
        fi
    # CentOS/RHEL 계열
    elif [[ "$ID" == "rhel" ]] || [[ "$ID" == "centos" ]] || [[ "$ID" == "fedora" ]]; then
        echo "[설치] RHEL/CentOS/Fedora용 nvidia-container-toolkit 설치 중..."
        
        # 저장소 추가 및 설치
        distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
        curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | \
            sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo > /dev/null
        
        if sudo yum install -y nvidia-container-toolkit; then
            echo "[설치] nvidia-container-toolkit 설치 완료"
            echo "[재시작] Docker 데몬 재시작 중..."
            sudo systemctl restart docker
            echo "[완료] Docker 재시작 완료"
            
            # 다시 GPU 확인
            if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
                echo "[GPU] NVIDIA GPU 감지됨 - GPU 모드로 실행"
            else
                echo "[경고] nvidia-container-toolkit 설치 후에도 GPU가 감지되지 않습니다."
                echo "[경고] 시스템 재부팅이 필요할 수 있습니다."
            fi
        else
            echo "[오류] nvidia-container-toolkit 설치 실패. sudo 권한이 필요할 수 있습니다."
        fi
    else
        echo "[경고] 지원하지 않는 배포판입니다: $ID"
        echo "[경고] 수동으로 nvidia-container-toolkit을 설치해주세요."
    fi
    echo ""
else
    echo "[경고] NVIDIA GPU 하드웨어가 감지되지 않았습니다."
    echo "[경고] GPU가 없는 시스템에서는 GPU 기능을 사용할 수 없습니다."
    echo ""
fi

# 인자 확인
case "${1:-auto}" in
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
        # GPU 모드로 실행 (빌드 + 실행)
        docker compose up -d --build labelling-dev
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
