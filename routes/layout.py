import json
import urllib.error
from pathlib import Path
from fastapi import APIRouter, Request
from services.doclayout import request_doclayout
from utils.labeling_boxes import build_labeling_boxes, read_image_size
from utils.responses import json_response

layout_router = APIRouter()

DEFAULT_LAYOUT_MODEL = 'doclayout-yolo'


@layout_router.post('/api/labeling/layout')
async def extract_layout_for_labeling(request: Request):
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
    selected_model = normalize_layout_model(form.get('model'))

    try:
        layout_labeling_result = extract_layout_labeling_result(image_filename, image_bytes, selected_model)
    except urllib.error.HTTPError as error:
        return json_response({
            'success': False,
            'error': read_layout_error(error, get_layout_model_label(selected_model))
        }, status_code=error.code)
    except urllib.error.URLError as error:
        return json_response({
            'success': False,
            'error': f'{get_layout_model_label(selected_model)} 연결 실패: {error.reason}'
        }, status_code=502)

    return json_response({
        'success': True,
        **layout_labeling_result
    })


def extract_layout_labeling_result(image_filename, image_bytes, selected_model=DEFAULT_LAYOUT_MODEL, release_after_inference=True):
    image_width, image_height = read_image_size(image_bytes)
    layout_response = request_layout_model(selected_model, image_bytes, release_after_inference)
    layout_boxes = read_layout_boxes(selected_model, layout_response)
    labeling_boxes = build_labeling_boxes(layout_boxes, image_width, image_height, 'layout')

    return {
        'model': layout_response.get('model', get_layout_model_label(selected_model)),
        'selectedModel': selected_model,
        'displayType': 'bbox_overlay',
        'image': {
            'filename': image_filename,
            'width': image_width,
            'height': image_height
        },
        'boxes': labeling_boxes
    }


def normalize_layout_model(selected_model):
    return DEFAULT_LAYOUT_MODEL


def get_layout_model_label(selected_model):
    return 'DocLayout-YOLO'


def request_layout_model(selected_model, image_bytes, release_after_inference=True):
    return request_doclayout(image_bytes, release_after_inference)


def read_layout_boxes(selected_model, layout_response):
    return layout_response.get('boxes', [])


def read_layout_error(error, api_name='DocLayout-YOLO'):
    try:
        error_payload = json.loads(error.read().decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return f'{api_name} API 오류: HTTP {error.code}'

    if isinstance(error_payload, dict):
        detail = error_payload.get('detail') or error_payload.get('error')
        if detail:
            return str(detail)

    return f'{api_name} API 오류: HTTP {error.code}'
