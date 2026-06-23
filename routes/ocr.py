from fastapi import APIRouter

from services.deepseek_ocr import deepseek_ocr_router
from services.paddle_ocr import paddle_ocr_router


ocr_router = APIRouter()
ocr_router.include_router(deepseek_ocr_router)
ocr_router.include_router(paddle_ocr_router)
