"""Feature route exports."""

from .clip import clip_router
from .paddle_ocr import paddle_ocr_router
from .keyvalue import keyvalue_router

__all__ = ['clip_router', 'paddle_ocr_router', 'keyvalue_router']
