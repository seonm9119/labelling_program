import os
from pathlib import Path


SUPPORTED_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp')


def list_image_paths(folder_path, recursive=False, image_extensions=SUPPORTED_IMAGE_EXTENSIONS, require_exists=False):
    folder = Path(folder_path)
    if not folder.exists():
        if require_exists:
            raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder_path}")
        return []

    folder_entries = folder.rglob('*') if recursive else folder.iterdir()
    image_paths = [
        str(folder_entry)
        for folder_entry in folder_entries
        if folder_entry.is_file() and folder_entry.suffix.lower() in image_extensions
    ]
    return sorted(image_paths)


def list_child_folders(folder_path):
    child_folders = []
    with os.scandir(folder_path) as folder_entries:
        for folder_entry in folder_entries:
            if folder_entry.is_dir():
                child_folders.append({
                    'name': folder_entry.name,
                    'path': folder_entry.path
                })

    return sorted(child_folders, key=lambda child_folder: child_folder['name'].lower())
