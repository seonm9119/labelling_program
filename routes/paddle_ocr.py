import base64
import json
import shutil
import threading
import time
import urllib.request
import uuid
from io import BytesIO
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image as PILImage
from config import PADDLE_OCR_API_TIMEOUT, PADDLE_OCR_API_URL, UPLOAD_DIR
from responses import json_response

paddle_ocr_router = APIRouter()
BULK_OCR_JOBS = {}
BULK_OCR_JOB_LOCK = threading.Lock()
BULK_OCR_JOB_DIR = UPLOAD_DIR / 'paddle_ocr_bulk_jobs'


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

    paddle_labeling_result = extract_paddle_labeling_result(image_filename, image_bytes)

    return json_response({
        'success': True,
        **paddle_labeling_result
    })


@paddle_ocr_router.post('/api/labeling/paddle_ocr/bulk')
async def extract_bulk_paddle_ocr_for_labeling(request: Request):
    form = await request.form()
    uploaded_images = form.getlist('images')

    if not uploaded_images:
        return json_response({'success': False, 'error': '이미지 폴더가 필요합니다.'}, status_code=400)

    bulk_images = []
    for uploaded_image in uploaded_images:
        if not uploaded_image.filename:
            continue

        image_bytes = await uploaded_image.read()
        if not image_bytes:
            continue

        bulk_images.append({
            'filename': Path(uploaded_image.filename).name,
            'image_bytes': image_bytes
        })

    if not bulk_images:
        return json_response({'success': False, 'error': '처리할 이미지가 없습니다.'}, status_code=400)

    return StreamingResponse(stream_bulk_paddle_labeling_results(bulk_images), media_type='application/x-ndjson')


@paddle_ocr_router.post('/api/labeling/paddle_ocr/bulk/jobs')
async def start_bulk_paddle_ocr_job(request: Request):
    form = await request.form()
    uploaded_images = form.getlist('images')

    if not uploaded_images:
        return json_response({'success': False, 'error': '이미지 폴더가 필요합니다.'}, status_code=400)

    bulk_job_id = uuid.uuid4().hex
    bulk_job_dir = BULK_OCR_JOB_DIR / bulk_job_id
    bulk_image_dir = bulk_job_dir / 'images'
    bulk_image_dir.mkdir(parents=True, exist_ok=True)

    saved_images = []
    for uploaded_image in uploaded_images:
        if not uploaded_image.filename:
            continue

        image_bytes = await uploaded_image.read()
        if not image_bytes:
            continue

        image_filename = Path(uploaded_image.filename.replace('\\', '/')).name
        safe_filename = make_safe_bulk_filename(image_filename)
        image_index = len(saved_images) + 1
        image_path = bulk_image_dir / f'{image_index:05d}_{safe_filename}'
        image_path.write_bytes(image_bytes)
        saved_images.append({
            'index': image_index,
            'filename': image_filename,
            'path': str(image_path)
        })

    if not saved_images:
        shutil.rmtree(bulk_job_dir, ignore_errors=True)
        return json_response({'success': False, 'error': '처리할 이미지가 없습니다.'}, status_code=400)

    now = time.time()
    bulk_ocr_job = {
        'jobId': bulk_job_id,
        'status': 'queued',
        'total': len(saved_images),
        'processedCount': 0,
        'errorCount': 0,
        'images': saved_images,
        'results': [],
        'errors': [],
        'createdAt': now,
        'updatedAt': now
    }

    with BULK_OCR_JOB_LOCK:
        BULK_OCR_JOBS[bulk_job_id] = bulk_ocr_job

    bulk_job_thread = threading.Thread(target=run_bulk_paddle_ocr_job, args=(bulk_job_id,), daemon=True)
    bulk_job_thread.start()

    return json_response({
        'success': True,
        'jobId': bulk_job_id,
        'status': 'queued',
        'total': len(saved_images)
    })


@paddle_ocr_router.get('/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}')
def read_bulk_paddle_ocr_job(bulk_job_id):
    bulk_ocr_job = get_bulk_ocr_job(bulk_job_id)

    if not bulk_ocr_job:
        return json_response({'success': False, 'error': '대용량 OCR 작업을 찾을 수 없습니다.'}, status_code=404)

    return json_response(build_bulk_ocr_job_response(bulk_ocr_job))


@paddle_ocr_router.get('/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}/images/{image_index}')
def read_bulk_paddle_ocr_image(bulk_job_id, image_index):
    bulk_ocr_job = get_bulk_ocr_job(bulk_job_id)

    if not bulk_ocr_job:
        return json_response({'success': False, 'error': '대용량 OCR 작업을 찾을 수 없습니다.'}, status_code=404)

    try:
        requested_image_index = int(image_index)
    except ValueError:
        return json_response({'success': False, 'error': '이미지 번호가 올바르지 않습니다.'}, status_code=400)

    target_image = None
    for saved_image in bulk_ocr_job['images']:
        if saved_image['index'] == requested_image_index:
            target_image = saved_image
            break

    if not target_image or not Path(target_image['path']).exists():
        return json_response({'success': False, 'error': '이미지 파일을 찾을 수 없습니다.'}, status_code=404)

    return FileResponse(target_image['path'])


def stream_bulk_paddle_labeling_results(bulk_images):
    total_count = len(bulk_images)
    processed_count = 0
    error_count = 0

    yield encode_bulk_ocr_event({
        'success': True,
        'type': 'started',
        'total': total_count
    })

    for image_index, bulk_image in enumerate(bulk_images, start=1):
        image_filename = bulk_image['filename']
        print(f"[Paddle OCR Bulk] {image_index}/{total_count} image={image_filename}", flush=True)

        try:
            paddle_labeling_result = extract_paddle_labeling_result(image_filename, bulk_image['image_bytes'])
            processed_count += 1
            yield encode_bulk_ocr_event({
                'success': True,
                'type': 'result',
                'index': image_index,
                'total': total_count,
                **paddle_labeling_result
            })
        except Exception as error:
            error_count += 1
            yield encode_bulk_ocr_event({
                'success': False,
                'type': 'error',
                'index': image_index,
                'total': total_count,
                'filename': image_filename,
                'error': str(error)
            })

    yield encode_bulk_ocr_event({
        'success': True,
        'type': 'completed',
        'total': total_count,
        'processedCount': processed_count,
        'errorCount': error_count
    })


def extract_paddle_labeling_result(image_filename, image_bytes):
    with PILImage.open(BytesIO(image_bytes)) as image:
        image_width, image_height = image.size

    paddle_ocr_response = request_paddle_ocr(image_bytes)
    paddle_boxes = extract_paddle_boxes(paddle_ocr_response)
    labeling_boxes = build_paddle_labeling_boxes(paddle_boxes, image_width, image_height)

    return {
        'displayType': 'bbox_overlay',
        'image': {
            'filename': image_filename,
            'width': image_width,
            'height': image_height
        },
        'boxes': labeling_boxes
    }


def encode_bulk_ocr_event(event_payload):
    return f"{json.dumps(event_payload, ensure_ascii=False)}\n".encode('utf-8')


def run_bulk_paddle_ocr_job(bulk_job_id):
    bulk_ocr_job = get_bulk_ocr_job(bulk_job_id)
    if not bulk_ocr_job:
        return

    update_bulk_ocr_job(bulk_job_id, {'status': 'running', 'updatedAt': time.time()})

    for saved_image in bulk_ocr_job['images']:
        image_index = saved_image['index']
        image_filename = saved_image['filename']
        print(f"[Paddle OCR Bulk Job] {bulk_job_id} {image_index}/{bulk_ocr_job['total']} image={image_filename}", flush=True)

        try:
            image_bytes = Path(saved_image['path']).read_bytes()
            paddle_labeling_result = extract_paddle_labeling_result(image_filename, image_bytes)
            paddle_labeling_result['index'] = image_index
            paddle_labeling_result['image']['url'] = f'/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}/images/{image_index}'

            with BULK_OCR_JOB_LOCK:
                current_job = BULK_OCR_JOBS[bulk_job_id]
                current_job['results'].append(paddle_labeling_result)
                current_job['processedCount'] += 1
                current_job['updatedAt'] = time.time()
        except Exception as error:
            with BULK_OCR_JOB_LOCK:
                current_job = BULK_OCR_JOBS[bulk_job_id]
                current_job['errors'].append({
                    'index': image_index,
                    'filename': image_filename,
                    'error': str(error)
                })
                current_job['errorCount'] += 1
                current_job['updatedAt'] = time.time()

    update_bulk_ocr_job(bulk_job_id, {'status': 'completed', 'updatedAt': time.time()})


def get_bulk_ocr_job(bulk_job_id):
    with BULK_OCR_JOB_LOCK:
        return BULK_OCR_JOBS.get(bulk_job_id)


def update_bulk_ocr_job(bulk_job_id, job_updates):
    with BULK_OCR_JOB_LOCK:
        if bulk_job_id in BULK_OCR_JOBS:
            BULK_OCR_JOBS[bulk_job_id].update(job_updates)


def build_bulk_ocr_job_response(bulk_ocr_job):
    return {
        'success': True,
        'jobId': bulk_ocr_job['jobId'],
        'status': bulk_ocr_job['status'],
        'total': bulk_ocr_job['total'],
        'processedCount': bulk_ocr_job['processedCount'],
        'errorCount': bulk_ocr_job['errorCount'],
        'results': bulk_ocr_job['results'],
        'errors': bulk_ocr_job['errors'],
        'createdAt': bulk_ocr_job['createdAt'],
        'updatedAt': bulk_ocr_job['updatedAt']
    }


def make_safe_bulk_filename(image_filename):
    safe_filename = ''.join(character if character.isalnum() or character in '._-' else '_' for character in image_filename)
    return safe_filename or 'image'


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
