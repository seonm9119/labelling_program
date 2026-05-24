from pathlib import Path
import os


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / 'uploads'

PADDLE_OCR_API_URL = os.environ.get('PADDLE_OCR_API_URL', 'http://paddle-ocr:8001/inference')
PADDLE_OCR_API_TIMEOUT = int(os.environ.get('PADDLE_OCR_API_TIMEOUT', '120'))

SERVER_FOLDER_ROOT = Path(os.environ.get('SERVER_FOLDER_ROOT', '/mnt/h/data'))
SERVER_BULK_OUTPUT_ROOT = Path(os.environ.get('SERVER_BULK_OUTPUT_ROOT', '/home/nami/repo/labelling_program/outputs/paddle_ocr'))
