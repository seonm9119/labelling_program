from pathlib import Path
import os


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / 'uploads'

PADDLE_OCR_API_URL = os.environ.get('PADDLE_OCR_API_URL', 'http://paddle-ocr:8001/inference')
PADDLE_OCR_RELEASE_URL = os.environ.get('PADDLE_OCR_RELEASE_URL', PADDLE_OCR_API_URL.rsplit('/', 1)[0] + '/release')
PADDLE_OCR_API_TIMEOUT = int(os.environ.get('PADDLE_OCR_API_TIMEOUT', '120'))

DEEPSEEK_OCR_API_URL = os.environ.get('DEEPSEEK_OCR_API_URL', 'http://deepseek-ocr:8002/inference')
DEEPSEEK_OCR_RELEASE_URL = os.environ.get('DEEPSEEK_OCR_RELEASE_URL', DEEPSEEK_OCR_API_URL.rsplit('/', 1)[0] + '/release')
DEEPSEEK_OCR_API_TIMEOUT = int(os.environ.get('DEEPSEEK_OCR_API_TIMEOUT', '600'))
DEEPSEEK_OCR_PROMPT = os.environ.get('DEEPSEEK_OCR_PROMPT', '<image>\n<|grounding|>Convert the document to markdown. ')
DEEPSEEK_OCR_BASE_SIZE = int(os.environ.get('DEEPSEEK_OCR_BASE_SIZE', '1024'))
DEEPSEEK_OCR_IMAGE_SIZE = int(os.environ.get('DEEPSEEK_OCR_IMAGE_SIZE', '768'))
DEEPSEEK_OCR_CROP_MODE = os.environ.get('DEEPSEEK_OCR_CROP_MODE', 'true').lower() == 'true'
DEEPSEEK_OCR_MAX_NEW_TOKENS = int(os.environ.get('DEEPSEEK_OCR_MAX_NEW_TOKENS', '8192'))
DEEPSEEK_OCR_USE_CACHE = os.environ.get('DEEPSEEK_OCR_USE_CACHE', 'true').lower() == 'true'

DOCLAYOUT_API_URL = os.environ.get('DOCLAYOUT_API_URL', 'http://doclayout:8003/inference')
DOCLAYOUT_RELEASE_URL = os.environ.get('DOCLAYOUT_RELEASE_URL', DOCLAYOUT_API_URL.rsplit('/', 1)[0] + '/release')
DOCLAYOUT_API_TIMEOUT = int(os.environ.get('DOCLAYOUT_API_TIMEOUT', '180'))
DOCLAYOUT_IMAGE_SIZE = int(os.environ.get('DOCLAYOUT_IMAGE_SIZE', '1024'))
DOCLAYOUT_CONFIDENCE = float(os.environ.get('DOCLAYOUT_CONFIDENCE', '0.2'))
DOCLAYOUT_IOU = float(os.environ.get('DOCLAYOUT_IOU', '0.45'))
DOCLAYOUT_MAX_DET = int(os.environ.get('DOCLAYOUT_MAX_DET', '300'))

AWESOMI_KEYVALUE_API_URL = os.environ.get('AWESOMI_KEYVALUE_API_URL', 'http://awesomi-api:8080/api/awesomi/keyvalue').strip()
AWESOMI_KEYVALUE_API_TIMEOUT = int(os.environ.get('AWESOMI_KEYVALUE_API_TIMEOUT', '180'))
