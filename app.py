"""Labelling Programs backend API service."""

from fastapi import FastAPI
from config import UPLOAD_DIR


def create_app():
    app = FastAPI(
        title='Labelling Programs API',
        description='Backend APIs for OCR, CLIP image classification, and Key-Value labeling workflows.',
        version='0.1.0'
    )

    UPLOAD_DIR.mkdir(exist_ok=True)

    from routes import clip_router, paddle_ocr_router, keyvalue_router

    app.include_router(clip_router)
    app.include_router(paddle_ocr_router)
    app.include_router(keyvalue_router)

    @app.get('/')
    def service_index():
        return {
            'service': 'labelling_program',
            'mode': 'api-only',
            'status': 'ok',
            'docs': '/docs',
            'health': '/health',
            'groups': {
                'paddle_ocr': ['/api/labeling/paddle_ocr'],
                'clip': ['/analyze/start', '/multi-analyze/start'],
                'keyvalue': ['/editor/check-folder', '/batch/check-folder', '/batch/auto-mapping']
            }
        }

    @app.get('/health')
    @app.get('/api/health')
    def health_check():
        return {
            'service': 'labelling_program',
            'mode': 'api-only',
            'status': 'ok'
        }

    return app


app = create_app()


# ============================================
# 서버 실행 (직접 실행 시에만 - 개발용)
# ============================================

def run_server():
    import os
    import uvicorn

    debug_mode = os.environ.get('APP_DEBUG', '0') == '1'
    uvicorn.run('app:app', host='0.0.0.0', port=5000, reload=debug_mode)


if __name__ == '__main__':
    run_server()
