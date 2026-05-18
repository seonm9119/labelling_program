import json
import os
from pathlib import Path


IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif')
ANNOTATION_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp')


def expand_user_path(raw_path):
    """Expand ~ and trim form input paths."""
    return os.path.expanduser((raw_path or '').strip())


def ensure_folder(folder_path):
    os.makedirs(folder_path, exist_ok=True)


def is_image_file(filename, image_extensions=None):
    extensions = image_extensions or IMAGE_EXTENSIONS
    return Path(filename).suffix.lower() in extensions


def list_image_paths(folder_path, recursive=False, image_extensions=None, require_exists=False):
    folder = Path(folder_path)
    if not folder.exists():
        if require_exists:
            raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder_path}")
        return []

    extensions = image_extensions or IMAGE_EXTENSIONS
    folder_entries = folder.rglob('*') if recursive else folder.iterdir()
    image_paths = [
        str(folder_entry)
        for folder_entry in folder_entries
        if folder_entry.is_file() and folder_entry.suffix.lower() in extensions
    ]
    return sorted(image_paths)


def list_image_filenames(folder_path, image_extensions=None):
    image_paths = list_image_paths(folder_path, image_extensions=image_extensions)
    return [Path(image_path).name for image_path in image_paths]


def list_json_filenames(folder_path):
    folder = Path(folder_path)
    json_filenames = [
        folder_entry.name
        for folder_entry in folder.iterdir()
        if folder_entry.is_file() and folder_entry.suffix.lower() == '.json'
    ]
    return sorted(json_filenames)


def load_json_file(json_path):
    with open(json_path, 'r', encoding='utf-8') as json_file:
        return json.load(json_file)


def save_json_file(json_path, json_content, compact=False):
    with open(json_path, 'w', encoding='utf-8') as json_file:
        if compact:
            json.dump(json_content, json_file, separators=(',', ':'), ensure_ascii=False)
        else:
            json.dump(json_content, json_file, ensure_ascii=False, indent=2)
