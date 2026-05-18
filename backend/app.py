"""
Labelling Programs - Flask 서버
다양한 라벨링 모델을 위한 웹 인터페이스
"""

from flask import Flask
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / 'frontend'


def create_app():
    app = Flask(
        __name__,
        template_folder=str(FRONTEND_DIR / 'templates'),
        static_folder=str(FRONTEND_DIR / 'static')
    )
    app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB

    upload_folder = BASE_DIR / 'uploads'
    upload_folder.mkdir(exist_ok=True)

    from backend.routes import clip_bp, ocr_bp, keyvalue_bp

    app.register_blueprint(clip_bp)
    app.register_blueprint(ocr_bp)
    app.register_blueprint(keyvalue_bp)

    return app


app = create_app()


# ============================================
# 서버 실행 (직접 실행 시에만 - 개발용)
# ============================================

def run_server():
    import os
    debug_mode = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(debug=debug_mode, host='0.0.0.0', port=5000, threaded=True)


if __name__ == '__main__':
    run_server()
