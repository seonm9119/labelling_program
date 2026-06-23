"""Labelling Programs backend API service."""

from fastapi import FastAPI
from config import UPLOAD_DIR


def create_app():
    app = FastAPI(
        title='Labelling Programs API',
        description='Backend APIs for OCR and layout labeling workflows.',
        version='0.1.0'
    )

    UPLOAD_DIR.mkdir(exist_ok=True)

    from routes.keyvalue import keyvalue_router
    from routes.layout import layout_router
    from routes.ocr import ocr_router

    app.include_router(ocr_router)
    app.include_router(layout_router)
    app.include_router(keyvalue_router)

    @app.get('/')
    def service_index():
        return {
            'service': 'labeling-program',
            'mode': 'api-only',
            'status': 'ok',
            'docs': '/docs',
            'health': '/health',
            'groups': {
                'paddle-ocr': ['/api/labeling/paddle_ocr'],
                'deepseek-ocr': ['/api/labeling/deepseek_ocr'],
                'layout': ['/api/labeling/layout'],
                'keyvalue': ['/api/labeling/keyvalue']
            }
        }

    @app.get('/health')
    @app.get('/api/health')
    def health_check():
        return {
            'service': 'labeling-program',
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
    port = int(os.environ.get('APP_PORT', '5001'))
    uvicorn.run('app:app', host='0.0.0.0', port=port, reload=debug_mode)


if __name__ == '__main__':
    run_server()
