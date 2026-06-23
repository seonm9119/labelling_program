import urllib.error
from pathlib import Path

from fastapi import APIRouter, Request

from services.qwen_vlm import extract_keyvalue_result, read_http_error
from utils.responses import json_response


keyvalue_router = APIRouter()


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

    try:
        keyvalue_response = extract_keyvalue_result(image_filename, image_bytes, include_raw)
    except urllib.error.HTTPError as error:
        return json_response({'success': False, 'error': read_http_error(error, 'Qwen VLM API')}, status_code=error.code)
    except urllib.error.URLError as error:
        return json_response({'success': False, 'error': f'Qwen VLM API 연결 실패: {error.reason}'}, status_code=502)

    return json_response({'success': True, **keyvalue_response})
