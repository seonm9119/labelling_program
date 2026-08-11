import ast
import base64
import html
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Request

from config import (
    DEEPSEEK_OCR_API_TIMEOUT,
    DEEPSEEK_OCR_API_URL,
    DEEPSEEK_OCR_BASE_SIZE,
    DEEPSEEK_OCR_CROP_MODE,
    DEEPSEEK_OCR_IMAGE_SIZE,
    DEEPSEEK_OCR_MAX_NEW_TOKENS,
    DEEPSEEK_OCR_PROMPT,
    DEEPSEEK_OCR_RELEASE_URL,
    DEEPSEEK_OCR_USE_CACHE,
    UPLOAD_DIR,
)
from utils.labeling_boxes import build_labeling_boxes, read_image_size
from utils.ocr_result_files import read_raw_ocr_response, saved_temporary_raw_ocr_response
from utils.responses import json_response

deepseek_ocr_router = APIRouter()
DEEPSEEK_REF_DET_PATTERN = re.compile(r'<\|ref\|>(.*?)<\|/ref\|>\s*<\|det\|>(.*?)<\|/det\|>', re.DOTALL)
DEEPSEEK_TABLE_PATTERN = re.compile(r'<table\b.*?</table>', re.DOTALL | re.IGNORECASE)
DEEPSEEK_HTML_TAG_PATTERN = re.compile(r'<[^>]+>')
DEEPSEEK_COORDINATE_MAX = 999.0


@deepseek_ocr_router.post('/api/labeling/deepseek_ocr')
async def extract_deepseek_ocr_for_labeling(request: Request):
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

    try:
        deepseek_labeling_result = extract_deepseek_labeling_result(image_filename, image_bytes)
    except urllib.error.HTTPError as error:
        return json_response({'success': False, 'error': read_deepseek_error(error)}, status_code=error.code)
    except RuntimeError as error:
        return json_response({'success': False, 'error': str(error)}, status_code=get_deepseek_error_status_code(error))
    except urllib.error.URLError as error:
        return json_response({'success': False, 'error': f'DeepSeek OCR 연결 실패: {error.reason}'}, status_code=502)

    return json_response({
        'success': True,
        **deepseek_labeling_result
    })


def extract_deepseek_labeling_result(image_filename, image_bytes, release_after_inference=True):
    image_width, image_height = read_image_size(image_bytes)
    deepseek_ocr_response = request_deepseek_ocr(image_bytes, release_after_inference=release_after_inference)

    with saved_temporary_raw_ocr_response(UPLOAD_DIR, 'deepseek_ocr_', deepseek_ocr_response) as raw_response_path:
        return build_deepseek_labeling_result_from_raw_file(image_filename, image_width, image_height, raw_response_path)


def build_deepseek_labeling_result_from_raw_file(image_filename, image_width, image_height, raw_response_path):
    deepseek_ocr_response = read_raw_ocr_response(raw_response_path)
    return build_deepseek_labeling_result(image_filename, image_width, image_height, deepseek_ocr_response)


def build_deepseek_labeling_result(image_filename, image_width, image_height, deepseek_ocr_response):
    deepseek_boxes = extract_deepseek_boxes(deepseek_ocr_response, image_width, image_height)
    labeling_boxes = build_labeling_boxes(deepseek_boxes, image_width, image_height, 'deepseek')

    return {
        'model': deepseek_ocr_response.get('model', 'deepseek-ocr2'),
        'displayType': 'bbox_overlay',
        'image': {
            'filename': image_filename,
            'width': image_width,
            'height': image_height
        },
        'boxes': labeling_boxes
    }


def request_deepseek_ocr(image_bytes, release_after_inference=True):
    byte_img = base64.b64encode(image_bytes).decode('utf-8')
    payload = json.dumps({
        'byte_img': byte_img,
        'release_after_inference': release_after_inference,
        'predict_options': {
            'prompt': DEEPSEEK_OCR_PROMPT,
            'base_size': DEEPSEEK_OCR_BASE_SIZE,
            'image_size': DEEPSEEK_OCR_IMAGE_SIZE,
            'crop_mode': DEEPSEEK_OCR_CROP_MODE,
            'max_new_tokens': DEEPSEEK_OCR_MAX_NEW_TOKENS,
            'use_cache': DEEPSEEK_OCR_USE_CACHE,
            'save_results': False,
            'keep_results': False
        }
    }).encode('utf-8')
    request = urllib.request.Request(DEEPSEEK_OCR_API_URL, data=payload, headers={'Content-Type': 'application/json'})

    try:
        with urllib.request.urlopen(request, timeout=DEEPSEEK_OCR_API_TIMEOUT) as response:
            return json.loads(response.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as error:
        error_body = error.read().decode('utf-8', errors='replace')
        release_deepseek_ocr()
        raise RuntimeError(format_deepseek_ocr_http_error(error.code, error_body)) from None
    except Exception:
        release_deepseek_ocr()
        raise


def format_deepseek_ocr_http_error(status_code, error_body):
    try:
        error_payload = json.loads(error_body or '{}')
        detail = error_payload.get('detail') or error_body
    except json.JSONDecodeError:
        detail = error_body

    detail = str(detail or '').strip()
    if detail:
        return f'HTTP {status_code}: {detail}'

    return f'HTTP {status_code}'


def get_deepseek_error_status_code(error):
    status_match = re.match(r'HTTP\s+(\d+)', str(error))
    if status_match:
        return int(status_match.group(1))

    return 500


def release_deepseek_ocr():
    release_request = urllib.request.Request(DEEPSEEK_OCR_RELEASE_URL, data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')

    try:
        with urllib.request.urlopen(release_request, timeout=DEEPSEEK_OCR_API_TIMEOUT) as response:
            response.read()
        return True
    except Exception:
        return False


def extract_deepseek_boxes(deepseek_ocr_response, image_width, image_height):
    generated_text = deepseek_ocr_response.get('text', '') if isinstance(deepseek_ocr_response, dict) else ''
    deepseek_boxes = []
    ref_matches = list(DEEPSEEK_REF_DET_PATTERN.finditer(generated_text))

    for match_index, ref_match in enumerate(ref_matches):
        box_label = normalize_deepseek_label(ref_match.group(1))
        coordinate_boxes = parse_deepseek_coordinate_text(ref_match.group(2))
        rec_content = extract_deepseek_rec_content(generated_text, ref_matches, match_index)
        rec_text = normalize_deepseek_rec_text(rec_content)
        rec_html = extract_deepseek_table_html(rec_content) if box_label == 'table' else ''

        for coordinate_box in coordinate_boxes:
            pixel_bbox = scale_deepseek_bbox(coordinate_box, image_width, image_height)
            if not pixel_bbox:
                continue

            deepseek_box = {
                'id': f"deepseek-{len(deepseek_boxes) + 1}",
                'type': box_label,
                'text': rec_text,
                'confidence': 1.0,
                'bbox': pixel_bbox
            }

            if rec_html:
                deepseek_box['html'] = rec_html

            deepseek_boxes.append(deepseek_box)

    return deepseek_boxes


def normalize_deepseek_label(label_text):
    normalized_label = re.sub(r'\s+', ' ', str(label_text or '')).strip()
    return normalized_label or 'bbox'


def extract_deepseek_rec_content(generated_text, ref_matches, match_index):
    content_start = ref_matches[match_index].end()
    content_end = ref_matches[match_index + 1].start() if match_index + 1 < len(ref_matches) else len(generated_text)
    return generated_text[content_start:content_end].strip()


def extract_deepseek_table_html(rec_content):
    table_match = DEEPSEEK_TABLE_PATTERN.search(rec_content or '')
    if not table_match:
        return ''

    return table_match.group(0).strip()


def normalize_deepseek_rec_text(rec_content):
    rec_text = str(rec_content or '').strip()
    if not rec_text:
        return ''

    rec_text = re.sub(r'!\[[^\]]*\]\([^)]+\)', ' ', rec_text)
    rec_text = re.sub(r'<br\s*/?>', '\n', rec_text, flags=re.IGNORECASE)
    rec_text = re.sub(r'</(td|th)>', ' ', rec_text, flags=re.IGNORECASE)
    rec_text = re.sub(r'</tr>', '\n', rec_text, flags=re.IGNORECASE)
    rec_text = DEEPSEEK_HTML_TAG_PATTERN.sub(' ', rec_text)
    rec_text = html.unescape(rec_text)
    rec_text = re.sub(r'^\s{0,3}#{1,6}\s*', '', rec_text, flags=re.MULTILINE)
    rec_text = re.sub(r'[ \t]+', ' ', rec_text)
    rec_text = re.sub(r'\n\s+', '\n', rec_text)
    rec_text = re.sub(r'\n{3,}', '\n\n', rec_text)
    return rec_text.strip()


def parse_deepseek_coordinate_text(coordinate_text):
    try:
        coordinates = ast.literal_eval(coordinate_text.strip())
    except (SyntaxError, ValueError):
        return []

    return flatten_deepseek_coordinate_boxes(coordinates)


def flatten_deepseek_coordinate_boxes(coordinates):
    if is_coordinate_box(coordinates):
        return [coordinates]

    if not isinstance(coordinates, (list, tuple)):
        return []

    coordinate_boxes = []
    for coordinate_group in coordinates:
        coordinate_boxes.extend(flatten_deepseek_coordinate_boxes(coordinate_group))

    return coordinate_boxes


def is_coordinate_box(coordinates):
    return (
        isinstance(coordinates, (list, tuple))
        and len(coordinates) == 4
        and all(isinstance(coordinate, (int, float)) for coordinate in coordinates)
    )


def scale_deepseek_bbox(coordinate_box, image_width, image_height):
    if not is_coordinate_box(coordinate_box):
        return None

    x1, y1, x2, y2 = [float(coordinate) for coordinate in coordinate_box]
    if min(x1, y1, x2, y2) < 0 or max(x1, y1, x2, y2) > DEEPSEEK_COORDINATE_MAX:
        return None

    scaled_x1 = x1 / DEEPSEEK_COORDINATE_MAX * image_width
    scaled_y1 = y1 / DEEPSEEK_COORDINATE_MAX * image_height
    scaled_x2 = x2 / DEEPSEEK_COORDINATE_MAX * image_width
    scaled_y2 = y2 / DEEPSEEK_COORDINATE_MAX * image_height

    return [
        min(scaled_x1, scaled_x2),
        min(scaled_y1, scaled_y2),
        max(scaled_x1, scaled_x2),
        max(scaled_y1, scaled_y2)
    ]


def read_deepseek_error(error):
    try:
        error_body = error.read().decode('utf-8')
    except Exception:
        return 'DeepSeek OCR 처리에 실패했습니다.'

    if not error_body:
        return 'DeepSeek OCR 처리에 실패했습니다.'

    try:
        error_payload = json.loads(error_body)
    except json.JSONDecodeError:
        return error_body

    return error_payload.get('detail') or error_payload.get('error') or error_body
