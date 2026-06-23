import json
import tempfile
from contextlib import contextmanager
from pathlib import Path


def get_ocr_result_path(output_folder_path, image_filename, image_index):
    if not output_folder_path:
        return None

    result_filename = make_ocr_result_filename(image_filename, image_index)
    return Path(output_folder_path) / result_filename


def make_ocr_result_filename(image_filename, image_index):
    image_stem = str(Path(str(image_filename).replace('\\', '/')).with_suffix(''))
    safe_stem = make_safe_filename_part(image_stem)
    safe_stem = safe_stem.strip('._') or 'image'
    return f'{int(image_index):05d}_{safe_stem}.json'


def make_safe_ocr_image_filename(image_filename):
    return make_safe_filename_part(image_filename) or 'image'


def make_safe_filename_part(filename_text):
    return ''.join(character if character.isalnum() or character in '._-' else '_' for character in str(filename_text))


def save_raw_ocr_response(result_path, raw_ocr_response):
    result_path = Path(result_path)
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(raw_ocr_response, ensure_ascii=False, indent=2), encoding='utf-8')
    return str(result_path)


def read_raw_ocr_response(result_path):
    raw_response_text = Path(result_path).read_text(encoding='utf-8')
    if not raw_response_text:
        return {}

    return json.loads(raw_response_text)


@contextmanager
def saved_temporary_raw_ocr_response(workspace_path, folder_prefix, raw_ocr_response):
    Path(workspace_path).mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=folder_prefix, dir=workspace_path) as temporary_folder:
        result_path = Path(temporary_folder) / 'raw_response.json'
        save_raw_ocr_response(result_path, raw_ocr_response)
        yield result_path
