"""
Labelling Programs - Flask 서버
다양한 라벨링 모델을 위한 웹 인터페이스
"""

import os
import json
import shutil
from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
from pathlib import Path
import threading
import uuid

# 모델 임포트
from models import CLIPClassifier

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB (기준 이미지용)

# 임시 업로드 폴더
UPLOAD_FOLDER = Path('uploads')
UPLOAD_FOLDER.mkdir(exist_ok=True)

# ============================================
# 모델 초기화
# ============================================

# CLIP 분류기 초기화
clip_classifier = CLIPClassifier(model_name="ViT-B/32")

# 시스템 정보 (UI 표시용)
SYSTEM_INFO = clip_classifier.system_info

# 분석 작업 상태 저장
tasks = {}
tasks_lock = threading.Lock()


# ============================================
# 단일 기준 이미지 분석 (기존 기능)
# ============================================

def run_analysis(task_id, image_a_path, image_files):
    """백그라운드에서 단일 기준 이미지 분석을 실행합니다. (배치 처리)"""
    try:
        total_count = len(image_files)
        
        with tasks_lock:
            tasks[task_id]['status'] = 'running'
            tasks[task_id]['total'] = total_count
            tasks[task_id]['current'] = 0
            tasks[task_id]['batch_size'] = clip_classifier.current_batch_size
        
        # 진행 상황 콜백
        def progress_callback(current, total, batch_size):
            with tasks_lock:
                tasks[task_id]['current'] = current
                tasks[task_id]['percent'] = round(current / total * 100, 1)
                tasks[task_id]['batch_size'] = batch_size
        
        # CLIP 분류기로 분석 실행
        result = clip_classifier.analyze_single(image_a_path, image_files, progress_callback)
        
        # 완료
        with tasks_lock:
            tasks[task_id]['status'] = 'complete'
            tasks[task_id]['similarities'] = result['similarities']
            tasks[task_id]['stats'] = result['stats']
            tasks[task_id]['failed_count'] = result['failed_count']
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        with tasks_lock:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = str(e)


# ============================================
# 다중 기준 이미지 분석 (새 기능)
# ============================================

def run_multi_analysis(task_id, reference_images, image_files, classify_mode):
    """
    백그라운드에서 다중 기준 이미지 분석을 실행합니다. (배치 처리)
    
    reference_images: [{'path': str, 'name': str, 'targetFolder': str}, ...]
    classify_mode: 'best_match' 또는 'threshold'
    """
    try:
        total_images = len(image_files)
        num_refs = len(reference_images)
        total_work = num_refs + total_images
        
        with tasks_lock:
            tasks[task_id]['status'] = 'running'
            tasks[task_id]['total'] = total_work
            tasks[task_id]['current'] = 0
            tasks[task_id]['phase'] = 'reference'
            tasks[task_id]['batch_size'] = clip_classifier.current_batch_size
        
        # 진행 상황 콜백
        def progress_callback(current, total, phase, batch_size):
            with tasks_lock:
                tasks[task_id]['current'] = current
                tasks[task_id]['percent'] = round(current / total_work * 100, 1)
                tasks[task_id]['phase'] = phase
                tasks[task_id]['batch_size'] = batch_size
        
        # CLIP 분류기로 다중 분석 실행
        result = clip_classifier.analyze_multi(reference_images, image_files, progress_callback)
        
        # 완료
        with tasks_lock:
            tasks[task_id]['status'] = 'complete'
            tasks[task_id]['allResults'] = result['allResults']
            tasks[task_id]['totalCount'] = result['totalCount']
            tasks[task_id]['resultsByRef'] = result['resultsByRef']
            tasks[task_id]['statsByRef'] = result['statsByRef']
            tasks[task_id]['thresholdCountsByRef'] = result['thresholdCountsByRef']
            tasks[task_id]['bestMatchThresholdCounts'] = result['bestMatchThresholdCounts']
            tasks[task_id]['referenceImages'] = result['referenceImages']
            tasks[task_id]['failed_count'] = result['failed_count']
            tasks[task_id]['final_batch_size'] = result['final_batch_size']
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        with tasks_lock:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = str(e)


# ============================================
# 페이지 라우트
# ============================================

@app.route('/')
def index():
    """기본 페이지 - CLIP 단일 분류기로 리디렉션"""
    return clip_single()


@app.route('/clip')
@app.route('/clip/single')
def clip_single():
    """CLIP 단일 이미지 분류기 페이지"""
    return render_template('clip_classifier.html', 
                         system_info=SYSTEM_INFO, 
                         active_page='clip_single')


@app.route('/clip/multi')
def clip_multi():
    """CLIP 다중 이미지 분류기 페이지"""
    return render_template('clip_classifier.html', 
                         system_info=SYSTEM_INFO, 
                         active_page='clip_multi')


@app.route('/keyvalue')
def keyvalue_mapper():
    """Key-Value 맵핑 페이지"""
    return render_template('keyvalue_mapper.html', 
                         system_info=SYSTEM_INFO, 
                         active_page='keyvalue')


@app.route('/keyvalue/auto')
def keyvalue_auto():
    """Key-Value 자동 맵핑 페이지"""
    return render_template('keyvalue_auto.html', 
                         system_info=SYSTEM_INFO, 
                         active_page='keyvalue_auto')


@app.route('/keyvalue/batch')
def keyvalue_batch():
    """Key-Value 대용량 자동처리 페이지"""
    default_data_path = os.environ.get('DEFAULT_DATA_PATH', '/data')
    return render_template('keyvalue_batch.html', 
                         system_info=SYSTEM_INFO, 
                         active_page='keyvalue_batch',
                         default_data_path=default_data_path)

@app.route('/keyvalue/editor')
def keyvalue_editor():
    """Key-Value 수정 뷰어 페이지"""
    default_data_path = os.environ.get('DEFAULT_DATA_PATH', '/data')
    return render_template('keyvalue_editor.html', 
                         system_info=SYSTEM_INFO, 
                         active_page='keyvalue_editor',
                         default_data_path=default_data_path)

@app.route('/editor/check-folder', methods=['POST'])
def editor_check_folder():
    """에디터: 폴더 확인"""
    data = request.get_json()
    folder_path = data.get('folderPath')
    file_type = data.get('fileType')
    
    if not folder_path:
        return jsonify({'error': '폴더 경로가 필요합니다.'}), 400
    
    expanded_path = os.path.expanduser(folder_path)
    if not os.path.exists(expanded_path):
        return jsonify({'error': f'폴더를 찾을 수 없습니다: {expanded_path}'}), 404
    if not os.path.isdir(expanded_path):
        return jsonify({'error': f'경로가 폴더가 아닙니다: {expanded_path}'}), 400
    
    files = []
    if file_type == 'image':
        image_extensions = ('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp')
        files = [f for f in os.listdir(expanded_path) if f.lower().endswith(image_extensions)]
    elif file_type == 'json':
        files = [f for f in os.listdir(expanded_path) if f.lower().endswith('.json')]
    else:
        return jsonify({'error': '지원하지 않는 파일 타입입니다.'}), 400
    
    return jsonify({
        'success': True,
        'path': expanded_path,
        'files': sorted(files),
        'count': len(files)
    })

@app.route('/editor/load-image')
def editor_load_image():
    """에디터: 이미지 로드"""
    folder = request.args.get('folder')
    file = request.args.get('file')
    
    if not folder or not file:
        return 'Missing parameters', 400
    
    file_path = os.path.join(folder, file)
    if not os.path.exists(file_path):
        return 'File not found', 404
    
    return send_file(file_path)

@app.route('/editor/load-json', methods=['POST'])
def editor_load_json():
    """에디터: JSON 로드"""
    data = request.get_json()
    folder_path = data.get('folderPath')
    filename = data.get('filename')
    
    if not folder_path or not filename:
        return jsonify({'error': '필수 파라미터가 누락되었습니다.'}), 400
    
    file_path = os.path.join(folder_path, filename)
    
    if not os.path.exists(file_path):
        return jsonify({'success': False, 'error': 'JSON 파일이 없습니다.'})
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            json_data = json.load(f)
        return jsonify({'success': True, 'data': json_data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/editor/save-json', methods=['POST'])
def editor_save_json():
    """에디터: JSON 저장"""
    data = request.get_json()
    folder_path = data.get('folderPath')
    filename = data.get('filename')
    json_data = data.get('data')
    
    if not folder_path or not filename or not json_data:
        return jsonify({'error': '필수 파라미터가 누락되었습니다.'}), 400
    
    file_path = os.path.join(folder_path, filename)
    
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(json_data, f, indent=2, ensure_ascii=False)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


# ============================================
# Key-Value 배치 처리 API
# ============================================

@app.route('/batch/browse-folder', methods=['POST'])
def batch_browse_folder():
    """서버 폴더 브라우저 - 지정된 경로의 폴더/파일 목록 반환"""
    try:
        data = request.json
        current_path = data.get('path', '/').strip()
        
        # 경로 확장
        current_path = os.path.expanduser(current_path)
        
        # 기본 경로 설정
        if not current_path or current_path == '':
            current_path = '/'
        
        # 경로 존재 확인
        if not os.path.exists(current_path):
            # 상위 폴더로 이동 시도
            parent = os.path.dirname(current_path)
            if os.path.exists(parent):
                current_path = parent
            else:
                current_path = '/'
        
        # 파일이면 부모 폴더로
        if os.path.isfile(current_path):
            current_path = os.path.dirname(current_path)
        
        # 폴더 목록 가져오기
        items = []
        try:
            for name in sorted(os.listdir(current_path)):
                full_path = os.path.join(current_path, name)
                try:
                    is_dir = os.path.isdir(full_path)
                    items.append({
                        'name': name,
                        'path': full_path,
                        'isDir': is_dir
                    })
                except PermissionError:
                    continue
        except PermissionError:
            return jsonify({'error': '권한이 없습니다.'}), 403
        
        # 폴더만 필터링 (폴더 선택용)
        folders = [item for item in items if item['isDir']]
        
        return jsonify({
            'success': True,
            'currentPath': current_path,
            'parentPath': os.path.dirname(current_path) if current_path != '/' else None,
            'items': folders
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/batch/check-folder', methods=['POST'])
def batch_check_folder():
    """폴더 존재 여부와 파일 목록 확인"""
    try:
        data = request.json
        folder_path = data.get('folderPath', '').strip()
        file_type = data.get('fileType', 'image')  # 'image', 'json'
        
        if not folder_path:
            return jsonify({'error': '폴더 경로를 입력하세요.'}), 400
        
        # 경로 확장
        folder_path = os.path.expanduser(folder_path)
        
        if not os.path.exists(folder_path):
            return jsonify({'error': '폴더가 존재하지 않습니다.'}), 404
        
        if not os.path.isdir(folder_path):
            return jsonify({'error': '폴더 경로가 아닙니다.'}), 400
        
        # 파일 목록 가져오기
        files = []
        if file_type == 'image':
            extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp'}
            files = [f for f in os.listdir(folder_path) 
                    if os.path.isfile(os.path.join(folder_path, f)) 
                    and os.path.splitext(f.lower())[1] in extensions]
        elif file_type == 'json':
            files = [f for f in os.listdir(folder_path) 
                    if os.path.isfile(os.path.join(folder_path, f)) 
                    and f.lower().endswith('.json')]
        
        return jsonify({
            'success': True,
            'path': folder_path,
            'files': sorted(files),
            'count': len(files)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/batch/auto-mapping', methods=['POST'])
def batch_auto_mapping():
    """JSON 데이터를 받아서 자동 맵핑 수행 (클라이언트 업로드 방식)"""
    try:
        from models.auto_mapping import perform_auto_mapping
        
        data = request.json
        image_name = data.get('image_name')
        template = data.get('template')
        paddle_ocr = data.get('paddle_ocr')
        logistics_ocr = data.get('logistics_ocr')
        
        if not all([image_name, template, paddle_ocr, logistics_ocr]):
            return jsonify({'error': '필수 파라미터가 누락되었습니다.'}), 400
        
        # 자동 맵핑 수행
        mapped_result = perform_auto_mapping(template, paddle_ocr, logistics_ocr)
        
        # 이미지 이름 설정
        mapped_result['image'] = image_name
        
        return jsonify(mapped_result)
        
    except Exception as e:
        import traceback
        print(f"[자동맵핑 API 에러] {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/batch/process-image', methods=['POST'])
def batch_process_image():
    """단일 이미지에 대한 자동 맵핑 처리 및 저장"""
    try:
        import json
        from models.auto_mapping import perform_auto_mapping
        
        data = request.json
        image_file = data.get('imageFile')
        image_folder = data.get('imageFolder')
        logistics_folder = data.get('logisticsFolder')
        paddle_folder = data.get('paddleFolder')
        output_folder = data.get('outputFolder')
        annotation_template = data.get('annotationTemplate')
        
        if not all([image_file, image_folder, logistics_folder, paddle_folder, output_folder, annotation_template]):
            return jsonify({'error': '필수 파라미터가 누락되었습니다.'}), 400
        
        # 경로 확장
        image_folder = os.path.expanduser(image_folder)
        logistics_folder = os.path.expanduser(logistics_folder)
        paddle_folder = os.path.expanduser(paddle_folder)
        output_folder = os.path.expanduser(output_folder)
        
        # 출력 폴더 생성 (없으면)
        os.makedirs(output_folder, exist_ok=True)
        
        # 파일명에서 확장자 제거
        base_name = os.path.splitext(image_file)[0]
        json_name = f"{base_name}.json"
        
        # OCR 파일 경로
        logistics_file = os.path.join(logistics_folder, json_name)
        paddle_file = os.path.join(paddle_folder, json_name)
        output_file = os.path.join(output_folder, json_name)
        
        # 파일 존재 확인
        if not os.path.exists(logistics_file):
            return jsonify({'error': f'물류 OCR 파일을 찾을 수 없습니다: {json_name}'}), 404
        
        if not os.path.exists(paddle_file):
            return jsonify({'error': f'PaddleOCR 파일을 찾을 수 없습니다: {json_name}'}), 404
        
        # OCR 파일 읽기
        with open(logistics_file, 'r', encoding='utf-8') as f:
            logistics_ocr = json.load(f)
        
        with open(paddle_file, 'r', encoding='utf-8') as f:
            paddle_ocr = json.load(f)
        
        # 자동 맵핑 수행
        mapped_result = perform_auto_mapping(
            annotation_template, 
            paddle_ocr, 
            logistics_ocr
        )
        
        # JSON 파일 저장
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(mapped_result, f, ensure_ascii=False, indent=2)
        
        # 통계 계산
        annotations = mapped_result.get('annotations', [])
        key_count = sum(1 for a in annotations if a.get('type') == 'key')
        value_count = sum(1 for a in annotations if a.get('type') == 'value')
        
        return jsonify({
            'success': True,
            'outputFile': output_file,
            'keyCount': key_count,
            'valueCount': value_count
        })
        
    except Exception as e:
        import traceback
        print(f"[배치 처리 에러] {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


# ============================================
# 단일 기준 이미지 API (기존)
# ============================================

@app.route('/analyze/start', methods=['POST'])
def analyze_start():
    """단일 기준 이미지 분석을 시작하고 task_id를 반환합니다."""
    try:
        # 기준 이미지 업로드 확인
        if 'imageA' not in request.files:
            return jsonify({'error': '기준 이미지가 필요합니다.'}), 400
        
        image_a = request.files['imageA']
        if image_a.filename == '':
            return jsonify({'error': '기준 이미지가 선택되지 않았습니다.'}), 400
        
        # 폴더 경로 확인
        folder_path = request.form.get('folderPath', '').strip()
        folder_path = os.path.expanduser(folder_path)
        
        if not folder_path:
            return jsonify({'error': '비교할 폴더 경로가 필요합니다.'}), 400
        
        if not os.path.exists(folder_path):
            return jsonify({'error': f'폴더를 찾을 수 없습니다: {folder_path}'}), 400
        
        # 기준 이미지 임시 저장
        task_id = str(uuid.uuid4())
        temp_dir = UPLOAD_FOLDER / task_id
        temp_dir.mkdir(parents=True)
        
        image_a_path = temp_dir / secure_filename(image_a.filename)
        image_a.save(str(image_a_path))
        
        # 폴더 내 이미지 파일 목록
        image_files = CLIPClassifier.get_image_files(folder_path)
        
        if not image_files:
            return jsonify({'error': '폴더에 이미지 파일이 없습니다.'}), 400
        
        # 작업 초기화
        with tasks_lock:
            tasks[task_id] = {
                'status': 'starting',
                'total': len(image_files),
                'current': 0,
                'percent': 0,
                'similarities': [],
                'stats': {}
            }
        
        # 백그라운드 스레드에서 분석 실행
        thread = threading.Thread(
            target=run_analysis,
            args=(task_id, str(image_a_path), image_files)
        )
        thread.daemon = True
        thread.start()
        
        print(f"[분석 시작] Task {task_id}, 총 {len(image_files)}개 이미지")
        
        return jsonify({
            'success': True,
            'taskId': task_id,
            'total': len(image_files)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/analyze/progress/<task_id>')
def analyze_progress(task_id):
    """분석 진행 상황을 반환합니다."""
    with tasks_lock:
        task = tasks.get(task_id)
    
    if not task:
        return jsonify({'error': '작업을 찾을 수 없습니다.'}), 404
    
    response = {
        'status': task['status'],
        'current': task.get('current', 0),
        'total': task.get('total', 0),
        'percent': task.get('percent', 0),
        'batchSize': task.get('batch_size', 1)
    }
    
    if task['status'] == 'complete':
        similarities = task['similarities']
        response['similarities'] = similarities[:1000]  # 상위 1000개 (UI 표시용)
        response['totalCount'] = len(similarities)
        response['failedCount'] = task.get('failed_count', 0)
        response['stats'] = task['stats']
        response['resultId'] = task_id
        
        # 임계치별 개수 미리 계산 (1% 단위로 정확한 개수 제공)
        threshold_counts = {}
        for thresh in range(0, 101):  # 0, 1, 2, ..., 100
            count = sum(1 for s in similarities if s['similarity'] >= thresh)
            threshold_counts[thresh] = count
        response['thresholdCounts'] = threshold_counts
        
    elif task['status'] == 'error':
        response['error'] = task.get('error', '알 수 없는 오류')
    
    return jsonify(response)


# ============================================
# 다중 기준 이미지 API (새 기능)
# ============================================

@app.route('/multi-analyze/start', methods=['POST'])
def multi_analyze_start():
    """다중 기준 이미지 분석을 시작합니다."""
    try:
        # 폴더 경로 확인
        folder_path = request.form.get('folderPath', '').strip()
        folder_path = os.path.expanduser(folder_path)
        
        if not folder_path:
            return jsonify({'error': '비교할 폴더 경로가 필요합니다.'}), 400
        
        if not os.path.exists(folder_path):
            return jsonify({'error': f'폴더를 찾을 수 없습니다: {folder_path}'}), 400
        
        # 분류 모드
        classify_mode = request.form.get('classifyMode', 'best_match')
        
        # 기준 이미지들 처리
        task_id = str(uuid.uuid4())
        temp_dir = UPLOAD_FOLDER / task_id
        temp_dir.mkdir(parents=True)
        
        reference_images = []
        idx = 0
        while True:
            image_key = f'refImage_{idx}'
            folder_key = f'refFolder_{idx}'
            
            if image_key not in request.files:
                break
            
            image_file = request.files[image_key]
            target_folder = request.form.get(folder_key, '').strip()
            target_folder = os.path.expanduser(target_folder)
            
            if image_file.filename == '':
                idx += 1
                continue
            
            # 이미지 저장
            filename = secure_filename(image_file.filename)
            image_path = temp_dir / f"{idx}_{filename}"
            image_file.save(str(image_path))
            
            reference_images.append({
                'path': str(image_path),
                'name': filename,
                'targetFolder': target_folder
            })
            
            idx += 1
        
        if not reference_images:
            return jsonify({'error': '최소 1개의 기준 이미지가 필요합니다.'}), 400
        
        # 폴더 내 이미지 파일 목록
        image_files = CLIPClassifier.get_image_files(folder_path)
        
        if not image_files:
            return jsonify({'error': '폴더에 이미지 파일이 없습니다.'}), 400
        
        # 작업 초기화
        total_work = len(reference_images) + len(image_files)
        with tasks_lock:
            tasks[task_id] = {
                'status': 'starting',
                'mode': 'multi',
                'total': total_work,
                'current': 0,
                'percent': 0,
                'phase': 'init'
            }
        
        # 백그라운드 스레드에서 분석 실행
        thread = threading.Thread(
            target=run_multi_analysis,
            args=(task_id, reference_images, image_files, classify_mode)
        )
        thread.daemon = True
        thread.start()
        
        print(f"[다중 분석 시작] Task {task_id}, 기준 {len(reference_images)}개, 비교 {len(image_files)}개")
        
        return jsonify({
            'success': True,
            'taskId': task_id,
            'refCount': len(reference_images),
            'total': len(image_files)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/multi-analyze/progress/<task_id>')
def multi_analyze_progress(task_id):
    """다중 분석 진행 상황을 반환합니다."""
    with tasks_lock:
        task = tasks.get(task_id)
    
    if not task:
        return jsonify({'error': '작업을 찾을 수 없습니다.'}), 404
    
    response = {
        'status': task['status'],
        'current': task.get('current', 0),
        'total': task.get('total', 0),
        'percent': task.get('percent', 0),
        'phase': task.get('phase', ''),
        'batchSize': task.get('batch_size', 1)
    }
    
    if task['status'] == 'complete':
        response['allResults'] = task.get('allResults', [])
        response['totalCount'] = task.get('totalCount', 0)
        response['resultsByRef'] = task.get('resultsByRef', {})
        response['statsByRef'] = task.get('statsByRef', {})
        response['thresholdCountsByRef'] = task.get('thresholdCountsByRef', {})
        response['bestMatchThresholdCounts'] = task.get('bestMatchThresholdCounts', {})
        response['referenceImages'] = task.get('referenceImages', [])
        response['resultId'] = task_id
        response['failedCount'] = task.get('failed_count', 0)
        response['finalBatchSize'] = task.get('final_batch_size', 1)
        
    elif task['status'] == 'error':
        response['error'] = task.get('error', '알 수 없는 오류')
    
    return jsonify(response)


# ============================================
# 분류 API
# ============================================

@app.route('/classify', methods=['POST'])
def classify():
    """임계치 이상의 유사도를 가진 이미지들을 이동합니다 (단일 기준 이미지용)."""
    try:
        data = request.json
        threshold = float(data.get('threshold', 70))
        result_id = data.get('resultId', '')
        target_folder = data.get('targetFolder', '').strip()
        move_mode = data.get('moveMode', 'copy')
        
        if not target_folder:
            return jsonify({'error': '대상 폴더가 지정되지 않았습니다.'}), 400
        
        # 대상 폴더 생성
        target_folder = os.path.expanduser(target_folder)
        if not os.path.exists(target_folder):
            os.makedirs(target_folder)
        
        # 저장된 결과 가져오기
        with tasks_lock:
            task = tasks.get(result_id)
            similarities = task['similarities'] if task else []
        
        if not similarities:
            return jsonify({'error': '분석 결과가 없습니다. 먼저 분석을 실행해주세요.'}), 400
        
        moved_files = []
        errors = []
        
        for item in similarities:
            if item['similarity'] >= threshold:
                src_path = item['path']
                filename = item['filename']
                
                if os.path.exists(src_path):
                    dst_path = os.path.join(target_folder, filename)
                    
                    # 파일명 중복 처리
                    if os.path.exists(dst_path):
                        base, ext = os.path.splitext(filename)
                        counter = 1
                        while os.path.exists(dst_path):
                            dst_path = os.path.join(target_folder, f"{base}_{counter}{ext}")
                            counter += 1
                    
                    try:
                        if move_mode == 'move':
                            shutil.move(src_path, dst_path)
                        else:
                            shutil.copy2(src_path, dst_path)
                            
                        moved_files.append({
                            'source': src_path,
                            'destination': dst_path,
                            'similarity': item['similarity']
                        })
                    except Exception as e:
                        errors.append({
                            'file': filename,
                            'error': str(e)
                        })
                else:
                    errors.append({
                        'file': filename,
                        'error': '파일이 존재하지 않습니다.'
                    })
        
        action = "이동" if move_mode == 'move' else "복사"
        print(f"[분류 완료] {len(moved_files)}개 {action}, {len(errors)}개 오류")
        
        return jsonify({
            'success': True,
            'moved': moved_files,
            'errors': errors,
            'totalMoved': len(moved_files)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/multi-classify', methods=['POST'])
def multi_classify():
    """다중 기준 이미지 분류를 실행합니다. 각 기준 이미지별로 개별 임계치 적용."""
    try:
        data = request.json
        result_id = data.get('resultId', '')
        move_mode = data.get('moveMode', 'copy')
        classify_mode = data.get('classifyMode', 'best_match')  # 'best_match' 또는 'threshold'
        
        # 개별 임계치 (인덱스 -> 임계치)
        thresholds = data.get('thresholds', {})
        
        # 저장된 결과 가져오기
        with tasks_lock:
            task = tasks.get(result_id)
        
        if not task or task.get('status') != 'complete':
            return jsonify({'error': '분석 결과가 없습니다. 먼저 분석을 실행해주세요.'}), 400
        
        all_results = task.get('allResults', [])
        reference_images = task.get('referenceImages', [])
        
        if not all_results:
            return jsonify({'error': '분석 결과가 없습니다.'}), 400
        
        # 기준 이미지 이름 -> 인덱스 매핑
        ref_name_to_idx = {ref['name']: idx for idx, ref in enumerate(reference_images)}
        
        # 기본 임계치 70%
        def get_threshold_for_ref(ref_name):
            idx = ref_name_to_idx.get(ref_name, 0)
            return float(thresholds.get(str(idx), thresholds.get(idx, 70)))
        
        # 대상 폴더들 생성
        for ref in reference_images:
            target_folder = os.path.expanduser(ref['targetFolder'])
            if target_folder and not os.path.exists(target_folder):
                os.makedirs(target_folder)
        
        moved_files = []
        errors = []
        results_by_ref = {ref['name']: [] for ref in reference_images}
        
        for item in all_results:
            best_match = item['bestMatch']
            src_path = item['path']
            filename = item['filename']
            
            if not os.path.exists(src_path):
                errors.append({
                    'file': filename,
                    'error': '파일이 존재하지 않습니다.'
                })
                continue
            
            if classify_mode == 'best_match':
                # 해당 기준 이미지의 임계치 가져오기
                ref_threshold = get_threshold_for_ref(best_match['refName'])
                
                # 임계치 확인
                if best_match['similarity'] < ref_threshold:
                    continue
                
                # 최고 유사도 기준 이미지의 폴더로 분류
                target_folder = os.path.expanduser(best_match['targetFolder'])
                if not target_folder:
                    continue
                
                dst_path = os.path.join(target_folder, filename)
                
                # 파일명 중복 처리
                if os.path.exists(dst_path):
                    base, ext = os.path.splitext(filename)
                    counter = 1
                    while os.path.exists(dst_path):
                        dst_path = os.path.join(target_folder, f"{base}_{counter}{ext}")
                        counter += 1
                
                try:
                    if move_mode == 'move':
                        shutil.move(src_path, dst_path)
                    else:
                        shutil.copy2(src_path, dst_path)
                    
                    move_info = {
                        'source': src_path,
                        'destination': dst_path,
                        'refName': best_match['refName'],
                        'similarity': best_match['similarity']
                    }
                    moved_files.append(move_info)
                    results_by_ref[best_match['refName']].append(move_info)
                except Exception as e:
                    errors.append({
                        'file': filename,
                        'error': str(e)
                    })
            
            else:  # threshold mode - 임계치 이상인 것 중 가장 높은 유사도 폴더 1곳으로 (중복 없음)
                # 각 기준 이미지의 임계치를 만족하는 것들만 필터링
                qualified = []
                for sim_info in item['allSimilarities']:
                    ref_threshold = get_threshold_for_ref(sim_info['refName'])
                    if sim_info['similarity'] >= ref_threshold:
                        qualified.append(sim_info)
                
                # 임계치를 만족하는 것이 없으면 스킵
                if not qualified:
                    continue
                
                # 임계치를 만족하는 것 중 가장 높은 유사도 선택
                best_qualified = max(qualified, key=lambda x: x['similarity'])
                
                target_folder = os.path.expanduser(best_qualified['targetFolder'])
                if not target_folder:
                    continue
                
                dst_path = os.path.join(target_folder, filename)
                
                # 파일명 중복 처리
                if os.path.exists(dst_path):
                    base, ext = os.path.splitext(filename)
                    counter = 1
                    while os.path.exists(dst_path):
                        dst_path = os.path.join(target_folder, f"{base}_{counter}{ext}")
                        counter += 1
                
                try:
                    if move_mode == 'move':
                        shutil.move(src_path, dst_path)
                    else:
                        shutil.copy2(src_path, dst_path)
                    
                    move_info = {
                        'source': src_path,
                        'destination': dst_path,
                        'refName': best_qualified['refName'],
                        'similarity': best_qualified['similarity']
                    }
                    moved_files.append(move_info)
                    results_by_ref[best_qualified['refName']].append(move_info)
                except Exception as e:
                    errors.append({
                        'file': filename,
                        'refName': best_qualified['refName'],
                        'error': str(e)
                    })
        
        action = "이동" if move_mode == 'move' else "복사"
        print(f"[다중 분류 완료] {len(moved_files)}개 {action}, {len(errors)}개 오류")
        
        return jsonify({
            'success': True,
            'moved': moved_files,
            'errors': errors,
            'totalMoved': len(moved_files),
            'resultsByRef': results_by_ref
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)
