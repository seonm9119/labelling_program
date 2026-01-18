"""
PaddleOCR 텍스트 추출기 모델
PaddleOCR 3.x를 사용한 이미지 텍스트 인식 및 추출
"""

import os
import torch
from PIL import Image
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
import threading


class OCRExtractor:
    """PaddleOCR 3.x 기반 텍스트 추출기"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls, *args, **kwargs):
        """싱글톤 패턴 - 인스턴스가 하나만 생성되도록 합니다."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self, lang: str = 'korean', use_gpu: bool = True):
        """
        PaddleOCR 모델을 초기화합니다.
        
        Args:
            lang: 인식할 언어 (기본값: korean)
            use_gpu: GPU 사용 여부 (기본값: True)
        """
        # 이미 초기화되었으면 스킵
        if hasattr(self, '_initialized') and self._initialized:
            return
        
        self.lang = lang
        self.use_gpu = use_gpu and torch.cuda.is_available()
        self.device = "cuda" if self.use_gpu else "cpu"
        
        print(f"[OCR] PaddleOCR 3.x 초기화 중...")
        print(f"[OCR] 디바이스: {self.device}")
        
        # PaddleOCR 3.x 로드
        from paddleocr import PaddleOCR
        self.ocr = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False
        )
        
        # 시스템 정보 수집
        self.system_info = self._get_system_info()
        
        self._initialized = True
        print(f"[OCR] 초기화 완료")
        print(f"[시스템] GPU: {self.system_info.get('gpu_name', 'N/A')}")
    
    def _get_system_info(self) -> Dict[str, Any]:
        """시스템 정보를 수집합니다."""
        info = {
            'device': self.device.upper(),
            'gpu_name': None,
            'gpu_memory': None,
            'lang': self.lang
        }
        
        if torch.cuda.is_available():
            info['gpu_name'] = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            info['gpu_memory'] = f"{props.total_memory / (1024**3):.0f}GB"
        
        return info
    
    def extract_text(self, image_path: str) -> Tuple[str, List[Dict[str, Any]]]:
        """
        이미지에서 텍스트를 추출합니다.
        
        Args:
            image_path: 이미지 파일 경로
            
        Returns:
            Tuple[str, List[Dict]]: (추출된 전체 텍스트, 박스별 상세 정보)
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"이미지 파일을 찾을 수 없습니다: {image_path}")
        
        # PaddleOCR 3.x - predict() 사용
        result = self.ocr.predict(image_path)
        
        text_lines = []
        boxes = []
        
        # PaddleOCR 3.x 결과 처리 (딕셔너리 형태로 접근)
        for res in result:
            # PaddleOCR 3.x는 딕셔너리처럼 접근해야 함
            rec_texts = res.get('rec_texts', []) if hasattr(res, 'get') else getattr(res, 'rec_texts', [])
            rec_scores = res.get('rec_scores', []) if hasattr(res, 'get') else getattr(res, 'rec_scores', [])
            rec_boxes = res.get('rec_boxes', []) if hasattr(res, 'get') else getattr(res, 'rec_boxes', [])
            
            if rec_texts:
                for idx, text in enumerate(rec_texts):
                    if text and text.strip():
                        text_lines.append(text)
                        confidence = float(rec_scores[idx]) if idx < len(rec_scores) else 1.0
                        
                        box_data = {
                            'text': text,
                            'confidence': confidence,
                            'box': None,
                            'bbox': None
                        }
                        
                        # 박스 좌표가 있으면 추가
                        if rec_boxes is not None and idx < len(rec_boxes):
                            box = rec_boxes[idx]
                            if hasattr(box, 'tolist'):
                                box = box.tolist()
                            box_data['bbox'] = box
                        
                        boxes.append(box_data)
        
        full_text = '\n'.join(text_lines)
        return full_text, boxes
    
    def extract_text_with_stats(self, image_path: str) -> Dict[str, Any]:
        """
        이미지에서 텍스트를 추출하고 통계 정보를 포함하여 반환합니다.
        
        Args:
            image_path: 이미지 파일 경로
            
        Returns:
            Dict: 추출 결과 및 통계 정보
        """
        text, boxes = self.extract_text(image_path)
        
        # 통계 계산
        char_count = len(text.replace('\n', '').replace(' ', ''))
        word_count = len(text.split())
        line_count = len([l for l in text.split('\n') if l.strip()])
        avg_confidence = 0.0
        if boxes:
            avg_confidence = sum(b['confidence'] for b in boxes) / len(boxes)
        
        return {
            'text': text,
            'boxes': boxes,
            'stats': {
                'charCount': char_count,
                'wordCount': word_count,
                'lineCount': line_count,
                'boxCount': len(boxes),
                'avgConfidence': round(avg_confidence, 4)
            }
        }
    
    def batch_extract(
        self, 
        image_paths: List[str], 
        progress_callback: Optional[callable] = None
    ) -> List[Dict[str, Any]]:
        """
        여러 이미지에서 텍스트를 일괄 추출합니다.
        
        Args:
            image_paths: 이미지 파일 경로 목록
            progress_callback: 진행 상황 콜백 함수 (current, total)
            
        Returns:
            List[Dict]: 각 이미지의 추출 결과
        """
        results = []
        total = len(image_paths)
        
        for idx, image_path in enumerate(image_paths):
            try:
                result = self.extract_text_with_stats(image_path)
                result['filename'] = os.path.basename(image_path)
                result['success'] = True
                results.append(result)
            except Exception as e:
                results.append({
                    'filename': os.path.basename(image_path),
                    'success': False,
                    'error': str(e)
                })
            
            if progress_callback:
                progress_callback(idx + 1, total)
        
        return results
    
    @staticmethod
    def get_image_files(folder_path: str) -> List[str]:
        """
        폴더에서 이미지 파일 목록을 가져옵니다.
        
        Args:
            folder_path: 폴더 경로
            
        Returns:
            List[str]: 이미지 파일 경로 목록
        """
        image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}
        folder = Path(folder_path)
        
        if not folder.exists():
            raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder_path}")
        
        image_files = []
        for file in folder.iterdir():
            if file.is_file() and file.suffix.lower() in image_extensions:
                image_files.append(str(file))
        
        return sorted(image_files)
