import urllib.error
from pathlib import Path

from fastapi import APIRouter, Request

from config import AWESOMI_KEYVALUE_API_TIMEOUT, AWESOMI_KEYVALUE_API_URL
from services.utils.keyvalue import read_keyvalue_http_error
from services.utils.keyvalue import request_keyvalue_model
from utils.responses import json_response


keyvalue_router = APIRouter()
QWEN_KEYVALUE_MODEL = 'qwen-vlm'
GPT_KEYVALUE_MODEL = 'gpt'
DEFAULT_KEYVALUE_MODEL = QWEN_KEYVALUE_MODEL


@keyvalue_router.post('/api/labeling/keyvalue')
async def extract_keyvalue_for_labeling(request: Request):
    form = await request.form()

    if 'image' not in form:
        return json_response({'success': False, 'error': '이미지가 필요합니다.'}, status_code=400)

    uploaded_image = form['image']
    if uploaded_image.filename == '':
        return json_response({'success': False, 'error': '이미지가 선택되지 않았습니다.'}, status_code=400)

    image_bytes = await uploaded_image.read()
    if not image_bytes:
        return json_response({'success': False, 'error': '빈 이미지 파일입니다.'}, status_code=400)

    image_filename = Path(uploaded_image.filename).name
    include_raw = str(form.get('includeRaw', '')).lower() == 'true'
    selected_model = normalize_keyvalue_model(form.get('model'))

    try:
        keyvalue_response = request_keyvalue_model(
            AWESOMI_KEYVALUE_API_URL,
            AWESOMI_KEYVALUE_API_TIMEOUT,
            image_filename,
            image_bytes,
            selected_model,
            include_raw
        )
    except urllib.error.HTTPError as error:
        api_name = get_keyvalue_model_label(selected_model)
        return json_response({'success': False, 'error': read_keyvalue_http_error(error, api_name)}, status_code=error.code)
    except urllib.error.URLError as error:
        api_name = get_keyvalue_model_label(selected_model)
        return json_response({'success': False, 'error': f'{api_name} 연결 실패: {error.reason}'}, status_code=502)

    return json_response({
        'success': True,
        'selectedModel': selected_model,
        **keyvalue_response
    })


def normalize_keyvalue_model(selected_model):
    normalized_model = str(selected_model or DEFAULT_KEYVALUE_MODEL).strip().lower().replace('_', '-')
    if normalized_model in ['gpt', 'openai', 'openai-gpt', GPT_KEYVALUE_MODEL]:
        return GPT_KEYVALUE_MODEL

    return DEFAULT_KEYVALUE_MODEL


def get_keyvalue_model_label(selected_model):
    if selected_model == GPT_KEYVALUE_MODEL:
        return 'Awesomi GPT Key-Value API'

    return 'Awesomi Qwen Key-Value API'
