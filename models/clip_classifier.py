"""
CLIP 이미지 분류기 모델
OpenAI CLIP을 사용한 이미지 유사도 분석 및 분류
"""

import os
import torch
from PIL import Image
import clip
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from queue import Queue


class CLIPClassifier:
    """CLIP 기반 이미지 분류기"""
    
    def __init__(self, model_name="ViT-B/32"):
        """
        CLIP 모델을 초기화합니다.
        
        Args:
            model_name: 사용할 CLIP 모델 이름 (기본값: ViT-B/32)
        """
        self.model_name = model_name
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        print(f"[CLIP] 모델 로드 중: {model_name}")
        print(f"[CLIP] 디바이스: {self.device}")
        
        self.model, self.preprocess = clip.load(model_name, device=self.device)
        
        # 시스템 정보 수집
        self.system_info = self._get_system_info()
        
        # 배치 사이즈 설정
        self.initial_batch_size = self._calculate_optimal_batch_size()
        self.current_batch_size = self.initial_batch_size
        
        print(f"[CLIP] 초기화 완료")
        print(f"[시스템] GPU: {self.system_info.get('gpu_name', 'N/A')}, VRAM: {self.system_info.get('gpu_memory', 'N/A')}")
        print(f"[배치] 초기 배치 사이즈: {self.initial_batch_size}")
    
    def _get_system_info(self):
        """시스템 정보를 수집합니다."""
        info = {
            'device': self.device.upper(),
            'gpu_name': None,
            'gpu_memory': None,
            'gpu_memory_bytes': 0,
            'clip_model': self.model_name
        }
        
        if torch.cuda.is_available():
            info['gpu_name'] = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            info['gpu_memory'] = f"{props.total_memory / (1024**3):.0f}GB"
            info['gpu_memory_bytes'] = props.total_memory
        
        return info
    
    def _calculate_optimal_batch_size(self):
        """VRAM에 따른 최적 배치 사이즈를 계산합니다."""
        if self.device == "cpu":
            return 8  # CPU는 작은 배치
        
        total_vram = self.system_info.get('gpu_memory_bytes', 0)
        if total_vram == 0:
            return 16  # 기본값
        
        total_gb = total_vram / (1024**3)
        
        # CLIP ViT-B/32 기준:
        # - 모델 자체: ~400MB
        # - 이미지당: ~3MB (전처리 + 추론)
        # - 안전 마진: 50% VRAM 사용 (12GB면 충분)
        available_for_batch = (total_gb - 1.0) * 0.5  # GB
        
        # 이미지당 약 3MB 예상
        optimal_size = int(available_for_batch * 1024 / 3)
        
        # 범위 제한: 최소 8, 최대 768 (12GB VRAM 기준, 더 큰 배치로 속도 향상)
        optimal_size = max(8, min(768, optimal_size))
        
        # 8의 배수로 조정
        optimal_size = (optimal_size // 8) * 8
        
        return max(8, optimal_size)
    
    def get_image_embedding(self, image_path):
        """단일 이미지의 CLIP 임베딩을 계산합니다."""
        image = self.preprocess(Image.open(image_path).convert("RGB")).unsqueeze(0).to(self.device)
        with torch.no_grad():
            image_features = self.model.encode_image(image)
            image_features /= image_features.norm(dim=-1, keepdim=True)
        return image_features
    
    def calculate_similarity(self, embedding1, embedding2):
        """두 임베딩 간의 코사인 유사도를 계산합니다."""
        # 두 텐서를 같은 장치로 이동 (CPU에서 계산 - 메모리 효율적)
        # Half precision (float16)은 CPU에서 지원하지 않으므로 float32로 변환
        e1 = embedding1.cpu().float() if embedding1.is_cuda else embedding1.float()
        e2 = embedding2.cpu().float() if embedding2.is_cuda else embedding2.float()
        similarity = (e1 @ e2.T).item()
        return similarity
    
    def get_batch_embeddings(self, image_paths, progress_callback=None):
        """
        여러 이미지의 임베딩을 배치로 계산합니다.
        OOM 발생 시 배치 사이즈를 줄여서 재시도합니다.
        
        Args:
            image_paths: 이미지 경로 리스트
            progress_callback: 진행 상황 콜백 함수 (current, total, batch_size)
        
        Returns: 
            tuple: (결과 리스트 [(path, embedding), ...], 실패 경로 리스트)
        """
        results = []
        failed_paths = []
        idx = 0
        batch_count = 0
        
        print(f"[배치 처리 시작] 총 {len(image_paths)}개 이미지, 배치 사이즈: {self.current_batch_size}", flush=True)
        
        # 배치 오버랩을 위한 프리페칭 큐
        prefetch_queue = Queue(maxsize=1)
        prefetch_thread = None
        stop_prefetch = threading.Event()
        
        def prefetch_next_batch(next_idx):
            """다음 배치를 미리 로딩"""
            if next_idx >= len(image_paths):
                return None
            
            next_batch_paths = image_paths[next_idx:next_idx + self.current_batch_size]
            batch_images = []
            valid_paths = []
            
            def load_image(path):
                try:
                    with Image.open(path) as img:
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        processed = self.preprocess(img)
                    return (path, processed, None)
                except Exception as e:
                    return (path, None, e)
            
            with ThreadPoolExecutor(max_workers=18) as executor:
                futures = {executor.submit(load_image, path): path for path in next_batch_paths}
                for future in as_completed(futures):
                    if stop_prefetch.is_set():
                        break
                    path, processed, error = future.result()
                    if error:
                        failed_paths.append(path)
                    elif processed is not None:
                        batch_images.append(processed)
                        valid_paths.append(path)
            
            if batch_images and not stop_prefetch.is_set():
                return (batch_images, valid_paths, next_idx)
            return None
        
        while idx < len(image_paths):
            batch_paths = image_paths[idx:idx + self.current_batch_size]
            
            try:
                # 프리페칭된 배치가 있으면 사용, 없으면 새로 로딩
                if not prefetch_queue.empty():
                    prefetched = prefetch_queue.get()
                    if prefetched:
                        batch_images, valid_paths, _ = prefetched
                    else:
                        # 프리페칭 실패 시 일반 로딩
                        batch_images = []
                        valid_paths = []
                        
                        def load_image(path):
                            try:
                                with Image.open(path) as img:
                                    if img.mode != 'RGB':
                                        img = img.convert('RGB')
                                    processed = self.preprocess(img)
                                return (path, processed, None)
                            except Exception as e:
                                return (path, None, e)
                        
                        with ThreadPoolExecutor(max_workers=18) as executor:
                            futures = {executor.submit(load_image, path): path for path in batch_paths}
                            for future in as_completed(futures):
                                path, processed, error = future.result()
                                if error:
                                    print(f"[이미지 로드 실패] {path}: {error}")
                                    failed_paths.append(path)
                                elif processed is not None:
                                    batch_images.append(processed)
                                    valid_paths.append(path)
                else:
                    # 일반 로딩
                    batch_images = []
                    valid_paths = []
                    
                    def load_image(path):
                        try:
                            with Image.open(path) as img:
                                if img.mode != 'RGB':
                                    img = img.convert('RGB')
                                processed = self.preprocess(img)
                            return (path, processed, None)
                        except Exception as e:
                            return (path, None, e)
                    
                    with ThreadPoolExecutor(max_workers=18) as executor:
                        futures = {executor.submit(load_image, path): path for path in batch_paths}
                        for future in as_completed(futures):
                            path, processed, error = future.result()
                            if error:
                                print(f"[이미지 로드 실패] {path}: {error}")
                                failed_paths.append(path)
                            elif processed is not None:
                                batch_images.append(processed)
                                valid_paths.append(path)
                
                # 다음 배치 프리페칭 시작 (현재 배치 처리와 병렬)
                next_idx = idx + len(batch_paths)
                if next_idx < len(image_paths) and (prefetch_thread is None or not prefetch_thread.is_alive()):
                    stop_prefetch.clear()
                    prefetch_thread = threading.Thread(
                        target=lambda: prefetch_queue.put(prefetch_next_batch(next_idx))
                    )
                    prefetch_thread.daemon = True
                    prefetch_thread.start()
                
                if batch_images:
                    # 배치 텐서 생성
                    batch_tensor = torch.stack(batch_images).to(self.device)
                    
                    # 배치 추론
                    with torch.no_grad():
                        embeddings = self.model.encode_image(batch_tensor)
                        embeddings /= embeddings.norm(dim=-1, keepdim=True)
                        
                        # CPU로 이동하여 GPU 메모리 해제 (중요!)
                        embeddings_cpu = embeddings.cpu()
                    
                    # 결과 저장 (CPU 텐서로)
                    for i, path in enumerate(valid_paths):
                        results.append((path, embeddings_cpu[i:i+1]))
                    
                    # GPU 메모리 정리
                    del batch_tensor, embeddings
                    
                    batch_count += 1
                    # 10배치마다 캐시 정리 (너무 자주 하면 오히려 느림)
                    if self.device == "cuda" and batch_count % 10 == 0:
                        torch.cuda.empty_cache()
                
                # 진행 상황 콜백
                if progress_callback:
                    progress_callback(idx + len(batch_paths), len(image_paths), self.current_batch_size)
                
                idx += len(batch_paths)
                
                # 첫 배치 완료 후 로그
                if batch_count == 1:
                    print(f"[배치 #{batch_count}] {len(valid_paths)}개 처리 완료", flush=True)
                
            except RuntimeError as e:
                if "out of memory" in str(e).lower():
                    # OOM 발생 - 배치 사이즈 줄이기
                    if self.device == "cuda":
                        torch.cuda.empty_cache()
                    
                    old_size = self.current_batch_size
                    self.current_batch_size = max(4, self.current_batch_size // 2)
                    print(f"[OOM] 배치 사이즈 감소: {old_size} → {self.current_batch_size}", flush=True)
                    
                    if self.current_batch_size < 4:
                        # 더 이상 줄일 수 없으면 하나씩 처리
                        for path in batch_paths:
                            try:
                                emb = self.get_image_embedding(path)
                                results.append((path, emb))
                            except Exception as e2:
                                print(f"[에러] {path}: {e2}")
                                failed_paths.append(path)
                        idx += len(batch_paths)
                else:
                    raise e
        
        # 프리페칭 스레드 종료
        stop_prefetch.set()
        if prefetch_thread and prefetch_thread.is_alive():
            prefetch_thread.join(timeout=1.0)
        
        print(f"[배치 처리 완료] {len(results)}개 성공, {len(failed_paths)}개 실패, 총 {batch_count}개 배치", flush=True)
        
        # 최종 메모리 정리
        if self.device == "cuda":
            torch.cuda.empty_cache()
        
        return results, failed_paths
    
    def analyze_single(self, reference_image_path, image_files, progress_callback=None):
        """
        단일 기준 이미지로 분석을 수행합니다.
        
        Args:
            reference_image_path: 기준 이미지 경로
            image_files: 비교할 이미지 파일 경로 리스트
            progress_callback: 진행 상황 콜백 함수
            
        Returns:
            dict: 분석 결과 (similarities, stats, failed_count)
        """
        # 기준 이미지 임베딩 계산
        embedding_ref = self.get_image_embedding(reference_image_path)
        
        print(f"[단일 분석] {len(image_files)}개 이미지, 배치 사이즈: {self.current_batch_size}", flush=True)
        
        # 배치 처리로 모든 이미지 임베딩 계산
        embeddings_result, failed = self.get_batch_embeddings(image_files, progress_callback)
        
        # 유사도 계산
        similarities = []
        for path, embedding in embeddings_result:
            similarity = self.calculate_similarity(embedding_ref, embedding)
            similarities.append({
                'filename': os.path.basename(path),
                'path': path,
                'similarity': round(similarity * 100, 2)
            })
        
        # 유사도 기준 정렬
        similarities.sort(key=lambda x: x['similarity'], reverse=True)
        
        # 통계 계산
        if similarities:
            sim_values = [s['similarity'] for s in similarities]
            stats = {
                'mean': round(np.mean(sim_values), 2),
                'std': round(np.std(sim_values), 2),
                'min': round(np.min(sim_values), 2),
                'max': round(np.max(sim_values), 2),
                'count': len(sim_values)
            }
        else:
            stats = {'mean': 0, 'std': 0, 'min': 0, 'max': 0, 'count': 0}
        
        print(f"[분석 완료] {len(similarities)}개 처리, {len(failed)}개 실패, 최종 배치: {self.current_batch_size}", flush=True)
        
        return {
            'similarities': similarities,
            'stats': stats,
            'failed_count': len(failed)
        }
    
    def analyze_multi(self, reference_images, image_files, progress_callback=None):
        """
        다중 기준 이미지로 분석을 수행합니다.
        
        Args:
            reference_images: 기준 이미지 리스트 [{'path': str, 'name': str, 'targetFolder': str}, ...]
            image_files: 비교할 이미지 파일 경로 리스트
            progress_callback: 진행 상황 콜백 함수 (current, total, phase, batch_size)
            
        Returns:
            dict: 분석 결과
        """
        num_refs = len(reference_images)
        
        # 1. 기준 이미지들의 임베딩 계산
        print(f"[다중 분석] {num_refs}개 기준 이미지 임베딩 계산 중...", flush=True)
        ref_embeddings = []
        for idx, ref in enumerate(reference_images):
            print(f"[기준 이미지 {idx+1}/{num_refs}] 경로: {ref['path']}", flush=True)
            try:
                embedding = self.get_image_embedding(ref['path'])
                ref_embeddings.append({
                    'name': ref['name'],
                    'targetFolder': ref['targetFolder'],
                    'embedding': embedding
                })
                print(f"[기준 이미지 {idx+1}/{num_refs}] 임베딩 계산 완료", flush=True)
            except Exception as e:
                print(f"[에러] 기준 이미지 {ref['name']}: {e}", flush=True)
                import traceback
                traceback.print_exc()
                ref_embeddings.append(None)
            
            if progress_callback:
                progress_callback(idx + 1, num_refs + len(image_files), 'reference', self.current_batch_size)
        
        # 유효한 기준 이미지만 필터링
        valid_refs = [(i, r) for i, r in enumerate(ref_embeddings) if r is not None]
        if not valid_refs:
            raise Exception("유효한 기준 이미지가 없습니다.")
        
        # 2. 비교 이미지들의 임베딩 배치 계산
        print(f"[다중 분석] {len(image_files)}개 비교 이미지 배치 처리 중... (배치: {self.current_batch_size})", flush=True)
        
        def batch_progress(current, total, batch_size):
            if progress_callback:
                progress_callback(num_refs + current, num_refs + total, 'comparison', batch_size)
        
        embeddings_result, failed = self.get_batch_embeddings(image_files, batch_progress)
        
        print(f"[다중 분석] 임베딩 계산 완료: {len(embeddings_result)}개 성공, {len(failed)}개 실패", flush=True)
        
        # 각 기준 이미지별 결과
        results_by_ref = {ref['name']: [] for _, ref in valid_refs}
        all_results = []  # 전체 결과 (각 이미지별 최고 유사도)
        
        # 유사도 계산 (임베딩이 이미 있으므로 빠름)
        for img_path, embedding in embeddings_result:
            # 모든 기준 이미지와의 유사도 계산
            similarities_to_refs = []
            for ref_idx, ref in valid_refs:
                sim = self.calculate_similarity(ref['embedding'], embedding)
                sim_percent = round(sim * 100, 2)
                similarities_to_refs.append({
                    'refIndex': ref_idx,
                    'refName': ref['name'],
                    'targetFolder': ref['targetFolder'],
                    'similarity': sim_percent
                })
            
            # 최고 유사도 찾기
            best_match = max(similarities_to_refs, key=lambda x: x['similarity'])
            
            image_result = {
                'filename': os.path.basename(img_path),
                'path': img_path,
                'bestMatch': best_match,
                'allSimilarities': similarities_to_refs
            }
            all_results.append(image_result)
            
            # 각 기준 이미지별로 결과 저장
            for sim_info in similarities_to_refs:
                results_by_ref[sim_info['refName']].append({
                    'filename': os.path.basename(img_path),
                    'path': img_path,
                    'similarity': sim_info['similarity']
                })
        
        # 3. 결과 정리
        # 각 기준 이미지별 결과 정렬
        for ref_name in results_by_ref:
            results_by_ref[ref_name].sort(key=lambda x: x['similarity'], reverse=True)
        
        # 전체 결과는 best match 유사도 기준 정렬
        all_results.sort(key=lambda x: x['bestMatch']['similarity'], reverse=True)
        
        # 각 기준 이미지별 통계
        stats_by_ref = {}
        for ref_name, items in results_by_ref.items():
            if items:
                sim_values = [s['similarity'] for s in items]
                stats_by_ref[ref_name] = {
                    'mean': round(np.mean(sim_values), 2),
                    'std': round(np.std(sim_values), 2),
                    'min': round(np.min(sim_values), 2),
                    'max': round(np.max(sim_values), 2),
                    'count': len(sim_values)
                }
            else:
                stats_by_ref[ref_name] = {'mean': 0, 'std': 0, 'min': 0, 'max': 0, 'count': 0}
        
        # 임계치별 카운트 계산 (각 기준 이미지별)
        threshold_counts_by_ref = {}
        for ref_name, items in results_by_ref.items():
            threshold_counts_by_ref[ref_name] = {}
            for thresh in range(0, 101):
                count = sum(1 for s in items if s['similarity'] >= thresh)
                threshold_counts_by_ref[ref_name][thresh] = count
        
        # best match 기준 임계치별 카운트 (분류 모드용)
        best_match_threshold_counts = {}
        for thresh in range(0, 101):
            count = sum(1 for r in all_results if r['bestMatch']['similarity'] >= thresh)
            best_match_threshold_counts[thresh] = count
        
        print(f"[다중 분석 완료] {len(all_results)}개 이미지, {len(valid_refs)}개 기준 이미지, 배치: {self.current_batch_size}", flush=True)
        
        return {
            'allResults': all_results,  # 전체 결과 (제한 없음)
            'totalCount': len(all_results),
            'resultsByRef': results_by_ref,  # 전체 결과 (제한 없음)
            'statsByRef': stats_by_ref,
            'thresholdCountsByRef': threshold_counts_by_ref,
            'bestMatchThresholdCounts': best_match_threshold_counts,
            'referenceImages': [
                {'name': ref['name'], 'targetFolder': ref['targetFolder']} 
                for _, ref in valid_refs
            ],
            'failed_count': len(failed),
            'final_batch_size': self.current_batch_size
        }
    
    @staticmethod
    def is_image_file(filename):
        """이미지 파일인지 확인합니다."""
        valid_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}
        return Path(filename).suffix.lower() in valid_extensions
    
    @staticmethod
    def get_image_files(folder_path):
        """폴더 내 이미지 파일 경로를 반환합니다 (하위 폴더 제외)."""
        folder = Path(folder_path)
        if not folder.exists():
            return []
        
        image_files = []
        for f in folder.iterdir():  # 해당 폴더만 (하위 폴더 제외)
            if f.is_file() and CLIPClassifier.is_image_file(f.name):
                image_files.append(str(f))
        return sorted(image_files)
