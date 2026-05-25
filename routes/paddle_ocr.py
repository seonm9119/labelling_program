import base64
import json
import shutil
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from config import OCR_NOTIFY_EMAIL_SUBJECT_PREFIX, PADDLE_OCR_API_TIMEOUT, PADDLE_OCR_API_URL, PADDLE_OCR_RELEASE_URL, SERVER_BULK_OUTPUT_ROOT, SERVER_FOLDER_ROOT, UPLOAD_DIR
from responses import json_response
from utils.email_notification import send_email_notification_async
from utils.file_utils import ANNOTATION_IMAGE_EXTENSIONS, list_image_paths
from utils.google_email import (
    build_google_email_auth_url,
    complete_google_email_oauth,
    complete_google_email_popup_code,
    get_google_email_status
)
from utils.labeling_boxes import build_labeling_boxes, read_image_size
from utils.ocr_result_files import (
    get_ocr_result_path,
    make_safe_ocr_image_filename,
    read_raw_ocr_response,
    save_raw_ocr_response,
    saved_temporary_raw_ocr_response
)

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
        'emailNotificationEnabled': True,
        'stopRequested': False,
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
    can_select_current_path = current_folder != root_folder and len(image_paths) > 0

    return json_response({
        'success': True,
        'rootPath': str(root_folder),
        'currentPath': str(current_folder),
        'parentPath': parent_path,
        'defaultOutputPath': str(SERVER_BULK_OUTPUT_ROOT.resolve(strict=False)),
        'imageCount': len(image_paths),
        'canSelectCurrentPath': can_select_current_path,
        'folders': child_folders
    })


@paddle_ocr_router.get('/api/labeling/paddle_ocr/email/google/status')
def read_google_email_connection_status():
    return json_response({
        'success': True,
        **get_google_email_status()
    })


@paddle_ocr_router.get('/api/labeling/paddle_ocr/email/google/auth-url')
def read_google_email_auth_url(redirect_uri=''):
    try:
        auth_url = build_google_email_auth_url(redirect_uri)
    except ValueError as error:
        return json_response({'success': False, 'error': str(error)}, status_code=400)

    return json_response({
        'success': True,
        'authUrl': auth_url,
        **get_google_email_status()
    })


@paddle_ocr_router.get('/api/labeling/paddle_ocr/email/google/callback')
def handle_google_email_oauth_callback(code='', state='', error=''):
    if error:
        return HTMLResponse(build_google_email_callback_html(False, f'Google 인증이 취소되었습니다: {error}'), status_code=400)

    try:
        connection_status = complete_google_email_oauth(code, state)
    except Exception as callback_error:
        return HTMLResponse(build_google_email_callback_html(False, str(callback_error)), status_code=400)

    connected_email = connection_status.get('email') or 'Google 계정'
    return HTMLResponse(build_google_email_callback_html(True, f'{connected_email} 연결이 완료되었습니다.'))


@paddle_ocr_router.post('/api/labeling/paddle_ocr/email/google/code')
async def handle_google_email_popup_code(request: Request):
    if request.headers.get('x-requested-with') != 'XmlHttpRequest':
        return json_response({'success': False, 'error': 'Google 인증 요청 헤더가 올바르지 않습니다.'}, status_code=400)

    try:
        request_payload = await request.json()
        connection_status = complete_google_email_popup_code(
            request_payload.get('code', ''),
            request_payload.get('origin', '')
        )
    except Exception as callback_error:
        return json_response({'success': False, 'error': str(callback_error)}, status_code=400)

    return json_response({
        'success': True,
        **connection_status
    })


@paddle_ocr_router.post('/api/labeling/paddle_ocr/server-folders')
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


@paddle_ocr_router.get('/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}')
def read_bulk_paddle_ocr_job(bulk_job_id):
    bulk_ocr_job = get_bulk_ocr_job(bulk_job_id)

    if not bulk_ocr_job:
        return json_response({'success': False, 'error': '대용량 OCR 작업을 찾을 수 없습니다.'}, status_code=404)

    return json_response(build_bulk_ocr_job_response(bulk_ocr_job))


@paddle_ocr_router.post('/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}/stop')
def stop_bulk_paddle_ocr_job(bulk_job_id):
    bulk_ocr_job = get_bulk_ocr_job(bulk_job_id)

    if not bulk_ocr_job:
        return json_response({'success': False, 'error': '대용량 OCR 작업을 찾을 수 없습니다.'}, status_code=404)

    if bulk_ocr_job.get('status') in ['completed', 'failed', 'stopped']:
        return json_response(build_bulk_ocr_job_response(bulk_ocr_job))

    with BULK_OCR_JOB_LOCK:
        current_job = BULK_OCR_JOBS[bulk_job_id]
        current_job['stopRequested'] = True
        current_job['status'] = 'stopping'
        current_job['updatedAt'] = time.time()

    return json_response(build_bulk_ocr_job_response(get_bulk_ocr_job(bulk_job_id)))


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
    image_width, image_height = read_image_size(image_bytes)
    paddle_ocr_response = request_paddle_ocr(image_bytes)

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


def encode_bulk_ocr_event(event_payload):
    return f"{json.dumps(event_payload, ensure_ascii=False)}\n".encode('utf-8')


def run_bulk_paddle_ocr_job(bulk_job_id):
    bulk_ocr_job = get_bulk_ocr_job(bulk_job_id)
    if not bulk_ocr_job:
        return

    update_bulk_ocr_job(bulk_job_id, {'status': 'running', 'updatedAt': time.time()})
    send_bulk_ocr_job_started_email(bulk_ocr_job)

    try:
        for saved_image in bulk_ocr_job['images']:
            if is_bulk_ocr_stop_requested(bulk_job_id):
                break

            image_index = saved_image['index']
            image_filename = saved_image['filename']

            try:
                existing_result = read_existing_bulk_ocr_result_file(bulk_ocr_job.get('outputFolderPath'), saved_image, bulk_job_id)
                if existing_result:
                    with BULK_OCR_JOB_LOCK:
                        current_job = BULK_OCR_JOBS[bulk_job_id]
                        current_job['results'].append(existing_result)
                        current_job['processedCount'] += 1
                        current_job['skippedCount'] += 1
                        current_job['updatedAt'] = time.time()
                    continue

                image_bytes = Path(saved_image['path']).read_bytes()
                image_width, image_height = read_image_size(image_bytes)
                paddle_ocr_response = request_paddle_ocr(image_bytes)
                raw_response_path = get_ocr_result_path(bulk_ocr_job.get('outputFolderPath'), image_filename, image_index)

                if raw_response_path:
                    output_path = save_raw_ocr_response(raw_response_path, paddle_ocr_response)
                    paddle_labeling_result = build_paddle_labeling_result_from_raw_file(image_filename, image_width, image_height, raw_response_path)
                else:
                    output_path = ''
                    with saved_temporary_raw_ocr_response(UPLOAD_DIR, 'paddle_ocr_', paddle_ocr_response) as temporary_raw_response_path:
                        paddle_labeling_result = build_paddle_labeling_result_from_raw_file(image_filename, image_width, image_height, temporary_raw_response_path)

                paddle_labeling_result['index'] = image_index
                paddle_labeling_result['image']['url'] = f'/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}/images/{image_index}'
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

        if is_bulk_ocr_stop_requested(bulk_job_id):
            update_bulk_ocr_job(bulk_job_id, {'status': 'stopped', 'updatedAt': time.time()})
        else:
            update_bulk_ocr_job(bulk_job_id, {'status': 'completed', 'updatedAt': time.time()})
    except Exception as error:
        with BULK_OCR_JOB_LOCK:
            if bulk_job_id in BULK_OCR_JOBS:
                current_job = BULK_OCR_JOBS[bulk_job_id]
                current_job['status'] = 'failed'
                current_job['errors'].append({
                    'index': 0,
                    'filename': 'bulk-job',
                    'error': str(error)
                })
                current_job['errorCount'] += 1
                current_job['updatedAt'] = time.time()
    finally:
        current_job = get_bulk_ocr_job(bulk_job_id)
        release_paddle_ocr()
        if current_job:
            send_bulk_ocr_job_finished_email(current_job)


def get_bulk_ocr_job(bulk_job_id):
    with BULK_OCR_JOB_LOCK:
        return BULK_OCR_JOBS.get(bulk_job_id)


def update_bulk_ocr_job(bulk_job_id, job_updates):
    with BULK_OCR_JOB_LOCK:
        if bulk_job_id in BULK_OCR_JOBS:
            BULK_OCR_JOBS[bulk_job_id].update(job_updates)


def is_bulk_ocr_stop_requested(bulk_job_id):
    with BULK_OCR_JOB_LOCK:
        return bool(BULK_OCR_JOBS.get(bulk_job_id, {}).get('stopRequested'))


def build_bulk_ocr_job_response(bulk_ocr_job):
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


def send_bulk_ocr_job_started_email(bulk_ocr_job):
    subject = f"{OCR_NOTIFY_EMAIL_SUBJECT_PREFIX} 대용량 OCR 시작 - {bulk_ocr_job['jobId'][:8]}"
    message_lines = [
        '대용량 OCR 작업이 시작되었습니다.',
        '',
        f"작업 ID: {bulk_ocr_job['jobId']}",
        f"상태: {bulk_ocr_job.get('status', 'running')}",
        f"전체 이미지: {bulk_ocr_job.get('total', 0)}",
        f"입력 폴더: {bulk_ocr_job.get('inputFolderPath', '-')}",
        f"저장 폴더: {bulk_ocr_job.get('outputFolderPath', '-')}",
        f"시작 시각: {format_email_time(bulk_ocr_job.get('updatedAt') or time.time())}"
    ]
    send_email_notification_async(subject, '\n'.join(message_lines))


def send_bulk_ocr_job_finished_email(bulk_ocr_job):
    error_count = bulk_ocr_job.get('errorCount', 0)
    skipped_count = bulk_ocr_job.get('skippedCount', 0)
    status_text = '완료'
    if bulk_ocr_job.get('status') == 'failed':
        status_text = '실패'
    elif bulk_ocr_job.get('status') == 'stopped':
        status_text = '중단'
    else:
        status_parts = []
        if skipped_count:
            status_parts.append(f'건너뜀 {skipped_count}건')
        if error_count:
            status_parts.append(f'오류 {error_count}건')
        if status_parts:
            status_text = f"완료, {', '.join(status_parts)}"

    subject = f"{OCR_NOTIFY_EMAIL_SUBJECT_PREFIX} 대용량 OCR {status_text} - {bulk_ocr_job['jobId'][:8]}"
    message_lines = [
        f'대용량 OCR 작업이 {status_text}되었습니다.',
        '',
        f"작업 ID: {bulk_ocr_job['jobId']}",
        f"상태: {bulk_ocr_job.get('status', '')}",
        f"전체 이미지: {bulk_ocr_job.get('total', 0)}",
        f"처리 완료: {bulk_ocr_job.get('processedCount', 0)}",
        f"건너뜀: {skipped_count}",
        f"오류: {error_count}",
        f"입력 폴더: {bulk_ocr_job.get('inputFolderPath', '-')}",
        f"저장 폴더: {bulk_ocr_job.get('outputFolderPath', '-')}",
        f"종료 시각: {format_email_time(bulk_ocr_job.get('updatedAt') or time.time())}"
    ]

    if bulk_ocr_job.get('errors'):
        message_lines.append('')
        message_lines.append('최근 오류:')
        for job_error in bulk_ocr_job['errors'][-5:]:
            message_lines.append(f"- {job_error.get('filename')}: {job_error.get('error')}")

    send_email_notification_async(subject, '\n'.join(message_lines))


def format_email_time(timestamp):
    return time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(timestamp))


def build_google_email_callback_html(is_success, message):
    title = 'Google 연결 완료' if is_success else 'Google 연결 실패'
    escaped_message = str(message).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    return f"""<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <title>{title}</title>
    <style>
      body {{ margin: 0; font-family: system-ui, sans-serif; background: #f4f8fb; color: #08253d; }}
      main {{ display: grid; place-items: center; min-height: 100vh; padding: 24px; }}
      section {{ max-width: 520px; padding: 24px; border: 1px solid #d7e5ee; border-radius: 14px; background: #fff; }}
      h1 {{ margin: 0 0 10px; font-size: 22px; }}
      p {{ margin: 0; line-height: 1.6; color: #52677f; }}
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>{title}</h1>
        <p>{escaped_message}</p>
        <p>이 창을 닫고 OCR 페이지로 돌아가세요.</p>
      </section>
    </main>
  </body>
</html>"""


def start_server_path_bulk_paddle_ocr_job(request_payload):
    input_folder_path = request_payload.get('inputFolderPath', '')
    output_folder_path = request_payload.get('outputFolderPath', '')

    try:
        input_folder = resolve_server_input_folder(input_folder_path)
        output_folder_root = resolve_server_output_folder(output_folder_path or str(SERVER_BULK_OUTPUT_ROOT))
    except ValueError as error:
        return json_response({'success': False, 'error': str(error)}, status_code=400)

    if input_folder == SERVER_FOLDER_ROOT.resolve(strict=False):
        return json_response({'success': False, 'error': '서버 입력 폴더는 /mnt/h 하위 폴더를 선택하세요.'}, status_code=400)

    image_paths = list_image_paths(str(input_folder), recursive=True, image_extensions=ANNOTATION_IMAGE_EXTENSIONS, require_exists=True)

    if not image_paths:
        return json_response({'success': False, 'error': '선택한 서버 폴더에서 처리할 이미지가 없습니다.'}, status_code=400)

    bulk_job_id = uuid.uuid4().hex
    job_output_folder = output_folder_root
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
        'skippedCount': 0,
        'images': saved_images,
        'results': [],
        'errors': [],
        'inputFolderPath': str(input_folder),
        'outputFolderPath': str(job_output_folder),
        'emailNotificationEnabled': True,
        'stopRequested': False,
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


def read_existing_bulk_ocr_result_file(output_folder_path, saved_image, bulk_job_id):
    result_path = get_ocr_result_path(output_folder_path, saved_image['filename'], saved_image['index'])
    if not result_path or not result_path.exists():
        return None

    paddle_ocr_response = read_raw_ocr_response(result_path)
    if isinstance(paddle_ocr_response, dict) and 'boxes' in paddle_ocr_response:
        return None

    image_bytes = Path(saved_image['path']).read_bytes()
    image_width, image_height = read_image_size(image_bytes)
    paddle_labeling_result = build_paddle_labeling_result(saved_image['filename'], image_width, image_height, paddle_ocr_response)
    paddle_labeling_result['index'] = saved_image['index']
    paddle_labeling_result['image']['url'] = f"/api/labeling/paddle_ocr/bulk/jobs/{bulk_job_id}/images/{saved_image['index']}"
    paddle_labeling_result['outputPath'] = str(result_path)
    paddle_labeling_result['skipped'] = True

    return paddle_labeling_result


def request_paddle_ocr(image_bytes):
    byte_img = base64.b64encode(image_bytes).decode('utf-8')
    payload = json.dumps({
        'byte_img': byte_img,
        'predict_options': {}
    }).encode('utf-8')

    request = urllib.request.Request(PADDLE_OCR_API_URL, data=payload, headers={'Content-Type': 'application/json'})

    with urllib.request.urlopen(request, timeout=PADDLE_OCR_API_TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))


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
