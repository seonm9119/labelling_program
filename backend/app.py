"""
Labelling Programs - FastAPI 서버
다양한 라벨링 모델을 위한 웹 인터페이스
"""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from backend.config import FRONTEND_DIR, UPLOAD_DIR


def create_app():
    app = FastAPI(
        title='Labelling Programs',
        description='OCR, CLIP, and Key-Value annotation tools',
        version='0.1.0'
    )
    app.mount('/static', StaticFiles(directory=str(FRONTEND_DIR / 'static')), name='static')

    UPLOAD_DIR.mkdir(exist_ok=True)

    from backend.routes import clip_router, ocr_router, keyvalue_router

    app.include_router(clip_router)
    app.include_router(ocr_router)
    app.include_router(keyvalue_router)

    return app


app = create_app()


# ============================================
# 서버 실행 (직접 실행 시에만 - 개발용)
# ============================================

def run_server():
    import os
    import uvicorn

    debug_mode = os.environ.get('APP_DEBUG', '0') == '1'
    uvicorn.run('backend.app:app', host='0.0.0.0', port=5000, reload=debug_mode)


if __name__ == '__main__':
    run_server()
