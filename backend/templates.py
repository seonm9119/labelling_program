from fastapi.templating import Jinja2Templates
from backend.config import FRONTEND_DIR


templates = Jinja2Templates(directory=str(FRONTEND_DIR / 'templates'))
