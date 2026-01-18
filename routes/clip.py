"""
CLIP 이미지 분류 라우트
"""

import os
import shutil
import threading
import uuid
from flask import Blueprint, render_template, request, jsonify
from werkzeug.utils import secure_filename
from pathlib import Path

from models import CLIPClassifier

# Blueprint 생성
clip_bp = Blueprint('clip', __name__)

# 임시 업로드 폴더
UPLOAD_FOLDER = Path('uploads')
UPLOAD_FOLDER.mkdir(exist_ok=True)

# CLIP 분류기 초기화
clip_classifier = CLIPClassifier(model_name="ViT-B/32")

# 시스템 정보 (UI 표시용)
SYSTEM_INFO = clip_classifier.system_info

# 분석 작업 상태 저장
tasks = {}
tasks_lock = threading.Lock()


def get_system_info():
    """시스템 정보 반환"""
    return SYSTEM_INFO


# ============================================
# 백그라운드 작업 함수
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

@clip_bp.route('/')
@clip_bp.route('/clip')
def clip_page():
    """CLIP 이미지 분석 및 분류 페이지"""
    return render_template('clip_classifier.html', 
                         system_info=SYSTEM_INFO, 
                         active_page='clip')


# ============================================
# 단일 기준 이미지 API
# ============================================

@clip_bp.route('/analyze/start', methods=['POST'])
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


@clip_bp.route('/analyze/progress/<task_id>')
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
        response['similarities'] = similarities  # 전체 결과 (제한 없음)
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
# 다중 기준 이미지 API
# ============================================

@clip_bp.route('/multi-analyze/start', methods=['POST'])
def multi_analyze_start():
    """다중 기준 이미지 분석을 시작합니다."""
    try:
        # 폴더 경로 확인
        folder_path = request.form.get('folderPath', '').strip()
        folder_path = os.path.expanduser(folder_path)
        
        if not folder_path:
            print(f"[에러] 비교할 폴더 경로가 필요합니다.")
            return jsonify({'error': '비교할 폴더 경로가 필요합니다.'}), 400
        
        if not os.path.exists(folder_path):
            print(f"[에러] 폴더를 찾을 수 없습니다: {folder_path}")
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
            print(f"[에러] 최소 1개의 기준 이미지가 필요합니다.")
            return jsonify({'error': '최소 1개의 기준 이미지가 필요합니다.'}), 400
        
        # 폴더 내 이미지 파일 목록
        image_files = CLIPClassifier.get_image_files(folder_path)
        
        if not image_files:
            print(f"[에러] 폴더에 이미지 파일이 없습니다: {folder_path}")
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


@clip_bp.route('/multi-analyze/progress/<task_id>')
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

@clip_bp.route('/classify', methods=['POST'])
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
        moved_file_paths = set()  # 이미 이동된 파일 경로 추적
        
        for item in similarities:
            if item['similarity'] >= threshold:
                src_path = item['path']
                filename = item['filename']
                
                # 이미 이동된 파일인지 확인
                if src_path in moved_file_paths:
                    continue  # 이미 이동된 파일은 건너뛰기 (오류로 카운트하지 않음)
                
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
                        moved_file_paths.add(src_path)  # 이동된 파일 경로 기록
                    except Exception as e:
                        error_msg = str(e)
                        print(f"[분류 오류] 파일: {filename}, 원인: {error_msg}")
                        errors.append({
                            'file': filename,
                            'error': error_msg
                        })
                else:
                    # 파일이 없지만, 이미 이동된 파일일 가능성 확인
                    if os.path.exists(os.path.join(target_folder, filename)):
                        print(f"[분류] 파일: {filename}, 이미 이동됨 (중복 이동 시도 무시)")
                        moved_file_paths.add(src_path)
                        continue  # 이미 이동된 파일은 오류로 카운트하지 않음
                    
                    print(f"[분류 오류] 파일: {filename}, 원인: 파일이 존재하지 않습니다.")
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


@clip_bp.route('/multi-classify', methods=['POST'])
def multi_classify():
    """다중 기준 이미지 분류를 실행합니다. 각 기준 이미지별로 개별 임계치 적용."""
    try:
        data = request.json
        result_id = data.get('resultId', '')
        move_mode = data.get('moveMode', 'copy')
        classify_mode = data.get('classifyMode', 'best_match')
        
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
        moved_file_paths = set()  # 이미 이동된 파일 경로 추적
        
        for item in all_results:
            best_match = item['bestMatch']
            src_path = item['path']
            filename = item['filename']
            
            # 이미 이동된 파일인지 확인
            if src_path in moved_file_paths:
                continue  # 이미 이동된 파일은 건너뛰기 (오류로 카운트하지 않음)
            
            if not os.path.exists(src_path):
                # 파일이 없지만, 이미 이동된 파일일 가능성 확인
                already_moved = False
                for ref in reference_images:
                    target_folder = os.path.expanduser(ref['targetFolder'])
                    if target_folder and os.path.exists(os.path.join(target_folder, filename)):
                        already_moved = True
                        moved_file_paths.add(src_path)
                        break
                
                if already_moved:
                    print(f"[다중 분류] 파일: {filename}, 이미 이동됨 (중복 이동 시도 무시)")
                    continue  # 이미 이동된 파일은 오류로 카운트하지 않음
                
                print(f"[다중 분류 오류] 파일: {filename}, 원인: 파일이 존재하지 않습니다.")
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
                    moved_file_paths.add(src_path)  # 이동된 파일 경로 기록
                except Exception as e:
                    error_msg = str(e)
                    print(f"[다중 분류 오류] 파일: {filename}, 기준: {best_match['refName']}, 원인: {error_msg}")
                    errors.append({
                        'file': filename,
                        'error': error_msg
                    })
            
            else:  # threshold mode
                # 각 기준 이미지의 임계치를 만족하는 것들만 필터링
                qualified = []
                for sim_info in item['allSimilarities']:
                    ref_threshold = get_threshold_for_ref(sim_info['refName'])
                    if sim_info['similarity'] >= ref_threshold:
                        qualified.append(sim_info)
                
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
                    moved_file_paths.add(src_path)  # 이동된 파일 경로 기록
                except Exception as e:
                    error_msg = str(e)
                    print(f"[다중 분류 오류] 파일: {filename}, 기준: {best_qualified['refName']}, 원인: {error_msg}")
                    errors.append({
                        'file': filename,
                        'refName': best_qualified['refName'],
                        'error': error_msg
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
