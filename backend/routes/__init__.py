# Routes 패키지
# 각 기능별 라우트를 모듈로 분리

from .clip import clip_bp
from .ocr import ocr_bp
from .keyvalue import keyvalue_bp

__all__ = ['clip_bp', 'ocr_bp', 'keyvalue_bp']
