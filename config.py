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

SERVER_FOLDER_ROOT = Path(os.environ.get('SERVER_FOLDER_ROOT', '/mnt/h'))
SERVER_BULK_OUTPUT_ROOT = Path(os.environ.get('SERVER_BULK_OUTPUT_ROOT', '/mnt/h'))

OCR_NOTIFY_EMAIL_ENABLED = os.environ.get('OCR_NOTIFY_EMAIL_ENABLED', '1').lower() not in ['0', 'false', 'no', 'off']
OCR_NOTIFY_EMAIL_TO = os.environ.get('OCR_NOTIFY_EMAIL_TO', 'seonm9119@gmail.com').strip()
OCR_NOTIFY_EMAIL_SUBJECT_PREFIX = os.environ.get('OCR_NOTIFY_EMAIL_SUBJECT_PREFIX', '[Paddle OCR]').strip()
OCR_NOTIFY_EMAIL_AUTH_MODE = os.environ.get('OCR_NOTIFY_EMAIL_AUTH_MODE', 'smtp').strip().lower()

SMTP_NOTIFY_EMAIL_HOST = os.environ.get('SMTP_NOTIFY_EMAIL_HOST', 'smtp.gmail.com').strip()
SMTP_NOTIFY_EMAIL_PORT = int(os.environ.get('SMTP_NOTIFY_EMAIL_PORT', '587'))
SMTP_NOTIFY_EMAIL_USERNAME = os.environ.get('SMTP_NOTIFY_EMAIL_USERNAME', '').strip()
SMTP_NOTIFY_EMAIL_PASSWORD = os.environ.get('SMTP_NOTIFY_EMAIL_PASSWORD', '')
SMTP_NOTIFY_EMAIL_FROM = os.environ.get('SMTP_NOTIFY_EMAIL_FROM', SMTP_NOTIFY_EMAIL_USERNAME).strip()
SMTP_NOTIFY_EMAIL_USE_TLS = os.environ.get('SMTP_NOTIFY_EMAIL_USE_TLS', '1').lower() not in ['0', 'false', 'no', 'off']
SMTP_NOTIFY_EMAIL_TIMEOUT = int(os.environ.get('SMTP_NOTIFY_EMAIL_TIMEOUT', '20'))

GOOGLE_OAUTH_CLIENT_ID = os.environ.get('GOOGLE_OAUTH_CLIENT_ID', '').strip()
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get('GOOGLE_OAUTH_CLIENT_SECRET', '')
GOOGLE_OAUTH_REDIRECT_URI = os.environ.get('GOOGLE_OAUTH_REDIRECT_URI', '').strip()
GOOGLE_EMAIL_TOKEN_PATH = Path(os.environ.get('GOOGLE_EMAIL_TOKEN_PATH', '/home/nami/repo/labelling_program/.secrets/google_email_token.json'))
GOOGLE_EMAIL_STATE_PATH = Path(os.environ.get('GOOGLE_EMAIL_STATE_PATH', '/home/nami/repo/labelling_program/.secrets/google_email_state.json'))
GOOGLE_API_TIMEOUT = int(os.environ.get('GOOGLE_API_TIMEOUT', '20'))
