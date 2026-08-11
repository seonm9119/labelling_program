import json
import mimetypes
import urllib.error
import urllib.request
import uuid


def request_keyvalue_model(api_url, api_timeout, image_filename, image_bytes, selected_model, include_raw=False):
    if not str(api_url or '').strip():
        raise urllib.error.URLError('Key-Value API URL is not configured.')

    boundary = f'labeling-keyvalue-{uuid.uuid4().hex}'
    body = build_multipart_body(boundary, [
        {
            'name': 'model',
            'value': selected_model
        },
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
