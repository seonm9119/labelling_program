import ast
import base64
import html
import json
import re
import shutil
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, StreamingResponse
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
    SERVER_BULK_OUTPUT_ROOT,
    SERVER_FOLDER_ROOT,
    UPLOAD_DIR,
)
from utils.file_utils import SUPPORTED_IMAGE_EXTENSIONS, list_child_folders, list_image_paths
from utils.labeling_boxes import build_labeling_boxes, read_image_size
from utils.ocr_result_files import (
    get_ocr_result_path,
    make_safe_ocr_image_filename,
    read_raw_ocr_response,
    save_raw_ocr_response,
    saved_temporary_raw_ocr_response
)
from utils.responses import json_response

deepseek_ocr_router = APIRouter()
DEEPSEEK_BULK_OCR_JOBS = {}
DEEPSEEK_BULK_OCR_JOB_LOCK = threading.Lock()
DEEPSEEK_BULK_OCR_JOB_DIR = UPLOAD_DIR / 'deepseek_ocr_bulk_jobs'
DEEPSEEK_BULK_OCR_RESULT_HISTORY_LIMIT = 200
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


@deepseek_ocr_router.post('/api/labeling/deepseek_ocr/bulk')
async def extract_bulk_deepseek_ocr_for_labeling(request: Request):
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

    return StreamingResponse(stream_bulk_deepseek_labeling_results(bulk_images), media_type='application/x-ndjson')


@deepseek_ocr_router.post('/api/labeling/deepseek_ocr/bulk/jobs')
async def start_bulk_deepseek_ocr_job(request: Request):
    content_type = request.headers.get('content-type', '')

    if content_type.startswith('application/json'):
        request_payload = await request.json()
        return start_server_path_bulk_deepseek_ocr_job(request_payload)

    form = await request.form()
    uploaded_images = form.getlist('images')

    if not uploaded_images:
        return json_response({'success': False, 'error': '이미지 폴더가 필요합니다.'}, status_code=400)

    bulk_job_id = uuid.uuid4().hex
    bulk_job_dir = DEEPSEEK_BULK_OCR_JOB_DIR / bulk_job_id
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
        saved_image_filename = make_safe_ocr_image_filename(image_filename)
        image_index = len(saved_images) + 1
        image_path = bulk_image_dir / f'{image_index:05d}_{saved_image_filename}'
        image_path.write_bytes(image_bytes)
        saved_images.append({
            'index': image_index,
            'filename': image_filename,
            'path': str(image_path)
        })

    if not saved_images:
        shutil.rmtree(bulk_job_dir, ignore_errors=True)
        return json_response({'success': False, 'error': '처리할 이미지가 없습니다.'}, status_code=400)

    return create_deepseek_bulk_job(saved_images)


@deepseek_ocr_router.get('/api/labeling/deepseek_ocr/server-folders')
def list_server_folders(path=''):
    try:
        current_folder = resolve_server_input_folder(path or str(SERVER_FOLDER_ROOT))
    except ValueError as error:
        return json_response({'success': False, 'error': str(error)}, status_code=400)

    try:
        child_folders = list_child_folders(current_folder)
    except OSError as error:
        return json_response({'success': False, 'error': f'폴더를 열 수 없습니다: {error}'}, status_code=400)

    root_folder = SERVER_FOLDER_ROOT.resolve(strict=False)
    parent_path = ''
    if current_folder != root_folder:
        parent_path = str(current_folder.parent)

    can_select_current_path = current_folder != root_folder

    return json_response({
        'success': True,
        'rootPath': str(root_folder),
        'currentPath': str(current_folder),
        'parentPath': parent_path,
        'defaultOutputPath': str(SERVER_BULK_OUTPUT_ROOT.resolve(strict=False)),
        'canSelectCurrentPath': can_select_current_path,
        'folders': child_folders
    })


@deepseek_ocr_router.post('/api/labeling/deepseek_ocr/server-folders')
async def create_server_folder(request: Request):
    request_payload = await request.json()
    parent_folder_path = request_payload.get('parentFolderPath', '')
    folder_name = str(request_payload.get('folderName', '')).strip()

    if not folder_name:
        return json_response({'success': False, 'error': '생성할 폴더명이 필요합니다.'}, status_code=400)

    if folder_name in ['.', '..'] or '/' in folder_name or '\\' in folder_name:
        return json_response({'success': False, 'error': '폴더명에는 경로 구분자를 사용할 수 없습니다.'}, status_code=400)

    try:
        parent_folder = resolve_server_output_folder(parent_folder_path or str(SERVER_BULK_OUTPUT_ROOT))
    except ValueError as error:
        return json_response({'success': False, 'error': str(error)}, status_code=400)

    if parent_folder == SERVER_BULK_OUTPUT_ROOT.resolve(strict=False):
        return json_response({'success': False, 'error': '저장 폴더 생성은 /mnt/h 하위 경로에서만 가능합니다.'}, status_code=400)

    created_folder = parent_folder / folder_name
    try:
        created_folder.mkdir(parents=False, exist_ok=True)
    except OSError as error:
        return json_response({'success': False, 'error': f'폴더를 생성할 수 없습니다: {error}'}, status_code=400)

    if not created_folder.is_dir():
        return json_response({'success': False, 'error': '같은 이름의 파일이 이미 있습니다.'}, status_code=400)

    return json_response({
        'success': True,
        'folder': {
            'name': created_folder.name,
            'path': str(created_folder)
        }
    })


@deepseek_ocr_router.get('/api/labeling/deepseek_ocr/bulk/jobs/{bulk_job_id}')
def read_bulk_deepseek_ocr_job(bulk_job_id):
    bulk_ocr_job = get_deepseek_bulk_ocr_job(bulk_job_id)

    if not bulk_ocr_job:
        return json_response({'success': False, 'error': '대용량 OCR 작업을 찾을 수 없습니다.'}, status_code=404)

    return json_response(build_deepseek_bulk_ocr_job_response(bulk_ocr_job))


@deepseek_ocr_router.post('/api/labeling/deepseek_ocr/bulk/jobs/{bulk_job_id}/stop')
def stop_bulk_deepseek_ocr_job(bulk_job_id):
    bulk_ocr_job = get_deepseek_bulk_ocr_job(bulk_job_id)

    if not bulk_ocr_job:
        return json_response({'success': False, 'error': '대용량 OCR 작업을 찾을 수 없습니다.'}, status_code=404)

    if bulk_ocr_job.get('status') in ['completed', 'failed', 'stopped']:
        return json_response(build_deepseek_bulk_ocr_job_response(bulk_ocr_job))

    with DEEPSEEK_BULK_OCR_JOB_LOCK:
        current_job = DEEPSEEK_BULK_OCR_JOBS[bulk_job_id]
        current_job['stopRequested'] = True
        current_job['status'] = 'stopping'
        current_job['updatedAt'] = time.time()

    return json_response(build_deepseek_bulk_ocr_job_response(get_deepseek_bulk_ocr_job(bulk_job_id)))


@deepseek_ocr_router.get('/api/labeling/deepseek_ocr/bulk/jobs/{bulk_job_id}/images/{image_index}')
def read_bulk_deepseek_ocr_image(bulk_job_id, image_index):
    bulk_ocr_job = get_deepseek_bulk_ocr_job(bulk_job_id)

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


def stream_bulk_deepseek_labeling_results(bulk_images):
    total_count = len(bulk_images)
    processed_count = 0
    error_count = 0

    yield encode_bulk_ocr_event({
        'success': True,
        'type': 'started',
        'total': total_count
    })

    try:
        for image_index, bulk_image in enumerate(bulk_images, start=1):
            image_filename = bulk_image['filename']

            try:
                deepseek_labeling_result = extract_deepseek_labeling_result(
                    image_filename,
                    bulk_image['image_bytes'],
                    release_after_inference=False
                )
                processed_count += 1
                yield encode_bulk_ocr_event({
                    'success': True,
                    'type': 'result',
                    'index': image_index,
                    'total': total_count,
                    **deepseek_labeling_result
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
    finally:
        release_deepseek_ocr()


def start_server_path_bulk_deepseek_ocr_job(request_payload):
    input_folder_path = request_payload.get('inputFolderPath', '')
    output_folder_path = request_payload.get('outputFolderPath', '')

    try:
        input_folder = resolve_server_input_folder(input_folder_path)
        output_folder_root = resolve_server_output_folder(output_folder_path or str(SERVER_BULK_OUTPUT_ROOT))
    except ValueError as error:
        return json_response({'success': False, 'error': str(error)}, status_code=400)

    if input_folder == SERVER_FOLDER_ROOT.resolve(strict=False):
        return json_response({'success': False, 'error': '서버 입력 폴더는 /mnt/h 하위 폴더를 선택하세요.'}, status_code=400)

    image_paths = list_image_paths(str(input_folder), recursive=True, image_extensions=SUPPORTED_IMAGE_EXTENSIONS, require_exists=True)

    if not image_paths:
        return json_response({'success': False, 'error': '선택한 서버 폴더에서 처리할 이미지가 없습니다.'}, status_code=400)

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

    return create_deepseek_bulk_job(saved_images, str(input_folder), str(output_folder_root))


def create_deepseek_bulk_job(saved_images, input_folder_path='', output_folder_path=''):
    bulk_job_id = uuid.uuid4().hex
    now = time.time()
    bulk_ocr_job = {
        'jobId': bulk_job_id,
        'status': 'queued',
        'total': len(saved_images),
        'processedCount': 0,
        'errorCount': 0,
        'skippedCount': 0,
        'images': saved_images,
        'results': [],
        'errors': [],
        'inputFolderPath': input_folder_path,
        'outputFolderPath': output_folder_path,
        'emailNotificationEnabled': False,
        'stopRequested': False,
        'createdAt': now,
        'updatedAt': now
    }

    with DEEPSEEK_BULK_OCR_JOB_LOCK:
        DEEPSEEK_BULK_OCR_JOBS[bulk_job_id] = bulk_ocr_job

    bulk_job_thread = threading.Thread(target=run_bulk_deepseek_ocr_job, args=(bulk_job_id,), daemon=True)
    bulk_job_thread.start()

    return json_response({
        'success': True,
        'jobId': bulk_job_id,
        'status': 'queued',
        'total': len(saved_images),
        'inputFolderPath': input_folder_path,
        'outputFolderPath': output_folder_path
    })


def run_bulk_deepseek_ocr_job(bulk_job_id):
    bulk_ocr_job = get_deepseek_bulk_ocr_job(bulk_job_id)
    if not bulk_ocr_job:
        return

    update_deepseek_bulk_ocr_job(bulk_job_id, {'status': 'running', 'updatedAt': time.time()})

    try:
        for saved_image in bulk_ocr_job['images']:
            if is_deepseek_bulk_ocr_stop_requested(bulk_job_id):
                break

            image_index = saved_image['index']
            image_filename = saved_image['filename']

            try:
                existing_result = read_existing_bulk_ocr_result_file(bulk_ocr_job.get('outputFolderPath'), saved_image, bulk_job_id)
                if existing_result:
                    with DEEPSEEK_BULK_OCR_JOB_LOCK:
                        current_job = DEEPSEEK_BULK_OCR_JOBS[bulk_job_id]
                        append_deepseek_bulk_ocr_job_result(current_job, existing_result)
                        current_job['processedCount'] += 1
                        current_job['skippedCount'] += 1
                        current_job['updatedAt'] = time.time()
                    continue

                image_bytes = Path(saved_image['path']).read_bytes()
                image_width, image_height = read_image_size(image_bytes)
                deepseek_ocr_response = request_deepseek_ocr(image_bytes, release_after_inference=False)
                raw_response_path = get_ocr_result_path(bulk_ocr_job.get('outputFolderPath'), image_filename, image_index)

                if raw_response_path:
                    output_path = save_raw_ocr_response(raw_response_path, deepseek_ocr_response)
                    deepseek_labeling_result = build_deepseek_labeling_result_from_raw_file(image_filename, image_width, image_height, raw_response_path)
                else:
                    output_path = ''
                    with saved_temporary_raw_ocr_response(UPLOAD_DIR, 'deepseek_ocr_', deepseek_ocr_response) as temporary_raw_response_path:
                        deepseek_labeling_result = build_deepseek_labeling_result_from_raw_file(image_filename, image_width, image_height, temporary_raw_response_path)

                deepseek_labeling_result['index'] = image_index
                deepseek_labeling_result['image']['url'] = f'/api/labeling/deepseek_ocr/bulk/jobs/{bulk_job_id}/images/{image_index}'
                if output_path:
                    deepseek_labeling_result['outputPath'] = output_path

                with DEEPSEEK_BULK_OCR_JOB_LOCK:
                    current_job = DEEPSEEK_BULK_OCR_JOBS[bulk_job_id]
                    append_deepseek_bulk_ocr_job_result(current_job, deepseek_labeling_result)
                    current_job['processedCount'] += 1
                    current_job['updatedAt'] = time.time()
            except Exception as error:
                with DEEPSEEK_BULK_OCR_JOB_LOCK:
                    current_job = DEEPSEEK_BULK_OCR_JOBS[bulk_job_id]
                    current_job['errors'].append({
                        'index': image_index,
                        'filename': image_filename,
                        'error': str(error)
                    })
                    current_job['processedCount'] += 1
                    current_job['errorCount'] += 1
                    current_job['updatedAt'] = time.time()

        if is_deepseek_bulk_ocr_stop_requested(bulk_job_id):
            update_deepseek_bulk_ocr_job(bulk_job_id, {'status': 'stopped', 'updatedAt': time.time()})
        else:
            update_deepseek_bulk_ocr_job(bulk_job_id, {'status': 'completed', 'updatedAt': time.time()})
    except Exception as error:
        with DEEPSEEK_BULK_OCR_JOB_LOCK:
            if bulk_job_id in DEEPSEEK_BULK_OCR_JOBS:
                current_job = DEEPSEEK_BULK_OCR_JOBS[bulk_job_id]
                current_job['status'] = 'failed'
                current_job['errors'].append({
                    'index': 0,
                    'filename': 'bulk-job',
                    'error': str(error)
                })
                current_job['errorCount'] += 1
                current_job['updatedAt'] = time.time()
    finally:
        release_deepseek_ocr()


def append_deepseek_bulk_ocr_job_result(current_job, deepseek_labeling_result):
    current_job['results'].append(deepseek_labeling_result)
    if len(current_job['results']) > DEEPSEEK_BULK_OCR_RESULT_HISTORY_LIMIT:
        del current_job['results'][:-DEEPSEEK_BULK_OCR_RESULT_HISTORY_LIMIT]


def encode_bulk_ocr_event(event_payload):
    return f"{json.dumps(event_payload, ensure_ascii=False)}\n".encode('utf-8')


def get_deepseek_bulk_ocr_job(bulk_job_id):
    with DEEPSEEK_BULK_OCR_JOB_LOCK:
        return DEEPSEEK_BULK_OCR_JOBS.get(bulk_job_id)


def update_deepseek_bulk_ocr_job(bulk_job_id, job_updates):
    with DEEPSEEK_BULK_OCR_JOB_LOCK:
        if bulk_job_id in DEEPSEEK_BULK_OCR_JOBS:
            DEEPSEEK_BULK_OCR_JOBS[bulk_job_id].update(job_updates)


def is_deepseek_bulk_ocr_stop_requested(bulk_job_id):
    with DEEPSEEK_BULK_OCR_JOB_LOCK:
        return bool(DEEPSEEK_BULK_OCR_JOBS.get(bulk_job_id, {}).get('stopRequested'))


def build_deepseek_bulk_ocr_job_response(bulk_ocr_job):
    return {
        'success': True,
        'jobId': bulk_ocr_job['jobId'],
        'status': bulk_ocr_job['status'],
        'total': bulk_ocr_job['total'],
        'processedCount': bulk_ocr_job['processedCount'],
        'errorCount': bulk_ocr_job['errorCount'],
        'skippedCount': bulk_ocr_job.get('skippedCount', 0),
        'results': bulk_ocr_job['results'],
        'errors': bulk_ocr_job['errors'],
        'inputFolderPath': bulk_ocr_job.get('inputFolderPath', ''),
        'outputFolderPath': bulk_ocr_job.get('outputFolderPath', ''),
        'emailNotificationEnabled': bulk_ocr_job.get('emailNotificationEnabled', False),
        'stopRequested': bulk_ocr_job.get('stopRequested', False),
        'createdAt': bulk_ocr_job['createdAt'],
        'updatedAt': bulk_ocr_job['updatedAt']
    }


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


def read_existing_bulk_ocr_result_file(output_folder_path, saved_image, bulk_job_id):
    exact_result_path = get_ocr_result_path(output_folder_path, saved_image['filename'], saved_image['index'])
    result_path = find_existing_deepseek_ocr_result_path(output_folder_path, saved_image['filename'], exact_result_path)
    if not result_path or not result_path.exists():
        return None

    deepseek_ocr_response = read_raw_ocr_response(result_path)
    if isinstance(deepseek_ocr_response, dict) and 'boxes' in deepseek_ocr_response:
        return None

    image_bytes = Path(saved_image['path']).read_bytes()
    image_width, image_height = read_image_size(image_bytes)
    deepseek_labeling_result = build_deepseek_labeling_result(saved_image['filename'], image_width, image_height, deepseek_ocr_response)
    deepseek_labeling_result['index'] = saved_image['index']
    deepseek_labeling_result['image']['url'] = f"/api/labeling/deepseek_ocr/bulk/jobs/{bulk_job_id}/images/{saved_image['index']}"
    deepseek_labeling_result['outputPath'] = str(result_path)
    deepseek_labeling_result['skipped'] = True

    return deepseek_labeling_result


def find_existing_deepseek_ocr_result_path(output_folder_path, image_filename, exact_result_path=None):
    if exact_result_path and exact_result_path.exists():
        return exact_result_path

    if not output_folder_path:
        return None

    image_stem = str(Path(str(image_filename).replace('\\', '/')).with_suffix(''))
    safe_stem = ''.join(character if character.isalnum() or character in '._-' else '_' for character in image_stem)
    safe_stem = safe_stem.strip('._') or 'image'
    matches = sorted(Path(output_folder_path).glob(f'*_{safe_stem}.json'))
    return matches[0] if matches else exact_result_path


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
