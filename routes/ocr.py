"""
OCR 텍스트 추출 라우트
"""

import os
import json
import shutil
import threading
import uuid
import traceback
import time
from flask import Blueprint, render_template, request, jsonify
from werkzeug.utils import secure_filename
from pathlib import Path
from models import OCRExtractor

# Blueprint 생성
ocr_bp = Blueprint('ocr', __name__)

# 임시 업로드 폴더
UPLOAD_FOLDER = Path('uploads')
UPLOAD_FOLDER.mkdir(exist_ok=True)

# OCR 모델 인스턴스 (lazy loading)
_ocr_extractor = None
_ocr_init_lock = threading.Lock()

# OCR 배치 작업 저장
ocr_tasks = {}
ocr_tasks_lock = threading.Lock()

# 작업 상태 저장 폴더
TASKS_STATE_FOLDER = Path('tasks_state')
TASKS_STATE_FOLDER.mkdir(exist_ok=True)


def get_image_files_recursive(folder_path: str) -> list:
    """폴더에서 이미지 파일 목록을 재귀적으로 가져옵니다 (하위 폴더 포함)."""
    print(f"[OCR 파일 검색] 폴더 검색 시작: {folder_path}", flush=True)
    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}
    folder = Path(folder_path)
    
    if not folder.exists():
        raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder_path}")
    
    print(f"[OCR 파일 검색] 폴더 존재 확인 완료, 파일 검색 시작...", flush=True)
    image_files = []
    file_count = 0
    
    try:
        for file in folder.rglob('*'):
            file_count += 1
            # 1000개마다 진행 상황 출력
            if file_count % 1000 == 0:
                print(f"[OCR 파일 검색] {file_count}개 파일 검색 중... (현재 발견: {len(image_files)}개 이미지)", flush=True)
            
            if file.is_file() and file.suffix.lower() in image_extensions:
                image_files.append(str(file))
        
        print(f"[OCR 파일 검색] 검색 완료: 총 {file_count}개 파일 중 {len(image_files)}개 이미지 발견", flush=True)
    except Exception as e:
        print(f"[OCR 파일 검색 오류] {file_count}개 파일 검색 중 오류 발생: {str(e)}", flush=True)
        raise
    
    return sorted(image_files)


def save_task_state(task_id, task_data):
    """작업 상태를 파일로 저장합니다."""
    try:
        state_file = TASKS_STATE_FOLDER / f"{task_id}.json"
        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(task_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[OCR 작업 상태 저장 오류] Task {task_id}: {str(e)}", flush=True)


def load_task_state(task_id):
    """파일에서 작업 상태를 로드합니다."""
    try:
        state_file = TASKS_STATE_FOLDER / f"{task_id}.json"
        if state_file.exists():
            with open(state_file, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"[OCR 작업 상태 로드 오류] Task {task_id}: {str(e)}", flush=True)
    return None


def get_processed_files(output_folder, input_folder=None):
    """출력 폴더에서 이미 처리된 파일 목록을 가져옵니다 (하위 폴더 구조 포함)."""
    processed = set()
    try:
        output_path = Path(output_folder)
        if not output_path.exists():
            return processed
        
        for json_file in output_path.rglob('*.json'):
            try:
                relative_to_output = json_file.relative_to(output_path)
                if relative_to_output.parent == Path('.'):
                    processed_key = relative_to_output.stem
                else:
                    processed_key = str(relative_to_output.parent / relative_to_output.stem).replace('\\', '/')
                processed.add(processed_key)
            except ValueError:
                processed.add(json_file.stem)
    except Exception as e:
        print(f"[OCR 처리된 파일 검색 오류] {str(e)}", flush=True)
    return processed


def get_ocr_extractor():
    """OCR 모델 인스턴스를 가져옵니다 (lazy loading)"""
    global _ocr_extractor
    
    if _ocr_extractor is None:
        with _ocr_init_lock:
            if _ocr_extractor is None:
                _ocr_extractor = OCRExtractor(lang='korean', use_gpu=True)
    
    return _ocr_extractor


def get_ocr_system_info():
    """OCR 페이지용 시스템 정보를 반환합니다."""
    import torch
    
    info = {
        'device': 'CUDA' if torch.cuda.is_available() else 'CPU',
        'gpu_name': None,
        'gpu_memory': None,
        'ocr_model': 'PaddleOCR v5'
    }
    
    if torch.cuda.is_available():
        info['gpu_name'] = torch.cuda.get_device_name(0)
        props = torch.cuda.get_device_properties(0)
        info['gpu_memory'] = f"{props.total_memory / (1024**3):.0f}GB"
    
    return info


# ============================================
# 백그라운드 작업 함수
# ============================================

def run_batch_ocr(task_id, folder_path, output_folder, start_from=0):
    """대용량 OCR 처리를 백그라운드에서 실행합니다 (각 이미지를 개별적으로 순차 처리)."""
    try:
        print(f"[OCR 대용량 처리 시작] Task {task_id}, 폴더: {folder_path}, 출력: {output_folder}, 시작 위치: {start_from}", flush=True)
        
        # OCR 모델 가져오기
        ocr = get_ocr_extractor()
        
        # 이미지 파일 목록 가져오기 (하위 폴더 포함)
        image_files = get_image_files_recursive(folder_path)
        total = len(image_files)
        print(f"[OCR] 총 {total}개 이미지 파일 발견", flush=True)
        
        # 작업 상태 초기화
        with ocr_tasks_lock:
            if task_id not in ocr_tasks:
                ocr_tasks[task_id] = {
                    'status': 'processing',
                    'total': 0,
                    'current': 0,
                    'percent': 0,
                    'results': [],
                    'errors': [],
                    'folder_path': folder_path,
                    'output_folder': output_folder,
                    'last_update_time': time.time()  # 마지막 업데이트 시간
                }
            ocr_tasks[task_id]['total'] = total
            ocr_tasks[task_id]['status'] = 'processing'
            ocr_tasks[task_id]['last_update_time'] = time.time()
            save_task_state(task_id, ocr_tasks[task_id])
        
        results = []
        errors = []
        folder_path_abs = os.path.abspath(folder_path)
        
        # 각 이미지를 개별적으로 순차 처리
        # 주의: 
        # 1. PaddleOCR의 배치(batch) 기능을 사용하지 않음
        # 2. 멀티쓰레드를 사용하지 않음 (병렬 처리 없음)
        # 3. 각 이미지를 하나씩 순차적으로 extract_text_with_stats()로 처리
        
        # 하트비트 로깅을 위한 변수
        last_heartbeat_time = time.time()
        heartbeat_interval = 60  # 60초마다 하트비트
        
        for idx, image_path in enumerate(image_files):
            if idx < start_from:
                continue
                
            filename = os.path.basename(image_path)
            current_num = idx + 1
            
            # 입력 폴더 기준 상대 경로 계산
            image_path_abs = os.path.abspath(image_path)
            relative_path = os.path.relpath(image_path_abs, folder_path_abs)
            relative_dir = os.path.dirname(relative_path)
            base_name = os.path.splitext(os.path.basename(relative_path))[0]
            
            # 출력 경로 생성 (하위 폴더 구조 유지)
            if relative_dir:
                output_dir = os.path.join(output_folder, relative_dir)
                os.makedirs(output_dir, exist_ok=True)
                output_file = os.path.join(output_dir, f"{base_name}.json")
            else:
                output_file = os.path.join(output_folder, f"{base_name}.json")
            
            # 이미 처리된 파일인지 확인
            # 기존 파일(970개 이하)은 검증 없이 스킵, 이후 파일부터는 검증 적용
            temp_file = output_file + '.tmp'
            if os.path.exists(temp_file):
                print(f"[OCR 정리] {current_num}/{total} - 불완전한 임시 파일 발견, 삭제: {temp_file}", flush=True)
                try:
                    os.remove(temp_file)
                except:
                    pass
            
            if os.path.exists(output_file):
                # 빠른 검증: 파일 크기만 확인 (JSON 파싱은 오래 걸리므로 생략)
                file_size = os.path.getsize(output_file)
                if file_size >= 10:  # 최소 크기 확인 (빠른 검증)
                    print(f"[OCR 스킵] {current_num}/{total} - 이미 처리됨: {relative_path} (크기: {file_size} bytes)", flush=True)
                    continue
                else:
                    print(f"[OCR 재처리] {current_num}/{total} - 불완전한 JSON 파일 발견 (크기: {file_size} bytes), 재처리: {relative_path}", flush=True)
                    os.remove(output_file)  # 불완전한 파일 삭제
            
            # 각 파일 처리 시작 로그 (상세 로깅)
            print(f"[OCR 시작] {current_num}/{total} - 파일: {relative_path}", flush=True)
            
            # 진행 상황 로그
            if current_num == 1 or current_num == total or current_num % 10 == 0:
                print(f"[OCR 진행] {current_num}/{total} ({int(current_num/total*100)}%) - 처리 중", flush=True)
            
            # OCR 처리 (각 이미지를 개별적으로 순차 처리)
            # 주의: 
            # - PaddleOCR의 배치(batch) 기능 사용 안 함
            # - 멀티쓰레드 병렬 처리 사용 안 함
            # - 단일 스레드에서 하나씩 순차 처리
            try:
                start_time = time.time()
                print(f"[OCR 실행] {current_num}/{total} - PaddleOCR.predict() 호출 시작: {relative_path}", flush=True)
                
                result = ocr.extract_text_with_stats(image_path)
                
                elapsed_time = time.time() - start_time
                print(f"[OCR 완료] {current_num}/{total} - PaddleOCR.predict() 완료 (소요: {elapsed_time:.2f}초): {relative_path}", flush=True)
                
                # 결과 저장 (메모리에서 검증 후 한 번에 저장)
                result_data = []
                for box in result['boxes']:
                    result_data.append({
                        'bbox': box.get('bbox', []),
                        'text': box.get('text', '')
                    })
                
                print(f"[OCR 저장] {current_num}/{total} - 결과 저장 시작: {output_file}", flush=True)
                
                # 메모리에서 JSON 문자열 생성 및 검증 (빠른 검증)
                json_str = json.dumps(result_data, ensure_ascii=False, indent=2)
                if len(json_str) < 10:  # 최소 크기 확인
                    raise ValueError(f"JSON 데이터가 너무 작습니다: {len(json_str)} bytes")
                
                # 임시 파일에 저장 후 원자적으로 이동 (한 번의 쓰기)
                temp_file = output_file + '.tmp'
                try:
                    with open(temp_file, 'w', encoding='utf-8') as f:
                        f.write(json_str)
                    
                    # 원자적으로 이동 (검증은 이미 메모리에서 완료)
                    os.replace(temp_file, output_file)
                    file_size = len(json_str.encode('utf-8'))
                    print(f"[OCR 저장] {current_num}/{total} - 결과 저장 완료 (크기: {file_size} bytes)", flush=True)
                    
                except Exception as save_error:
                    # 임시 파일 정리
                    if os.path.exists(temp_file):
                        try:
                            os.remove(temp_file)
                        except:
                            pass
                    raise save_error
                
                results.append({
                    'filename': filename,
                    'charCount': result['stats']['charCount'],
                    'outputFile': output_file
                })
                
                print(f"[OCR 성공] {current_num}/{total} - 전체 처리 완료: {relative_path} (총 {elapsed_time:.2f}초)", flush=True)
                
                # 느린 처리 경고
                if elapsed_time > 30:
                    print(f"[OCR 경고] {current_num}/{total} - 처리 시간이 30초를 초과했습니다: {elapsed_time:.2f}초", flush=True)
                
            except KeyboardInterrupt:
                print(f"[OCR 중단] 사용자에 의해 중단됨", flush=True)
                raise
            except Exception as e:
                error_msg = str(e)
                elapsed_time = time.time() - start_time if 'start_time' in locals() else 0
                print(f"[OCR 오류] {current_num}/{total} - 파일: {relative_path}, 오류: {error_msg} (처리 시간: {elapsed_time:.2f}초)", flush=True)
                print(f"[OCR 오류 상세]", flush=True)
                traceback.print_exc()
                errors.append({
                    'filename': filename,
                    'error': error_msg
                })
            
            # 하트비트 로그 (60초마다)
            current_time = time.time()
            if current_time - last_heartbeat_time >= heartbeat_interval:
                print(f"[OCR 하트비트] {current_num}/{total} - 작업 진행 중... (마지막 처리 파일: {relative_path})", flush=True)
                last_heartbeat_time = current_time
            
            # 진행 상황 업데이트 (매 파일마다 - 게이지바를 부드럽게 업데이트하기 위해)
            try:
                with ocr_tasks_lock:
                    ocr_tasks[task_id]['current'] = current_num
                    ocr_tasks[task_id]['percent'] = int(current_num / total * 100) if total > 0 else 100
                    ocr_tasks[task_id]['results'] = results
                    ocr_tasks[task_id]['errors'] = errors
                    ocr_tasks[task_id]['last_update_time'] = time.time()  # 마지막 업데이트 시간 갱신
                    # 매 파일마다 저장 (다중 워커/프로세스에서 progress API가 최신 상태를 읽을 수 있도록)
                    save_task_state(task_id, ocr_tasks[task_id])
            except Exception as save_error:
                print(f"[OCR 경고] 진행 상황 업데이트 실패: {str(save_error)}", flush=True)
        
        # 완료
        print(f"[OCR 대용량 처리 완료] Task {task_id}, 성공: {len(results)}, 실패: {len(errors)}", flush=True)
        with ocr_tasks_lock:
            ocr_tasks[task_id]['status'] = 'completed'
            ocr_tasks[task_id]['results'] = results
            ocr_tasks[task_id]['errors'] = errors
            save_task_state(task_id, ocr_tasks[task_id])
        
    except Exception as e:
        error_msg = str(e)
        print(f"[OCR 대용량 처리 중단] Task {task_id}, 오류 발생: {error_msg}", flush=True)
        traceback.print_exc()
        with ocr_tasks_lock:
            if task_id in ocr_tasks:
                ocr_tasks[task_id]['status'] = 'error'
                ocr_tasks[task_id]['error'] = error_msg
                save_task_state(task_id, ocr_tasks[task_id])


# ============================================
# 페이지 라우트
# ============================================

@ocr_bp.route('/ocr')
def ocr_page():
    """OCR 텍스트 추출 페이지"""
    return render_template('ocr_extractor.html', 
                         system_info=get_ocr_system_info(), 
                         active_page='ocr')


# ============================================
# OCR API
# ============================================

@ocr_bp.route('/ocr/extract', methods=['POST'])
def ocr_extract():
    """단일 이미지 OCR 텍스트 추출"""
    try:
        if 'image' not in request.files:
            return jsonify({'error': '이미지가 필요합니다.'}), 400
        
        image = request.files['image']
        if image.filename == '':
            return jsonify({'error': '이미지가 선택되지 않았습니다.'}), 400
        
        # 임시 파일 저장
        task_id = str(uuid.uuid4())
        temp_dir = UPLOAD_FOLDER / f"ocr_{task_id}"
        temp_dir.mkdir(parents=True)
        
        image_path = temp_dir / secure_filename(image.filename)
        image.save(str(image_path))
        
        print(f"[OCR 추출] 이미지: {image.filename}")
        
        # OCR 실행
        ocr = get_ocr_extractor()
        result = ocr.extract_text_with_stats(str(image_path))
        
        # 임시 파일 정리
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        return jsonify({
            'success': True,
            'text': result['text'],
            'boxes': result['boxes'],
            'stats': result['stats']
        })
        
    except ImportError as e:
        return jsonify({'error': f'OCR 라이브러리가 설치되지 않았습니다: {str(e)}'}), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ocr_bp.route('/ocr/batch/start', methods=['POST'])
def ocr_batch_start():
    """대용량 OCR 처리를 시작합니다."""
    try:
        data = request.json
        folder_path = data.get('folderPath', '').strip()
        output_folder = data.get('outputFolder', '').strip()
        
        # 경로 확장
        folder_path = os.path.expanduser(folder_path)
        output_folder = os.path.expanduser(output_folder)
        
        if not folder_path:
            return jsonify({'error': '이미지 폴더 경로가 필요합니다.'}), 400
        
        if not output_folder:
            return jsonify({'error': '출력 폴더 경로가 필요합니다.'}), 400
        
        if not os.path.exists(folder_path):
            return jsonify({'error': f'폴더를 찾을 수 없습니다: {folder_path}'}), 400
        
        # 출력 폴더 생성
        os.makedirs(output_folder, exist_ok=True)
        
        # 작업 초기화
        task_id = str(uuid.uuid4())
        with ocr_tasks_lock:
            ocr_tasks[task_id] = {
                'status': 'starting',
                'total': 0,
                'current': 0,
                'percent': 0,
                'results': [],
                'errors': [],
                'folder_path': folder_path,
                'output_folder': output_folder
            }
            save_task_state(task_id, ocr_tasks[task_id])
        
        # 백그라운드 스레드에서 실행
        thread = threading.Thread(
            target=run_batch_ocr,
            args=(task_id, folder_path, output_folder, 0)
        )
        thread.daemon = False
        thread.start()
        
        return jsonify({
            'success': True,
            'taskId': task_id
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ocr_bp.route('/ocr/batch/progress/<task_id>')
def ocr_batch_progress(task_id):
    """OCR 배치 처리 진행 상황을 반환합니다."""
    with ocr_tasks_lock:
        task = ocr_tasks.get(task_id)
    
    if not task:
        task = load_task_state(task_id)
        if task:
            ocr_tasks[task_id] = task
    
    if not task:
        return jsonify({'error': '작업을 찾을 수 없습니다.'}), 404
    
    # 처리 중일 때는 항상 파일에서 최신 상태 로드 (다중 워커에서 진행률이 갱신되도록)
    if task.get('status') == 'processing':
        disk_task = load_task_state(task_id)
        if disk_task and disk_task.get('current', 0) >= 0:
            task = disk_task
            with ocr_tasks_lock:
                ocr_tasks[task_id] = task
    
    # 타임아웃 체크 (5분 동안 업데이트가 없으면 타임아웃으로 간주)
    if task.get('status') == 'processing':
        last_update = task.get('last_update_time', 0)
        current_time = time.time()
        timeout_threshold = 300  # 5분 (300초)
        
        if last_update > 0 and (current_time - last_update) > timeout_threshold:
            print(f"[OCR 타임아웃 감지] Task {task_id}, 마지막 업데이트: {current_time - last_update:.1f}초 전", flush=True)
            task['status'] = 'timeout'
            task['error'] = f'처리가 멈춘 것으로 보입니다. 마지막 업데이트: {int((current_time - last_update) / 60)}분 전'
            save_task_state(task_id, task)
    
    return jsonify(task)


@ocr_bp.route('/ocr/batch/resume/<task_id>', methods=['POST'])
def ocr_batch_resume(task_id):
    """중단된 OCR 배치 작업을 재개합니다."""
    try:
        task = load_task_state(task_id)
        if not task:
            return jsonify({'error': '작업을 찾을 수 없습니다.'}), 404
        
        if task.get('status') == 'completed':
            return jsonify({'error': '이미 완료된 작업입니다.'}), 400
        
        folder_path = task.get('folder_path')
        output_folder = task.get('output_folder')
        current = task.get('current', 0)
        
        if not folder_path or not output_folder:
            return jsonify({'error': '작업 정보가 불완전합니다.'}), 400
        
        with ocr_tasks_lock:
            ocr_tasks[task_id] = task
            ocr_tasks[task_id]['status'] = 'resuming'
            save_task_state(task_id, ocr_tasks[task_id])
        
        thread = threading.Thread(
            target=run_batch_ocr,
            args=(task_id, folder_path, output_folder, current)
        )
        thread.daemon = False
        thread.start()
        
        return jsonify({
            'success': True,
            'taskId': task_id,
            'message': f'작업이 {current}번째 파일부터 재개됩니다.'
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


