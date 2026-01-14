# Labelling Programs Docker 이미지
# GPU 지원을 위한 CUDA 베이스 이미지 사용

FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

WORKDIR /app

# 한국 카카오 미러로 변경 (속도 향상)
RUN sed -i 's|archive.ubuntu.com|mirror.kakao.com|g' /etc/apt/sources.list && \
    sed -i 's|security.ubuntu.com|mirror.kakao.com|g' /etc/apt/sources.list

# 시스템 패키지 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Python 패키지 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 코드 복사
COPY app.py .
COPY models/ models/
COPY templates/ templates/
COPY static/ static/

# uploads 디렉토리 생성
RUN mkdir -p uploads

# 포트 노출
EXPOSE 5000

# 서버 실행
CMD ["python", "app.py"]
