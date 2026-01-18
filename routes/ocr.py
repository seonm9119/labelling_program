"""
OCR 텍스트 추출 라우트
"""

import os
import json
import shutil
import threading
import uuid
from flask import Blueprint, render_template, request, jsonify
from werkzeug.utils import secure_filename
from pathlib import Path
from models import OCRExtractor

# Blueprint 생성
ocr_bp = Blueprint('ocr', __name__)


def get_image_files_recursive(folder_path: str) -> list:
    """
    폴더에서 이미지 파일 목록을 재귀적으로 가져옵니다 (하위 폴더 포함).
    
    Args:
        folder_path: 폴더 경로
        
    Returns:
        List[str]: 이미지 파일 경로 목록
    """
    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}
    folder = Path(folder_path)
    
    if not folder.exists():
        raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder_path}")
    
    print(f"[OCR 파일 검색] 폴더 검색 시작: {folder_path}", flush=True)
    image_files = []
    file_count = 0
    
    # 하위 폴더 포함하여 재귀적으로 검색
    try:
        for file in folder.rglob('*'):
            file_count += 1
            # 1000개마다 진행 상황 출력
            if file_count % 1000 == 0:
                print(f"[OCR 파일 검색] {file_count}개 파일 검색 중... (현재 발견: {len(image_files)}개 이미지)", flush=True)
            
            if file.is_file() and file.suffix.lower() in image_extensions:
                image_files.append(str(file))
    except Exception as e:
        print(f"[OCR 파일 검색 오류] {file_count}개 파일 검색 중 오류 발생: {str(e)}", flush=True)
        raise
    
    print(f"[OCR 파일 검색] 검색 완료: 총 {file_count}개 파일 중 {len(image_files)}개 이미지 발견", flush=True)
    return sorted(image_files)

# 임시 업로드 폴더
UPLOAD_FOLDER = Path('uploads')
UPLOAD_FOLDER.mkdir(exist_ok=True)

# OCR 모델 인스턴스 (lazy loading)
_ocr_extractor = None
_ocr_init_lock = threading.Lock()

# OCR 배치 작업 저장
ocr_tasks = {}
ocr_tasks_lock = threading.Lock()


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

def run_batch_ocr(task_id, folder_path, output_folder):
    """배치 OCR 처리를 백그라운드에서 실행합니다."""
    try:
        print(f"[OCR 배치 시작] Task {task_id}, 폴더: {folder_path}, 출력: {output_folder}", flush=True)
        
        # OCR 모델 가져오기
        print(f"[OCR 배치] OCR 모델 로딩 중...", flush=True)
        ocr = get_ocr_extractor()
        print(f"[OCR 배치] OCR 모델 로딩 완료", flush=True)
        
        # 이미지 파일 목록 가져오기 (하위 폴더 포함)
        print(f"[OCR 배치] 이미지 파일 목록 가져오는 중 (하위 폴더 포함)...", flush=True)
        try:
            image_files = get_image_files_recursive(folder_path)
            total = len(image_files)
            print(f"[OCR 배치] 총 {total}개 이미지 파일 발견", flush=True)
        except Exception as e:
            error_msg = str(e)
            print(f"[OCR 배치 오류] 이미지 파일 목록 가져오기 실패: {error_msg}", flush=True)
            import traceback
            traceback.print_exc()
            with ocr_tasks_lock:
                ocr_tasks[task_id]['status'] = 'error'
                ocr_tasks[task_id]['error'] = f'이미지 파일 목록 가져오기 실패: {error_msg}'
            return
        
        with ocr_tasks_lock:
            ocr_tasks[task_id]['total'] = total
            ocr_tasks[task_id]['status'] = 'processing'
        
        print(f"[OCR 배치] Task {task_id}, 총 {total}개 이미지 처리 시작 (멀티스레딩 사용)", flush=True)
        
        results = []
        errors = []
        
        # 입력 폴더 경로를 절대 경로로 정규화 (상대 경로 계산용)
        folder_path_abs = os.path.abspath(folder_path)
        
        print(f"[OCR 배치] 순차 처리 시작 (총 이미지: {total})", flush=True)
        
        # 순차 처리 (1개씩)
        for idx, image_path in enumerate(image_files):
            filename = os.path.basename(image_path)
            current_num = idx + 1
            
            # 10개마다 또는 첫 번째, 마지막에 로그 출력
            if current_num == 1 or current_num == total or current_num % 10 == 0:
                print(f"[OCR 배치 진행] {current_num}/{total} ({int(current_num/total*100)}%) - 처리 중: {filename}", flush=True)
            
            try:
                # OCR 실행
                result = ocr.extract_text_with_stats(image_path)
                
                # 입력 폴더 기준 상대 경로 계산
                image_path_abs = os.path.abspath(image_path)
                relative_path = os.path.relpath(image_path_abs, folder_path_abs)
                
                # 상대 경로의 디렉토리 부분과 파일명 분리
                relative_dir = os.path.dirname(relative_path)
                base_name = os.path.splitext(os.path.basename(relative_path))[0]
                
                # 출력 경로 생성 (하위 폴더 구조 유지)
                if relative_dir:
                    output_dir = os.path.join(output_folder, relative_dir)
                    os.makedirs(output_dir, exist_ok=True)
                    output_file = os.path.join(output_dir, f"{base_name}.json")
                else:
                    output_file = os.path.join(output_folder, f"{base_name}.json")
                
                # [{"bbox": [...], "text": "..."}] 형식으로 저장
                result_data = []
                for box in result['boxes']:
                    result_data.append({
                        'bbox': box.get('bbox', []),
                        'text': box.get('text', '')
                    })
                
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(result_data, f, ensure_ascii=False, indent=2)
                
                results.append({
                    'filename': filename,
                    'charCount': result['stats']['charCount'],
                    'outputFile': output_file
                })
                
            except Exception as e:
                error_msg = str(e)
                print(f"[OCR 배치 오류] {current_num}/{total} - 파일: {filename}, 오류: {error_msg}", flush=True)
                errors.append({
                    'filename': filename,
                    'error': error_msg
                })
            
            # 진행 상황 업데이트
            with ocr_tasks_lock:
                ocr_tasks[task_id]['current'] = current_num
                ocr_tasks[task_id]['percent'] = int(current_num / total * 100) if total > 0 else 100
        
        # 완료
        print(f"[OCR 배치 완료] Task {task_id}, 성공: {len(results)}, 실패: {len(errors)}", flush=True)
        with ocr_tasks_lock:
            ocr_tasks[task_id]['status'] = 'completed'
            ocr_tasks[task_id]['results'] = results
            ocr_tasks[task_id]['errors'] = errors
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"[OCR 배치 중단] Task {task_id}, 오류 발생: {error_msg}", flush=True)
        traceback.print_exc()
        with ocr_tasks_lock:
            if task_id in ocr_tasks:
                ocr_tasks[task_id]['status'] = 'error'
                ocr_tasks[task_id]['error'] = error_msg


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
                'errors': []
            }
        
        # 백그라운드 스레드에서 실행
        print(f"[OCR 배치 시작 요청] Task {task_id}, 폴더: {folder_path}, 출력: {output_folder}", flush=True)
        thread = threading.Thread(
            target=run_batch_ocr,
            args=(task_id, folder_path, output_folder)
        )
        thread.daemon = True
        thread.start()
        
        print(f"[OCR 배치] 백그라운드 스레드 시작됨, Task {task_id}", flush=True)
        
        return jsonify({
            'success': True,
            'taskId': task_id
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ocr_bp.route('/ocr/batch/progress/<task_id>')
def ocr_batch_progress(task_id):
    """OCR 배치 처리 진행 상황을 반환합니다."""
    with ocr_tasks_lock:
        task = ocr_tasks.get(task_id)
    
    if not task:
        print(f"[OCR 배치 진행 조회 실패] Task {task_id}를 찾을 수 없습니다. 현재 작업 수: {len(ocr_tasks)}", flush=True)
        return jsonify({'error': '작업을 찾을 수 없습니다.'}), 404
    
    # 진행 상황 로그 (10% 단위로)
    if 'percent' in task and task.get('percent', 0) % 10 == 0:
        current = task.get('current', 0)
        total = task.get('total', 0)
        status = task.get('status', 'unknown')
        print(f"[OCR 배치 진행 조회] Task {task_id}, 상태: {status}, 진행: {current}/{total} ({task.get('percent', 0)}%)", flush=True)
    
    return jsonify(task)
