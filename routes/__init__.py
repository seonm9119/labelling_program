"""Feature route exports."""

from .deepseek_ocr import deepseek_ocr_router
from .paddle_ocr import paddle_ocr_router
from .keyvalue import keyvalue_router

__all__ = ['deepseek_ocr_router', 'paddle_ocr_router', 'keyvalue_router']
