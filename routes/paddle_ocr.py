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
from config import PADDLE_OCR_API_TIMEOUT, PADDLE_OCR_API_URL, SERVER_BULK_OUTPUT_ROOT, SERVER_FOLDER_ROOT, UPLOAD_DIR
from responses import json_response
from utils.file_utils import ANNOTATION_IMAGE_EXTENSIONS, list_image_paths

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
    content_type = request.headers.get('content-type', '')

    if content_type.startswith('application/json'):
        request_payload = await request.json()
        return start_server_path_bulk_paddle_ocr_job(request_payload)

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


@paddle_ocr_router.get('/api/labeling/paddle_ocr/server-folders')
def list_server_folders(path=''):
    try:
        current_folder = resolve_server_input_folder(path or str(SERVER_FOLDER_ROOT))
    except ValueError as error:
        return json_response({'success': False, 'error': str(error)}, status_code=400)

    child_folders = []
    try:
        folder_entries = sorted(current_folder.iterdir(), key=lambda folder_entry: folder_entry.name.lower())
    except OSError as error:
        return json_response({'success': False, 'error': f'폴더를 열 수 없습니다: {error}'}, status_code=400)

    for folder_entry in folder_entries:
        if not folder_entry.is_dir():
            continue

        child_folders.append({
            'name': folder_entry.name,
            'path': str(folder_entry)
        })

    root_folder = SERVER_FOLDER_ROOT.resolve(strict=False)
    parent_path = ''
    if current_folder != root_folder:
        parent_path = str(current_folder.parent)

    image_paths = list_image_paths(str(current_folder), recursive=True, image_extensions=ANNOTATION_IMAGE_EXTENSIONS)

    return json_response({
        'success': True,
        'rootPath': str(root_folder),
        'currentPath': str(current_folder),
        'parentPath': parent_path,
        'defaultOutputPath': str(SERVER_BULK_OUTPUT_ROOT.resolve(strict=False)),
        'imageCount': len(image_paths),
        'folders': child_folders
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
            output_path = save_bulk_ocr_result_file(bulk_ocr_job.get('outputFolderPath'), paddle_labeling_result)
            if output_path:
                paddle_labeling_result['outputPath'] = output_path

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
        'inputFolderPath': bulk_ocr_job.get('inputFolderPath', ''),
        'outputFolderPath': bulk_ocr_job.get('outputFolderPath', ''),
        'createdAt': bulk_ocr_job['createdAt'],
        'updatedAt': bulk_ocr_job['updatedAt']
    }


def start_server_path_bulk_paddle_ocr_job(request_payload):
    input_folder_path = request_payload.get('inputFolderPath', '')
    output_folder_path = request_payload.get('outputFolderPath', '')

    try:
        input_folder = resolve_server_input_folder(input_folder_path)
        output_folder_root = resolve_server_output_folder(output_folder_path or str(SERVER_BULK_OUTPUT_ROOT))
    except ValueError as error:
        return json_response({'success': False, 'error': str(error)}, status_code=400)

    image_paths = list_image_paths(str(input_folder), recursive=True, image_extensions=ANNOTATION_IMAGE_EXTENSIONS, require_exists=True)

    if not image_paths:
        return json_response({'success': False, 'error': '선택한 서버 폴더에서 처리할 이미지가 없습니다.'}, status_code=400)

    bulk_job_id = uuid.uuid4().hex
    job_output_folder = output_folder_root / bulk_job_id
    job_output_folder.mkdir(parents=True, exist_ok=True)

    saved_images = []
    for image_path_text in image_paths:
        image_path = Path(image_path_text)
        image_index = len(saved_images) + 1
        try:
            image_filename = str(image_path.relative_to(input_folder))
        except ValueError:
            image_filename = image_path.name

        saved_images.append({
            'index': image_index,
            'filename': image_filename,
            'path': str(image_path)
        })

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
        'inputFolderPath': str(input_folder),
        'outputFolderPath': str(job_output_folder),
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
        'total': len(saved_images),
        'inputFolderPath': str(input_folder),
        'outputFolderPath': str(job_output_folder)
    })


def resolve_server_input_folder(raw_folder_path):
    return resolve_server_folder(raw_folder_path, SERVER_FOLDER_ROOT, '서버 입력 폴더')


def resolve_server_output_folder(raw_folder_path):
    output_folder = resolve_server_folder(raw_folder_path, SERVER_BULK_OUTPUT_ROOT, '서버 결과 폴더', allow_missing=True)
    output_folder.mkdir(parents=True, exist_ok=True)
    return output_folder


def resolve_server_folder(raw_folder_path, allowed_root, folder_label, allow_missing=False):
    if not raw_folder_path:
        raise ValueError(f'{folder_label}를 선택하세요.')

    root_folder = allowed_root.resolve(strict=False)
    requested_folder = Path(raw_folder_path).expanduser()
    if not requested_folder.is_absolute():
        requested_folder = root_folder / requested_folder

    resolved_folder = requested_folder.resolve(strict=False)
    if resolved_folder != root_folder and root_folder not in resolved_folder.parents:
        raise ValueError(f'{folder_label}는 {root_folder} 아래에서만 선택할 수 있습니다.')

    if not allow_missing and not resolved_folder.is_dir():
        raise ValueError(f'{folder_label}를 찾을 수 없습니다: {resolved_folder}')

    return resolved_folder


def save_bulk_ocr_result_file(output_folder_path, paddle_labeling_result):
    if not output_folder_path:
        return ''

    output_folder = Path(output_folder_path)
    output_folder.mkdir(parents=True, exist_ok=True)
    image_filename = paddle_labeling_result.get('image', {}).get('filename', 'image')
    image_index = paddle_labeling_result.get('index', 0)
    result_filename = make_safe_bulk_result_filename(image_filename, image_index)
    result_path = output_folder / result_filename
    result_payload = {
        'image': paddle_labeling_result.get('image', {}),
        'boxes': paddle_labeling_result.get('boxes', [])
    }

    result_path.write_text(json.dumps(result_payload, ensure_ascii=False, indent=2), encoding='utf-8')
    return str(result_path)


def make_safe_bulk_filename(image_filename):
    safe_filename = ''.join(character if character.isalnum() or character in '._-' else '_' for character in image_filename)
    return safe_filename or 'image'


def make_safe_bulk_result_filename(image_filename, image_index):
    image_stem = str(Path(str(image_filename).replace('\\', '/')).with_suffix(''))
    safe_stem = ''.join(character if character.isalnum() or character in '._-' else '_' for character in image_stem)
    safe_stem = safe_stem.strip('._') or 'image'
    return f'{int(image_index):05d}_{safe_stem}.json'


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
