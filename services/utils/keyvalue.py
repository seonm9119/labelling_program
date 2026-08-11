import json
import mimetypes
import urllib.error
import urllib.request
import uuid


def request_keyvalue_model(api_url, api_timeout, image_filename, image_bytes, include_raw=False):
    if not str(api_url or '').strip():
        raise urllib.error.URLError('Key-Value API URL is not configured.')

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
        api_url,
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
        method='POST'
    )

    with urllib.request.urlopen(request, timeout=api_timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def normalize_keyvalue_keys(raw_keys):
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


def normalize_keyvalue_pairs(raw_pairs, fallback_keys=None):
    pair_items = []
    seen_keys = set()

    if isinstance(raw_pairs, dict):
        raw_pairs = [{'key': key, 'value': value} for key, value in raw_pairs.items()]

    if isinstance(raw_pairs, list):
        for raw_pair in raw_pairs:
            key_text = read_key_text(raw_pair)
            if not key_text:
                continue

            normalized_key = normalize_key_text(key_text)
            if not normalized_key or normalized_key in seen_keys:
                continue

            pair_items.append({
                'key': key_text,
                'value': read_value_text(raw_pair)
            })
            seen_keys.add(normalized_key)

    for fallback_key in normalize_keyvalue_keys(fallback_keys):
        normalized_key = normalize_key_text(fallback_key)
        if not normalized_key or normalized_key in seen_keys:
            continue

        pair_items.append({
            'key': fallback_key,
            'value': ''
        })
        seen_keys.add(normalized_key)

    return pair_items


def read_key_text(raw_key):
    if isinstance(raw_key, dict):
        return clean_text(raw_key.get('key') or raw_key.get('label') or raw_key.get('name') or raw_key.get('field'))
    return clean_text(raw_key)


def read_value_text(raw_pair):
    if not isinstance(raw_pair, dict):
        return ''

    return clean_text(
        raw_pair.get('value')
        or raw_pair.get('text')
        or raw_pair.get('content')
        or raw_pair.get('answer')
        or ''
    )


def normalize_key_text(key_text):
    return ''.join(character for character in clean_text(key_text).lower() if character.isalnum())


def clean_text(raw_value):
    return ' '.join(str(raw_value or '').split()).strip()


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


def read_keyvalue_http_error(error, api_name):
    try:
        error_payload = json.loads(error.read().decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return f'{api_name} 오류: HTTP {error.code}'

    if isinstance(error_payload, dict):
        detail = error_payload.get('detail') or error_payload.get('error')
        if detail:
            return read_error_detail(detail)

    return f'{api_name} 오류: HTTP {error.code}'


def read_error_detail(error_detail):
    if isinstance(error_detail, dict):
        message = error_detail.get('message') or error_detail.get('detail') or error_detail.get('error')
        if message:
            return str(message)
        return json.dumps(error_detail, ensure_ascii=False)

    return str(error_detail)
