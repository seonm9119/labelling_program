import base64
import json
import urllib.request
from io import BytesIO
from pathlib import Path
from fastapi import APIRouter, Request
from PIL import Image as PILImage
from config import PADDLE_OCR_API_TIMEOUT, PADDLE_OCR_API_URL
from responses import json_response

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
    print(f"[Paddle OCR] image={uploaded_image.filename}", flush=True)

    with PILImage.open(BytesIO(image_bytes)) as image:
        image_width, image_height = image.size

    paddle_ocr_response = request_paddle_ocr(image_bytes)
    paddle_boxes = extract_paddle_boxes(paddle_ocr_response)
    labeling_boxes = build_paddle_labeling_boxes(paddle_boxes, image_width, image_height)

    return json_response({
        'success': True,
        'displayType': 'bbox_overlay',
        'image': {
            'filename': image_filename,
            'width': image_width,
            'height': image_height
        },
        'boxes': labeling_boxes
    })


def request_paddle_ocr(image_bytes):
    byte_img = base64.b64encode(image_bytes).decode('utf-8')
    payload = json.dumps({
        'byte_img': byte_img,
        'predict_options': {}
    }).encode('utf-8')

    request = urllib.request.Request(PADDLE_OCR_API_URL, data=payload, headers={'Content-Type': 'application/json'})

    with urllib.request.urlopen(request, timeout=PADDLE_OCR_API_TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))


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
                'text': text,
                'confidence': float(rec_scores[text_index]) if text_index < len(rec_scores) else 1.0,
                'bbox': rec_boxes[text_index] if text_index < len(rec_boxes) else None
            })

    return paddle_boxes


def normalize_paddle_bbox(paddle_bbox):
    if not paddle_bbox:
        return None

    if len(paddle_bbox) == 4 and all(isinstance(point, (int, float)) for point in paddle_bbox):
        x1, y1, x2, y2 = paddle_bbox
        return [float(x1), float(y1), float(x2), float(y2)]

    if len(paddle_bbox) >= 4 and all(isinstance(point, (list, tuple)) and len(point) >= 2 for point in paddle_bbox):
        x_points = [float(point[0]) for point in paddle_bbox]
        y_points = [float(point[1]) for point in paddle_bbox]
        return [min(x_points), min(y_points), max(x_points), max(y_points)]

    return None


def build_paddle_labeling_boxes(paddle_boxes, image_width, image_height):
    labeling_boxes = []

    for box_index, paddle_box in enumerate(paddle_boxes):
        normalized_bbox = normalize_paddle_bbox(paddle_box.get('bbox'))
        if not normalized_bbox:
            continue

        x1, y1, x2, y2 = normalized_bbox
        x1 = max(0.0, min(float(image_width), x1))
        x2 = max(0.0, min(float(image_width), x2))
        y1 = max(0.0, min(float(image_height), y1))
        y2 = max(0.0, min(float(image_height), y2))

        if x2 <= x1 or y2 <= y1:
            continue

        labeling_boxes.append({
            'id': f"paddle-{box_index + 1}",
            'text': paddle_box.get('text', ''),
            'confidence': paddle_box.get('confidence', 1.0),
            'bbox': [x1, y1, x2, y2]
        })

    return labeling_boxes
