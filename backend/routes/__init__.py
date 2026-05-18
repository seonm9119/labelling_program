# Routes 패키지
# 각 기능별 라우트를 모듈로 분리

from .clip import clip_router
from .ocr import ocr_router
from .keyvalue import keyvalue_router

__all__ = ['clip_router', 'ocr_router', 'keyvalue_router']
