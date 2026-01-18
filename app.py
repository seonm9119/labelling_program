"""
Labelling Programs - Flask 서버
다양한 라벨링 모델을 위한 웹 인터페이스
"""

from flask import Flask
from pathlib import Path

# Flask 앱 생성
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB

# 임시 업로드 폴더 생성
UPLOAD_FOLDER = Path('uploads')
UPLOAD_FOLDER.mkdir(exist_ok=True)

# ============================================
# Blueprint 등록
# ============================================

from routes import clip_bp, ocr_bp, keyvalue_bp

# CLIP 라우트 (메인 페이지 포함)
app.register_blueprint(clip_bp)

# OCR 라우트
app.register_blueprint(ocr_bp)

# Key-Value 라우트
app.register_blueprint(keyvalue_bp)


# ============================================
# 서버 실행 (직접 실행 시에만 - 개발용)
# ============================================

if __name__ == '__main__':
    import os
    # 환경변수로 디버그 모드 제어
    debug_mode = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(debug=debug_mode, host='0.0.0.0', port=5000, threaded=True)
