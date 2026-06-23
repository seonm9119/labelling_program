import json
import mimetypes
import urllib.request
import uuid

from config import VLM_KEYVALUE_API_TIMEOUT, VLM_KEYVALUE_API_URL


def extract_keyvalue_result(image_filename, image_bytes, include_raw=False):
    qwen_response = request_qwen_vlm_keyvalue(image_filename, image_bytes, include_raw)
    key_items = normalize_qwen_keys(qwen_response.get('keys'))

    keyvalue_response = {'keys': key_items}
    if include_raw:
        keyvalue_response['raw'] = qwen_response.get('raw')

    return keyvalue_response


def request_qwen_vlm_keyvalue(image_filename, image_bytes, include_raw=False):
    boundary = f'labeling-keyvalue-{uuid.uuid4().hex}'
    body = build_multipart_body(boundary, [
        {
            'name': 'include_raw',
            'value': 'true' if include_raw else 'false'
        },
        {
            'name': 'image',
            'filename': image_filename,
            'content_type': read_image_content_type(image_filename),
            'value': image_bytes
        }
    ])
    request = urllib.request.Request(
        VLM_KEYVALUE_API_URL,
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
        method='POST'
    )

    with urllib.request.urlopen(request, timeout=VLM_KEYVALUE_API_TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))


def normalize_qwen_keys(raw_keys):
    if not isinstance(raw_keys, list):
        return []

    key_items = []
    seen_keys = set()
    for raw_key in raw_keys:
        key_text = read_key_text(raw_key)
        if not key_text:
            continue

        normalized_key = normalize_key_text(key_text)
        if not normalized_key or normalized_key in seen_keys:
            continue

        key_items.append(key_text)
        seen_keys.add(normalized_key)

    return key_items


def read_key_text(raw_key):
    if isinstance(raw_key, dict):
        return clean_text(raw_key.get('key') or raw_key.get('label') or raw_key.get('name'))
    return clean_text(raw_key)


def normalize_key_text(value):
    return ''.join(character for character in clean_text(value).lower() if character.isalnum())


def clean_text(value):
    return ' '.join(str(value or '').split()).strip()


def build_multipart_body(boundary, parts):
    body = bytearray()
    for part in parts:
        body.extend(f'--{boundary}\r\n'.encode('utf-8'))
        body.extend(build_part_header(part))
        body.extend(b'\r\n')

        part_value = part.get('value', b'')
        if isinstance(part_value, bytes):
            body.extend(part_value)
        else:
            body.extend(str(part_value).encode('utf-8'))

        body.extend(b'\r\n')

    body.extend(f'--{boundary}--\r\n'.encode('utf-8'))
    return bytes(body)


def build_part_header(part):
    disposition = f'Content-Disposition: form-data; name="{part.get("name")}"'
    if part.get('filename'):
        disposition = f'{disposition}; filename="{part.get("filename")}"'

    headers = [disposition]
    if part.get('content_type'):
        headers.append(f'Content-Type: {part.get("content_type")}')

    return ('\r\n'.join(headers) + '\r\n').encode('utf-8')


def read_image_content_type(image_filename):
    content_type = mimetypes.guess_type(image_filename)[0]
    return content_type or 'application/octet-stream'


def read_http_error(error, api_name):
    try:
        error_payload = json.loads(error.read().decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return f'{api_name} 오류: HTTP {error.code}'

    if isinstance(error_payload, dict):
        detail = error_payload.get('detail') or error_payload.get('error')
        if detail:
            return str(detail)

    return f'{api_name} 오류: HTTP {error.code}'
