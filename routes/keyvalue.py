"""
Key-Value 맵핑 라우트
"""

import os
import shutil
from flask import Blueprint, render_template, request, jsonify, send_file
from utils.file_utils import (
    ANNOTATION_IMAGE_EXTENSIONS,
    ensure_folder,
    expand_user_path,
    list_image_filenames,
    list_json_filenames,
    load_json_file,
    save_json_file,
)

# Blueprint 생성
keyvalue_bp = Blueprint('keyvalue', __name__)


# ============================================
# 페이지 라우트
# ============================================

@keyvalue_bp.route('/keyvalue')
def keyvalue_mapper():
    """Key-Value 맵핑 페이지"""
    from routes.clip import get_system_info
    return render_template('keyvalue_mapper.html', 
                         system_info=get_system_info(), 
                         active_page='keyvalue')


@keyvalue_bp.route('/keyvalue/batch')
def keyvalue_batch():
    """Key-Value 대용량 자동처리 페이지"""
    from routes.clip import get_system_info
    default_data_path = os.environ.get('DEFAULT_DATA_PATH', '/data')
    return render_template('keyvalue_batch.html', 
                         system_info=get_system_info(), 
                         active_page='keyvalue_batch',
                         default_data_path=default_data_path)


@keyvalue_bp.route('/keyvalue/editor')
def keyvalue_editor():
    """Key-Value 수정 뷰어 페이지"""
    from routes.clip import get_system_info
    default_data_path = os.environ.get('DEFAULT_DATA_PATH', '/data')
    return render_template('keyvalue_editor.html', 
                         system_info=get_system_info(), 
                         active_page='keyvalue_editor',
                         default_data_path=default_data_path)


# ============================================
# 에디터 API
# ============================================

@keyvalue_bp.route('/editor/check-folder', methods=['POST'])
def editor_check_folder():
    """에디터: 폴더 확인"""
    data = request.get_json()
    folder_path = data.get('folderPath')
    file_type = data.get('fileType')
    create_if_not_exists = data.get('createIfNotExists', False)
    save_folder = data.get('saveFolder')
    
    if not folder_path:
        return jsonify({'error': '폴더 경로가 필요합니다.'}), 400
    
    expanded_path = expand_user_path(folder_path)
    
    if not os.path.exists(expanded_path):
        if create_if_not_exists:
            try:
                ensure_folder(expanded_path)
            except Exception as e:
                return jsonify({'error': f'폴더 생성 실패: {str(e)}'}), 500
        else:
            return jsonify({'error': f'폴더를 찾을 수 없습니다: {expanded_path}'}), 404
    
    if not os.path.isdir(expanded_path):
        return jsonify({'error': f'경로가 폴더가 아닙니다: {expanded_path}'}), 400
    
    files = []
    if file_type == 'image':
        all_files = list_image_filenames(expanded_path, ANNOTATION_IMAGE_EXTENSIONS)
        if save_folder:
            save_folder = expand_user_path(save_folder)
            for f in all_files:
                original_path = os.path.join(expanded_path, f)
                save_path = os.path.join(save_folder, f)
                if os.path.exists(original_path) or os.path.exists(save_path):
                    files.append(f)
        else:
            files = all_files
    elif file_type == 'json':
        all_json_files = list_json_filenames(expanded_path)
        image_folder = data.get('imageFolder')
        if image_folder and save_folder:
            image_folder = expand_user_path(image_folder)
            save_folder = expand_user_path(save_folder)
            for json_file in all_json_files:
                base_name = os.path.splitext(json_file)[0]
                image_found = False
                for ext in ANNOTATION_IMAGE_EXTENSIONS:
                    image_filename = base_name + ext
                    original_image_path = os.path.join(image_folder, image_filename)
                    save_image_path = os.path.join(save_folder, image_filename)
                    if os.path.exists(original_image_path) or os.path.exists(save_image_path):
                        image_found = True
                        break
                if image_found:
                    files.append(json_file)
        else:
            files = all_json_files
    else:
        return jsonify({'error': '지원하지 않는 파일 타입입니다.'}), 400
    
    return jsonify({
        'success': True,
        'path': expanded_path,
        'files': sorted(files),
        'count': len(files)
    })


@keyvalue_bp.route('/editor/load-image')
def editor_load_image():
    """에디터: 이미지 로드 (원본 폴더에 없으면 저장 경로에서 찾기)"""
    folder = request.args.get('folder')
    file = request.args.get('file')
    save_folder = request.args.get('saveFolder')
    
    if not folder or not file:
        return 'Missing parameters', 400
    
    folder = expand_user_path(folder)
    file_path = os.path.join(folder, file)
    
    if not os.path.exists(file_path) and save_folder:
        save_folder = expand_user_path(save_folder)
        file_path = os.path.join(save_folder, file)
    
    if not os.path.exists(file_path):
        return 'File not found', 404
    
    return send_file(file_path)


@keyvalue_bp.route('/editor/load-json', methods=['POST'])
def editor_load_json():
    """에디터: JSON 로드 (저장 경로 우선 확인)"""
    data = request.get_json()
    folder_path = data.get('folderPath')
    filename = data.get('filename')
    save_folder = data.get('saveFolder')
    
    if not folder_path or not filename:
        return jsonify({'error': '필수 파라미터가 누락되었습니다.'}), 400
    
    file_path = None
    if save_folder:
        save_folder = expand_user_path(save_folder)
        save_file_path = os.path.join(save_folder, filename)
        if os.path.exists(save_file_path):
            file_path = save_file_path
    
    if not file_path:
        folder_path = expand_user_path(folder_path)
        file_path = os.path.join(folder_path, filename)
    
    if not os.path.exists(file_path):
        return jsonify({'success': False, 'error': 'JSON 파일이 없습니다.'})
    
    try:
        json_data = load_json_file(file_path)
        return jsonify({'success': True, 'data': json_data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@keyvalue_bp.route('/editor/save-json', methods=['POST'])
def editor_save_json():
    """에디터: JSON 저장 및 이미지 이동"""
    data = request.get_json()
    folder_path = data.get('folderPath')
    filename = data.get('filename')
    json_data = data.get('data')
    image_path = data.get('imagePath')
    image_filename = data.get('imageFilename')
    
    if not folder_path or not filename or json_data is None:
        return jsonify({'error': '필수 파라미터가 누락되었습니다.'}), 400
    
    folder_path = expand_user_path(folder_path)
    file_path = os.path.join(folder_path, filename)
    
    try:
        ensure_folder(folder_path)
        
        # LLM 학습용: 토큰 절약을 위한 최적화
        if isinstance(json_data, dict) and 'annotations' in json_data:
            for ann in json_data['annotations']:
                if isinstance(ann, dict):
                    if 'id' in ann:
                        del ann['id']
                    if 'text' in ann and ann['text'] is None:
                        del ann['text']
                    if 'bbox' in ann and isinstance(ann['bbox'], list):
                        ann['bbox'] = [int(round(x)) for x in ann['bbox']]
        
        save_json_file(file_path, json_data, compact=True)
        
        image_moved = False
        if image_path and image_filename:
            image_path = expand_user_path(image_path)
            if os.path.exists(image_path) and os.path.isfile(image_path):
                dst_image_path = os.path.join(folder_path, image_filename)
                try:
                    shutil.move(image_path, dst_image_path)
                    image_moved = True
                except Exception as e:
                    return jsonify({'success': False, 'error': f'이미지 이동 실패: {str(e)}'}), 500
        
        return jsonify({'success': True, 'imageMoved': image_moved})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


# ============================================
# 배치 처리 API
# ============================================

@keyvalue_bp.route('/batch/browse-folder', methods=['POST'])
def batch_browse_folder():
    """서버 폴더 브라우저 - 지정된 경로의 폴더/파일 목록 반환"""
    try:
        data = request.json
        current_path = data.get('path', '/').strip()
        
        # 경로 확장
        current_path = expand_user_path(current_path)
        
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


@keyvalue_bp.route('/batch/check-folder', methods=['POST'])
def batch_check_folder():
    """폴더 존재 여부와 파일 목록 확인"""
    try:
        data = request.json
        folder_path = data.get('folderPath', '').strip()
        file_type = data.get('fileType', 'image')  # 'image', 'json'
        
        if not folder_path:
            return jsonify({'error': '폴더 경로를 입력하세요.'}), 400
        
        # 경로 확장
        folder_path = expand_user_path(folder_path)
        
        if not os.path.exists(folder_path):
            return jsonify({'error': '폴더가 존재하지 않습니다.'}), 404
        
        if not os.path.isdir(folder_path):
            return jsonify({'error': '폴더 경로가 아닙니다.'}), 400
        
        # 파일 목록 가져오기
        files = []
        if file_type == 'image':
            files = list_image_filenames(folder_path, ANNOTATION_IMAGE_EXTENSIONS)
        elif file_type == 'json':
            files = list_json_filenames(folder_path)
        
        return jsonify({
            'success': True,
            'path': folder_path,
            'files': sorted(files),
            'count': len(files)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@keyvalue_bp.route('/batch/auto-mapping', methods=['POST'])
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
        
        # 결과 검증
        if mapped_result is None:
            return jsonify({'error': '자동 맵핑 결과가 None입니다.'}), 500
        
        if not isinstance(mapped_result, dict):
            return jsonify({'error': f'자동 맵핑 결과가 올바른 형식이 아닙니다: {type(mapped_result)}'}), 500
        
        # 이미지 이름 설정
        mapped_result['image'] = image_name
        
        return jsonify(mapped_result)
        
    except Exception as e:
        import traceback
        print(f"[자동맵핑 API 에러] {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@keyvalue_bp.route('/batch/process-image', methods=['POST'])
def batch_process_image():
    """단일 이미지에 대한 자동 맵핑 처리 및 저장"""
    try:
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
        image_folder = expand_user_path(image_folder)
        logistics_folder = expand_user_path(logistics_folder)
        paddle_folder = expand_user_path(paddle_folder)
        output_folder = expand_user_path(output_folder)
        
        # 출력 폴더 생성 (없으면)
        ensure_folder(output_folder)
        
        # 파일명에서 확장자 제거
        base_name = os.path.splitext(image_file)[0]
        json_name = f"{base_name}.json"
        
        # OCR 파일 경로
        logistics_file = os.path.join(logistics_folder, json_name)
        paddle_file = os.path.join(paddle_folder, json_name)
        output_file = os.path.join(output_folder, json_name)
        
        # 파일 존재 확인
        if not os.path.exists(logistics_file):
            return jsonify({'error': f'정답 라벨 파일을 찾을 수 없습니다: {json_name}'}), 404
        
        if not os.path.exists(paddle_file):
            return jsonify({'error': f'PaddleOCR 파일을 찾을 수 없습니다: {json_name}'}), 404
        
        # OCR 파일 읽기
        logistics_ocr = load_json_file(logistics_file)
        paddle_ocr = load_json_file(paddle_file)
        
        # 자동 맵핑 수행
        mapped_result = perform_auto_mapping(
            annotation_template, 
            paddle_ocr, 
            logistics_ocr
        )
        
        # JSON 파일 저장
        save_json_file(output_file, mapped_result)
        
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
