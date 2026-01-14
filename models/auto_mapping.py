"""
자동 맵핑 로직 - keyvalue_auto.js의 runAutoMapping을 Python으로 완전 포팅
"""
import copy
import math
from typing import List, Dict, Any, Tuple, Optional


def perform_auto_mapping(template: Dict, paddle_ocr: Any, logistics_ocr: Any) -> Dict:
    """
    자동 맵핑 수행 - keyvalue_auto.js와 동일한 로직
    
    1. 수동맵핑 이동 (KEY 기준 텍스트 매칭)
    2. 수동맵핑 이동 (VALUE 기준, 1단계 실패한 KEY)
    3. 2단계 KEY PaddleOCR 미세 조정
    4. ETC PaddleOCR 독립 매칭
    5. 자동맵핑 결과 생성 (이동된 bbox 기준)
    """
    result = copy.deepcopy(template)
    
    # PaddleOCR words 추출
    if isinstance(paddle_ocr, list):
        paddle_words = extract_paddle_words_from_list(paddle_ocr)
    elif isinstance(paddle_ocr, dict):
        paddle_words = paddle_ocr.get('words', [])
    else:
        paddle_words = []
    
    print(f"[자동맵핑] PaddleOCR words: {len(paddle_words)}개")
    
    # 물류 OCR words 추출
    if isinstance(logistics_ocr, list):
        logistics_words = extract_logistics_words(logistics_ocr)
    elif isinstance(logistics_ocr, dict):
        logistics_words = extract_logistics_words(logistics_ocr.get('bbox', []))
    else:
        logistics_words = []
    
    print(f"[자동맵핑] 물류OCR words: {len(logistics_words)}개")
    
    # 템플릿 annotations 분리
    template_annotations = template.get('annotations', [])
    manual_keys = [a for a in template_annotations if a.get('type') == 'key' and a.get('bbox')]
    manual_values = [a for a in template_annotations if a.get('type') == 'value' and a.get('bbox')]
    manual_etcs = [a for a in template_annotations if a.get('type') == 'etc' and a.get('bbox')]
    
    print(f"[템플릿] KEY: {len(manual_keys)}개, VALUE: {len(manual_values)}개, ETC: {len(manual_etcs)}개")
    
    # 이동된 bbox 추적
    moved_bbox_map = {ann['id']: list(ann['bbox']) for ann in template_annotations if ann.get('bbox')}
    total_delta_map = {ann['id']: [0, 0] for ann in template_annotations if ann.get('bbox')}
    moved_etc_ids = set()
    
    # ========== 1단계: KEY 기준 이동 (텍스트 매칭) ==========
    print("\n========== 1단계: KEY 기준 이동 ==========")
    stage1_matched_key_ids = set()
    
    for manual_key in manual_keys:
        current_bbox = moved_bbox_map[manual_key['id']]
        manual_lines = [line.strip() for line in (manual_key.get('text') or '').split('\n') if line.strip()]
        
        # 1차: 텍스트 완전일치로 PaddleOCR 후보 찾기
        candidates = []
        for pw in paddle_words:
            if any(text_contains_single(line, pw['text']) for line in manual_lines):
                candidates.append(pw)
        
        matched = None
        match_type = ""
        
        if candidates:
            # 1차 성공: 텍스트 완전일치
            matched = min(candidates, key=lambda w: w['bbox'][0] + w['bbox'][1])
            match_type = "텍스트일치"
        else:
            # 2차: bbox 60% IoU로 PaddleOCR 찾기
            best_iou = 0.6
            for pw in paddle_words:
                iou = calculate_iou(current_bbox, pw['bbox'])
                if iou >= best_iou:
                    best_iou = iou
                    matched = pw
                    match_type = f"IoU({iou:.0%})"
        
        if not matched:
            print(f"[1단계 실패] KEY '{manual_key.get('text', '')[:20]}' → 텍스트일치/IoU 모두 없음")
            continue
        
        delta_x = matched['bbox'][0] - current_bbox[0]
        delta_y = matched['bbox'][1] - current_bbox[1]
        
        # KEY bbox 이동 (크기 유지)
        new_key_bbox = [
            matched['bbox'][0],
            matched['bbox'][1],
            matched['bbox'][0] + (current_bbox[2] - current_bbox[0]),
            matched['bbox'][1] + (current_bbox[3] - current_bbox[1])
        ]
        moved_bbox_map[manual_key['id']] = new_key_bbox
        total_delta_map[manual_key['id']] = [delta_x, delta_y]
        stage1_matched_key_ids.add(manual_key['id'])
        
        # 연결된 VALUE도 같이 이동 (VALUE의 key_id == KEY의 id)
        for manual_value in manual_values:
            if str(manual_value.get('key_id')) == str(manual_key['id']):
                val_bbox = moved_bbox_map[manual_value['id']]
                moved_bbox_map[manual_value['id']] = [
                    val_bbox[0] + delta_x,
                    val_bbox[1] + delta_y,
                    val_bbox[2] + delta_x,
                    val_bbox[3] + delta_y
                ]
                total_delta_map[manual_value['id']] = [delta_x, delta_y]
        
        print(f"[1단계 매칭] KEY '{manual_key.get('text', '')[:20]}' → '{matched['text']}' ({match_type}, 이동: {delta_x:.0f}, {delta_y:.0f})")
    
    print(f"[1단계 완료] {len(stage1_matched_key_ids)}개 KEY 매칭")
    
    # ========== 2단계: VALUE 기준 매칭 (1단계 실패한 KEY) ==========
    print("\n========== 2단계: VALUE 기준 매칭 ==========")
    
    # 자동맵핑 VALUE 생성 (물류OCR 기반)
    auto_values = generate_auto_values(logistics_words)
    print(f"[자동맵핑 VALUE 생성] {len(auto_values)}개")
    
    # 1단계에서 이동된 VALUE 수집 (VALUE의 key_id == KEY의 id)
    stage1_moved_value_ids = set()
    for mk_id in stage1_matched_key_ids:
        for mv in manual_values:
            if str(mv.get('key_id')) == str(mk_id):
                stage1_moved_value_ids.add(mv['id'])
    
    stage2_matched_key_ids = set()
    
    for manual_key in manual_keys:
        if manual_key['id'] in stage1_matched_key_ids:
            continue
        
        # 연결된 VALUE 중 1단계에서 이동 안 된 것들 (VALUE의 key_id == KEY의 id)
        linked_values = [v for v in manual_values if str(v.get('key_id')) == str(manual_key['id']) and v['id'] not in stage1_moved_value_ids]
        if not linked_values:
            continue
        
        # VALUE 기준으로 자동맵핑 VALUE와 매칭
        for manual_value in linked_values:
            manual_val_bbox = moved_bbox_map[manual_value['id']]
            
            # 가장 가까운 자동맵핑 VALUE 찾기
            best_auto_value = None
            best_dist = float('inf')
            
            for auto_val in auto_values:
                # 포함 또는 근접 확인
                is_contained = (auto_val['bbox'][0] >= manual_val_bbox[0] - 30 and
                                auto_val['bbox'][1] >= manual_val_bbox[1] - 30 and
                                auto_val['bbox'][2] <= manual_val_bbox[2] + 30 and
                                auto_val['bbox'][3] <= manual_val_bbox[3] + 30)
                
                dist = math.sqrt((auto_val['bbox'][0] - manual_val_bbox[0])**2 + 
                                 (auto_val['bbox'][1] - manual_val_bbox[1])**2)
                
                if (is_contained or dist < 50) and dist < best_dist:
                    best_dist = dist
                    best_auto_value = auto_val
            
            if best_auto_value:
                delta_x = best_auto_value['bbox'][0] - manual_val_bbox[0]
                delta_y = best_auto_value['bbox'][1] - manual_val_bbox[1]
                
                # KEY 이동
                key_bbox = moved_bbox_map[manual_key['id']]
                moved_key_bbox = [
                    key_bbox[0] + delta_x,
                    key_bbox[1] + delta_y,
                    key_bbox[2] + delta_x,
                    key_bbox[3] + delta_y
                ]
                
                # KEY 근처 PaddleOCR로 미세 조정
                closest_paddle = None
                min_paddle_dist = 50
                
                for pw in paddle_words:
                    dist = math.sqrt((pw['bbox'][0] - moved_key_bbox[0])**2 + 
                                     (pw['bbox'][1] - moved_key_bbox[1])**2)
                    if dist < min_paddle_dist:
                        min_paddle_dist = dist
                        closest_paddle = pw
                
                if closest_paddle:
                    key_width = moved_key_bbox[2] - moved_key_bbox[0]
                    key_height = moved_key_bbox[3] - moved_key_bbox[1]
                    moved_key_bbox = [
                        closest_paddle['bbox'][0],
                        closest_paddle['bbox'][1],
                        closest_paddle['bbox'][0] + key_width,
                        closest_paddle['bbox'][1] + key_height
                    ]
                    delta_x = closest_paddle['bbox'][0] - key_bbox[0]
                    delta_y = closest_paddle['bbox'][1] - key_bbox[1]
                
                moved_bbox_map[manual_key['id']] = moved_key_bbox
                total_delta_map[manual_key['id']] = [delta_x, delta_y]
                
                # 연결된 모든 VALUE 이동
                for lv in linked_values:
                    lv_bbox = moved_bbox_map[lv['id']]
                    moved_bbox_map[lv['id']] = [
                        lv_bbox[0] + delta_x,
                        lv_bbox[1] + delta_y,
                        lv_bbox[2] + delta_x,
                        lv_bbox[3] + delta_y
                    ]
                    total_delta_map[lv['id']] = [delta_x, delta_y]
                
                stage2_matched_key_ids.add(manual_key['id'])
                print(f"[2단계 매칭] KEY '{manual_key.get('text', '')[:20]}' → VALUE 기준 이동 ({delta_x:.0f}, {delta_y:.0f})")
                break
    
    print(f"[2단계 완료] {len(stage2_matched_key_ids)}개 KEY 추가 매칭")
    
    # ========== 3단계: 2단계 KEY PaddleOCR 미세 조정 ==========
    print("\n========== 3단계: 2단계 KEY 미세 조정 ==========")
    
    for key_id in stage2_matched_key_ids:
        manual_key = next((k for k in manual_keys if k['id'] == key_id), None)
        if not manual_key:
            continue
        
        current_bbox = moved_bbox_map[key_id]
        key_first_char = (manual_key.get('text') or '').strip()[:1].lower()
        
        # 현재 bbox에 걸쳐진 PaddleOCR 찾기
        overlapping_paddles = []
        for pw in paddle_words:
            if is_bbox_overlap(current_bbox, pw['bbox']):
                paddle_first_char = pw['text'].strip()[:1].lower()
                if key_first_char and paddle_first_char and key_first_char == paddle_first_char:
                    overlapping_paddles.append(pw)
        
        if overlapping_paddles:
            target_paddle = min(overlapping_paddles, key=lambda w: w['bbox'][0] + w['bbox'][1])
            
            key_width = current_bbox[2] - current_bbox[0]
            key_height = current_bbox[3] - current_bbox[1]
            new_bbox = [
                target_paddle['bbox'][0],
                target_paddle['bbox'][1],
                target_paddle['bbox'][0] + key_width,
                target_paddle['bbox'][1] + key_height
            ]
            
            extra_delta_x = target_paddle['bbox'][0] - current_bbox[0]
            extra_delta_y = target_paddle['bbox'][1] - current_bbox[1]
            
            moved_bbox_map[key_id] = new_bbox
            prev_delta = total_delta_map[key_id]
            total_delta_map[key_id] = [prev_delta[0] + extra_delta_x, prev_delta[1] + extra_delta_y]
            
            # 연결된 VALUE도 같이 이동 (VALUE의 key_id == KEY의 id)
            for lv in [v for v in manual_values if str(v.get('key_id')) == str(manual_key['id'])]:
                lv_bbox = moved_bbox_map[lv['id']]
                moved_bbox_map[lv['id']] = [
                    lv_bbox[0] + extra_delta_x,
                    lv_bbox[1] + extra_delta_y,
                    lv_bbox[2] + extra_delta_x,
                    lv_bbox[3] + extra_delta_y
                ]
                lv_prev_delta = total_delta_map[lv['id']]
                total_delta_map[lv['id']] = [lv_prev_delta[0] + extra_delta_x, lv_prev_delta[1] + extra_delta_y]
            
            print(f"[3단계] KEY '{manual_key.get('text', '')[:20]}' → PaddleOCR '{target_paddle['text']}' 미세 조정")
    
    print(f"[3단계 완료]")
    
    # ========== 4단계: ETC 독립 처리 (PaddleOCR 기준) ==========
    print("\n========== 4단계: ETC 독립 처리 ==========")
    
    for etc in manual_etcs:
        etc_bbox = list(etc['bbox'])
        etc_text = etc.get('text', '')
        etc_words = etc_text.strip().split()
        
        if not etc_words:
            continue
        
        first_word = etc_words[0].lower()
        
        # 1차: bbox 겹침 + 텍스트 매칭
        overlapping_matches = []
        for pw in paddle_words:
            if is_bbox_overlap(etc_bbox, pw['bbox']):
                # KEY/VALUE 영역에 있는지 확인
                if is_inside_moved_key_value(pw['bbox'], manual_keys, manual_values, moved_bbox_map):
                    continue
                
                pw_normalized = pw['text'].lower().replace(' ', '').replace('\n', '').replace('/', '').replace('-', '')
                first_normalized = first_word.replace(' ', '').replace('\n', '').replace('/', '').replace('-', '')
                
                if (pw_normalized.startswith(first_normalized[:min(10, len(first_normalized))]) or
                    first_normalized.startswith(pw_normalized[:min(10, len(pw_normalized))])):
                    overlapping_matches.append(pw)
        
        target_paddle = None
        
        if overlapping_matches:
            target_paddle = min(overlapping_matches, key=lambda w: w['bbox'][0] + w['bbox'][1])
        else:
            # 2차: 텍스트 전용 매칭
            text_matches = []
            for pw in paddle_words:
                if is_inside_moved_key_value(pw['bbox'], manual_keys, manual_values, moved_bbox_map):
                    continue
                
                pw_normalized = pw['text'].lower().replace(' ', '').replace('\n', '').replace('/', '').replace('-', '')
                first_normalized = first_word.replace(' ', '').replace('\n', '').replace('/', '').replace('-', '')
                
                if (pw_normalized.startswith(first_normalized[:min(10, len(first_normalized))]) or
                    first_normalized.startswith(pw_normalized[:min(10, len(pw_normalized))])):
                    text_matches.append(pw)
            
            if text_matches:
                etc_center_x = (etc_bbox[0] + etc_bbox[2]) / 2
                etc_center_y = (etc_bbox[1] + etc_bbox[3]) / 2
                target_paddle = min(text_matches, key=lambda w:
                    ((w['bbox'][0] + w['bbox'][2])/2 - etc_center_x)**2 + 
                    ((w['bbox'][1] + w['bbox'][3])/2 - etc_center_y)**2
                )
        
        if target_paddle:
            etc_width = etc_bbox[2] - etc_bbox[0]
            etc_height = etc_bbox[3] - etc_bbox[1]
            new_bbox = [
                target_paddle['bbox'][0],
                target_paddle['bbox'][1],
                target_paddle['bbox'][0] + etc_width,
                target_paddle['bbox'][1] + etc_height
            ]
            
            delta_x = target_paddle['bbox'][0] - etc_bbox[0]
            delta_y = target_paddle['bbox'][1] - etc_bbox[1]
            
            moved_bbox_map[etc['id']] = new_bbox
            total_delta_map[etc['id']] = [delta_x, delta_y]
            moved_etc_ids.add(etc['id'])
            
            print(f"[ETC 매칭] '{etc_text[:20]}' → PaddleOCR '{target_paddle['text']}'")
        else:
            print(f"[ETC 실패] '{etc_text[:20]}' → 매칭 안 됨")
    
    print(f"[4단계 완료] {len(moved_etc_ids)}개 ETC 매칭")
    
    # ========== 5단계: 자동맵핑 결과 생성 (이동된 bbox 기준) ==========
    print("\n========== 5단계: 자동맵핑 결과 생성 ==========")
    auto_mapping_result = []
    
    # 5-1. KEY: 이동된 bbox와 PaddleOCR 60% IoU 비교
    for manual_key in manual_keys:
        key_bbox = moved_bbox_map[manual_key['id']]
        
        # 60% IoU 이상인 PaddleOCR 찾기
        best_match = None
        best_iou = 0.6
        
        for pw in paddle_words:
            iou = calculate_iou(key_bbox, pw['bbox'])
            if iou > best_iou:
                best_iou = iou
                best_match = pw
        
        if best_match:
            # PaddleOCR bbox 사용 (가로 범위 제한)
            final_bbox = list(best_match['bbox'])
            paddle_width = final_bbox[2] - final_bbox[0]
            manual_width = key_bbox[2] - key_bbox[0]
            
            if paddle_width > manual_width:
                final_bbox[0] = max(final_bbox[0], key_bbox[0])
                final_bbox[2] = min(final_bbox[2], key_bbox[2])
            
            auto_mapping_result.append({
                'type': 'key',
                'bbox': final_bbox,
                'text': manual_key.get('text', ''),
                'key_id': manual_key['id']
            })
        else:
            # 매칭 실패 시 이동된 bbox 사용
            auto_mapping_result.append({
                'type': 'key',
                'bbox': key_bbox,
                'text': manual_key.get('text', ''),
                'key_id': manual_key['id']
            })
    
    # 5-2. VALUE: 이동된 bbox와 물류OCR 60% overlap 비교
    for manual_value in manual_values:
        val_bbox = moved_bbox_map[manual_value['id']]
        
        # 60% 이상 겹치는 물류OCR 찾기
        overlapping_logistics = []
        for lw in logistics_words:
            overlap_ratio = calculate_overlap_ratio(lw['bbox'], val_bbox)
            if overlap_ratio >= 0.6:
                overlapping_logistics.append(lw)
        
        if overlapping_logistics:
            # y 좌표 정렬 후 그룹화
            overlapping_logistics.sort(key=lambda w: w['bbox'][1])
            
            avg_height = sum(w['bbox'][3] - w['bbox'][1] for w in overlapping_logistics) / len(overlapping_logistics)
            line_gap_threshold = avg_height * 1.5
            
            groups = []
            current_group = [overlapping_logistics[0]]
            
            for i in range(1, len(overlapping_logistics)):
                prev = overlapping_logistics[i - 1]
                curr = overlapping_logistics[i]
                gap = curr['bbox'][1] - prev['bbox'][3]
                
                if gap > line_gap_threshold:
                    groups.append(current_group)
                    current_group = [curr]
                else:
                    current_group.append(curr)
            groups.append(current_group)
            
            # 각 그룹을 별도 VALUE로 생성
            for group_idx, group in enumerate(groups, start=1):
                # 같은 줄 내에서 왼쪽→오른쪽 순서로 정렬 (x 좌표 기준)
                group.sort(key=lambda w: w['bbox'][0])
                
                merged_bbox = [
                    min(w['bbox'][0] for w in group),
                    min(w['bbox'][1] for w in group),
                    max(w['bbox'][2] for w in group),
                    max(w['bbox'][3] for w in group)
                ]
                merged_text = ' '.join(w['text'] for w in group)
                
                auto_mapping_result.append({
                    'type': 'value',
                    'bbox': merged_bbox,
                    'text': merged_text,
                    'key_id': manual_value.get('key_id'),
                    'order': group_idx
                })
        else:
            # 매칭 실패 시 이동된 bbox + 수동맵핑 text 사용
            auto_mapping_result.append({
                'type': 'value',
                'bbox': val_bbox,
                'text': manual_value.get('text', ''),
                'key_id': manual_value.get('key_id'),
                'order': 1
            })
    
    # 5-3. ETC: 이동된 bbox 사용
    for etc in manual_etcs:
        if etc['id'] in moved_etc_ids:
            auto_mapping_result.append({
                'type': 'etc',
                'bbox': moved_bbox_map[etc['id']],
                'text': etc.get('text', '')
            })
    
    key_count = sum(1 for a in auto_mapping_result if a['type'] == 'key')
    value_count = sum(1 for a in auto_mapping_result if a['type'] == 'value')
    etc_count = sum(1 for a in auto_mapping_result if a['type'] == 'etc')
    print(f"[자동맵핑 완료] KEY: {key_count}개, VALUE: {value_count}개, ETC: {etc_count}개, 총: {len(auto_mapping_result)}개")
    
    result['annotations'] = auto_mapping_result
    return result


def generate_auto_values(logistics_words: List[Dict]) -> List[Dict]:
    """물류 OCR을 가로로 합쳐서 자동맵핑 VALUE 생성"""
    if not logistics_words:
        return []
    
    avg_height = sum(w['bbox'][3] - w['bbox'][1] for w in logistics_words) / len(logistics_words)
    space_gap = avg_height
    
    sorted_words = sorted(logistics_words, key=lambda w: ((w['bbox'][1] + w['bbox'][3]) / 2, w['bbox'][0]))
    
    def is_same_line(bbox1, bbox2):
        y1_mid = (bbox1[1] + bbox1[3]) / 2
        y2_mid = (bbox2[1] + bbox2[3]) / 2
        return abs(y1_mid - y2_mid) < avg_height * 0.5
    
    values = []
    used = set()
    
    for i, word in enumerate(sorted_words):
        if i in used:
            continue
        
        cluster = [word]
        used.add(i)
        last_word = word
        
        for j in range(i + 1, len(sorted_words)):
            if j in used:
                continue
            
            curr_word = sorted_words[j]
            
            if not is_same_line(last_word['bbox'], curr_word['bbox']):
                continue
            
            x_gap = curr_word['bbox'][0] - last_word['bbox'][2]
            
            if 0 <= x_gap <= space_gap:
                cluster.append(curr_word)
                used.add(j)
                last_word = curr_word
        
        cluster.sort(key=lambda w: w['bbox'][0])
        
        merged_bbox = [
            min(w['bbox'][0] for w in cluster),
            min(w['bbox'][1] for w in cluster),
            max(w['bbox'][2] for w in cluster),
            max(w['bbox'][3] for w in cluster)
        ]
        merged_text = ' '.join(w['text'] for w in cluster)
        
        values.append({
            'bbox': merged_bbox,
            'text': merged_text
        })
    
    return values


def text_contains_single(manual_line: str, paddle_text: str) -> bool:
    """텍스트 완전일치 (띄어쓰기 제외)"""
    if not manual_line or not paddle_text:
        return False
    
    # 띄어쓰기만 제외하고 완전일치
    manual_no_space = manual_line.strip().replace(' ', '')
    paddle_no_space = paddle_text.replace(' ', '')
    
    return paddle_no_space == manual_no_space


def levenshtein_distance(s1: str, s2: str) -> int:
    """편집 거리 계산"""
    m, n = len(s1), len(s2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if s1[i - 1] == s2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    
    return dp[m][n]


def is_inside_moved_key_value(paddle_bbox: List, manual_keys: List[Dict], manual_values: List[Dict], moved_bbox_map: Dict) -> bool:
    """PaddleOCR이 이동된 KEY/VALUE 영역에 있는지 확인"""
    pw_center_x = (paddle_bbox[0] + paddle_bbox[2]) / 2
    pw_center_y = (paddle_bbox[1] + paddle_bbox[3]) / 2
    
    for key in manual_keys:
        key_bbox = moved_bbox_map.get(key['id'])
        if key_bbox and (pw_center_x >= key_bbox[0] and pw_center_x <= key_bbox[2] and
                         pw_center_y >= key_bbox[1] and pw_center_y <= key_bbox[3]):
            return True
    
    for value in manual_values:
        val_bbox = moved_bbox_map.get(value['id'])
        if val_bbox and (pw_center_x >= val_bbox[0] and pw_center_x <= val_bbox[2] and
                         pw_center_y >= val_bbox[1] and pw_center_y <= val_bbox[3]):
            return True
    
    return False


def is_bbox_overlap(bbox1: List, bbox2: List) -> bool:
    """두 bbox가 겹치는지 확인"""
    return not (bbox1[2] < bbox2[0] or bbox1[0] > bbox2[2] or 
                bbox1[3] < bbox2[1] or bbox1[1] > bbox2[3])


def calculate_iou(bbox1: List, bbox2: List) -> float:
    """IoU 계산"""
    ix1 = max(bbox1[0], bbox2[0])
    iy1 = max(bbox1[1], bbox2[1])
    ix2 = min(bbox1[2], bbox2[2])
    iy2 = min(bbox1[3], bbox2[3])
    
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    
    intersection = (ix2 - ix1) * (iy2 - iy1)
    area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1])
    area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1])
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0.0


def calculate_overlap_ratio(small_bbox: List, large_bbox: List) -> float:
    """작은 bbox 기준 overlap ratio 계산"""
    ix1 = max(small_bbox[0], large_bbox[0])
    iy1 = max(small_bbox[1], large_bbox[1])
    ix2 = min(small_bbox[2], large_bbox[2])
    iy2 = min(small_bbox[3], large_bbox[3])
    
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    
    intersection = (ix2 - ix1) * (iy2 - iy1)
    small_area = (small_bbox[2] - small_bbox[0]) * (small_bbox[3] - small_bbox[1])
    
    return intersection / small_area if small_area > 0 else 0.0


def extract_paddle_words_from_list(paddle_list: List) -> List[Dict]:
    """PaddleOCR 리스트에서 words 추출"""
    words = []
    
    for item in paddle_list:
        if not isinstance(item, dict):
            continue
        
        bbox_points = item.get('bbox', [])
        text = item.get('text', '')
        
        if not text or not bbox_points:
            continue
        
        if len(bbox_points) >= 4 and isinstance(bbox_points[0], list):
            x_coords = [p[0] for p in bbox_points if len(p) >= 2]
            y_coords = [p[1] for p in bbox_points if len(p) >= 2]
            
            if x_coords and y_coords:
                bbox = [min(x_coords), min(y_coords), max(x_coords), max(y_coords)]
                words.append({'text': text, 'bbox': bbox})
    
    return words


def extract_logistics_words(logistics_ocr: List) -> List[Dict]:
    """물류 OCR에서 words 추출"""
    words = []
    
    for item in logistics_ocr:
        if not isinstance(item, dict):
            continue
        
        text = item.get('data') or item.get('text', '')
        x_coords = item.get('x', [])
        y_coords = item.get('y', [])
        
        if len(x_coords) >= 4 and len(y_coords) >= 4 and text:
            bbox = [min(x_coords), min(y_coords), max(x_coords), max(y_coords)]
            words.append({'text': text, 'bbox': bbox})
    
    return words
