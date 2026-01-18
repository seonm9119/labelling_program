#!/usr/bin/env python3
"""
이미지를 20개씩 나눠서 서브폴더에 정리하는 스크립트
사용법: python split_images.py <소스폴더경로>
"""

import os
import shutil
import sys
import re
from pathlib import Path

# 설정
IMAGES_PER_FOLDER = 10  # 폴더당 이미지 개수
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}


def natural_sort_key(text):
    """
    자연 정렬을 위한 키 함수 (숫자를 올바르게 정렬)
    예: 'img_1.png', 'img_2.png', 'img_10.png' 순서로 정렬
    """
    def convert(text):
        return int(text) if text.isdigit() else text.lower()
    
    return [convert(c) for c in re.split(r'(\d+)', str(text))]


def split_images(source_folder: str):
    source_path = Path(source_folder)
    
    if not source_path.exists():
        print(f"오류: '{source_folder}' 폴더가 존재하지 않습니다.")
        return
    
    # 이미지 파일만 필터링 및 정렬 (숫자 순서대로)
    image_files = sorted([
        f for f in source_path.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    ], key=natural_sort_key)
    
    total_images = len(image_files)
    if total_images == 0:
        print("이미지 파일이 없습니다.")
        return
    
    print(f"총 {total_images}개의 이미지 발견")
    
    # 폴더 개수 계산
    num_folders = (total_images + IMAGES_PER_FOLDER - 1) // IMAGES_PER_FOLDER
    print(f"{num_folders}개의 폴더로 분류합니다 (폴더당 {IMAGES_PER_FOLDER}개)")
    
    # 이미지를 20개씩 나눠서 이동
    for folder_num in range(1, num_folders + 1):
        # 서브폴더 생성
        sub_folder = source_path / str(folder_num)
        sub_folder.mkdir(exist_ok=True)
        
        # 해당 폴더에 들어갈 이미지 범위 계산
        start_idx = (folder_num - 1) * IMAGES_PER_FOLDER
        end_idx = min(folder_num * IMAGES_PER_FOLDER, total_images)
        
        # 이미지 이동
        for img_file in image_files[start_idx:end_idx]:
            dest_path = sub_folder / img_file.name
            shutil.move(str(img_file), str(dest_path))
        
        moved_count = end_idx - start_idx
        print(f"폴더 {folder_num}: {moved_count}개 이미지 이동 완료")
    
    print(f"\n완료! {total_images}개 이미지를 {num_folders}개 폴더로 분류했습니다.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python split_images.py <소스폴더경로>")
        print("예시: python split_images.py /path/to/images")
        sys.exit(1)
    
    source_folder = sys.argv[1]
    split_images(source_folder)
