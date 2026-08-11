import base64
import json
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Request

from config import PADDLE_OCR_API_TIMEOUT, PADDLE_OCR_API_URL, PADDLE_OCR_RELEASE_URL, UPLOAD_DIR
from utils.labeling_boxes import build_labeling_boxes, read_image_size
from utils.ocr_result_files import read_raw_ocr_response, saved_temporary_raw_ocr_response
from utils.responses import json_response

paddle_ocr_router = APIRouter()


@paddle_ocr_router.post('/api/labeling/paddle_ocr')
async def extract_paddle_ocr_for_labeling(request: Request):
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
    paddle_labeling_result = extract_paddle_labeling_result(image_filename, image_bytes)

    return json_response({
        'success': True,
        **paddle_labeling_result
    })


def extract_paddle_labeling_result(image_filename, image_bytes, release_after_inference=True):
    image_width, image_height = read_image_size(image_bytes)
    paddle_ocr_response = request_paddle_ocr(image_bytes, release_after_inference=release_after_inference)

    with saved_temporary_raw_ocr_response(UPLOAD_DIR, 'paddle_ocr_', paddle_ocr_response) as raw_response_path:
        return build_paddle_labeling_result_from_raw_file(image_filename, image_width, image_height, raw_response_path)


def build_paddle_labeling_result_from_raw_file(image_filename, image_width, image_height, raw_response_path):
    paddle_ocr_response = read_raw_ocr_response(raw_response_path)
    return build_paddle_labeling_result(image_filename, image_width, image_height, paddle_ocr_response)


def build_paddle_labeling_result(image_filename, image_width, image_height, paddle_ocr_response):
    paddle_boxes = extract_paddle_boxes(paddle_ocr_response)
    labeling_boxes = build_labeling_boxes(paddle_boxes, image_width, image_height, 'paddle')

    return {
        'displayType': 'bbox_overlay',
        'image': {
            'filename': image_filename,
            'width': image_width,
            'height': image_height
        },
        'boxes': labeling_boxes
    }


def request_paddle_ocr(image_bytes, release_after_inference=True):
    byte_img = base64.b64encode(image_bytes).decode('utf-8')
    payload = json.dumps({
        'byte_img': byte_img,
        'predict_options': {},
        'release_after_inference': release_after_inference
    }).encode('utf-8')

    request = urllib.request.Request(PADDLE_OCR_API_URL, data=payload, headers={'Content-Type': 'application/json'})

    try:
        with urllib.request.urlopen(request, timeout=PADDLE_OCR_API_TIMEOUT) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        error_body = error.read().decode('utf-8', errors='replace')
        release_paddle_ocr()
        raise RuntimeError(format_paddle_ocr_http_error(error.code, error_body)) from None
    except Exception:
        release_paddle_ocr()
        raise


def format_paddle_ocr_http_error(status_code, error_body):
    try:
        error_payload = json.loads(error_body or '{}')
        detail = error_payload.get('detail') or error_body
    except json.JSONDecodeError:
        detail = error_body

    detail = str(detail or '').strip()
    if detail:
        return f'HTTP {status_code}: {detail}'

    return f'HTTP {status_code}'


def release_paddle_ocr():
    release_request = urllib.request.Request(PADDLE_OCR_RELEASE_URL, data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')

    try:
        with urllib.request.urlopen(release_request, timeout=PADDLE_OCR_API_TIMEOUT) as response:
            response.read()
        return True
    except Exception:
        return False


def extract_paddle_boxes(paddle_ocr_response):
    paddle_boxes = []

    for ocr_page in paddle_ocr_response:
        ocr_result = ocr_page.get('res', ocr_page)
        rec_texts = ocr_result.get('rec_texts', [])
        rec_scores = ocr_result.get('rec_scores', [])
        rec_boxes = ocr_result.get('rec_boxes', [])

        for text_index, text in enumerate(rec_texts):
            if not text or not text.strip():
                continue

            paddle_boxes.append({
                'type': 'text',
                'text': text,
                'confidence': float(rec_scores[text_index]) if text_index < len(rec_scores) else 1.0,
                'bbox': rec_boxes[text_index] if text_index < len(rec_boxes) else None
            })

    return paddle_boxes
