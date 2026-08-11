import base64
import json
import urllib.error
import urllib.request

from config import (
    GPT_KEYVALUE_API_TIMEOUT,
    GPT_KEYVALUE_API_URL,
    GPT_KEYVALUE_OPENAI_API_URL,
    GPT_KEYVALUE_OPENAI_MODEL,
    OPENAI_API_KEY_FILE,
    OPENAI_API_KEY_SECTION
)
from services.utils.keyvalue import normalize_keyvalue_keys, normalize_keyvalue_pairs, read_image_content_type, request_keyvalue_model


GPT_KEYVALUE_MODEL = 'gpt'
GPT_KEYVALUE_PROMPT = '''
Analyze the document image and extract only the field names, labels, and key names that should be used for key-value annotation.
Also extract each visible user-filled value that belongs to the label.
If a label has no visible value, use an empty string.
Return concise JSON that matches the schema.
Keep Korean labels in Korean and preserve the wording seen in the image.
'''.strip()
GPT_KEYVALUE_RESPONSE_SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'properties': {
        'pairs': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'properties': {
                    'key': {
                        'type': 'string'
                    },
                    'value': {
                        'type': 'string'
                    }
                },
                'required': ['key', 'value']
            }
        }
    },
    'required': ['pairs']
}


def extract_gpt_keyvalue_result(image_filename, image_bytes, include_raw=False):
    gpt_response = request_gpt_keyvalue(image_filename, image_bytes, include_raw)
    pair_items = normalize_keyvalue_pairs(gpt_response.get('pairs'), gpt_response.get('keys'))
    key_items = normalize_keyvalue_keys([pair.get('key') for pair in pair_items])

    keyvalue_response = {
        'model': gpt_response.get('model') or 'GPT',
        'pairs': pair_items,
        'keys': key_items
    }
    if include_raw:
        keyvalue_response['raw'] = gpt_response.get('raw')

    return keyvalue_response


def request_gpt_keyvalue(image_filename, image_bytes, include_raw=False):
    if GPT_KEYVALUE_API_URL:
        return request_keyvalue_model(GPT_KEYVALUE_API_URL, GPT_KEYVALUE_API_TIMEOUT, image_filename, image_bytes, include_raw)

    return request_openai_gpt_keyvalue(image_filename, image_bytes, include_raw)


def request_openai_gpt_keyvalue(image_filename, image_bytes, include_raw=False):
    openai_api_key = get_openai_api_key()
    if not openai_api_key:
        raise urllib.error.URLError('OpenAI API key is not configured.')
    if not GPT_KEYVALUE_OPENAI_API_URL:
        raise urllib.error.URLError('OpenAI Key-Value API URL is not configured.')
    if not GPT_KEYVALUE_OPENAI_MODEL:
        raise urllib.error.URLError('OpenAI Key-Value model is not configured.')

    image_data_url = build_image_data_url(image_filename, image_bytes)
    payload = {
        'model': GPT_KEYVALUE_OPENAI_MODEL,
        'input': [
            {
                'role': 'system',
                'content': GPT_KEYVALUE_PROMPT
            },
            {
                'role': 'user',
                'content': [
                    {
                        'type': 'input_text',
                        'text': 'Extract key-value pairs from this document image.'
                    },
                    {
                        'type': 'input_image',
                        'image_url': image_data_url
                    }
                ]
            }
        ],
        'text': {
            'format': {
                'type': 'json_schema',
                'name': 'keyvalue_keys',
                'strict': True,
                'schema': GPT_KEYVALUE_RESPONSE_SCHEMA
            }
        }
    }
    request = urllib.request.Request(
        GPT_KEYVALUE_OPENAI_API_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {openai_api_key}',
            'Content-Type': 'application/json'
        },
        method='POST'
    )

    with urllib.request.urlopen(request, timeout=GPT_KEYVALUE_API_TIMEOUT) as response:
        openai_response = json.loads(response.read().decode('utf-8'))

    parsed_response = parse_openai_keyvalue_response(openai_response)
    keyvalue_response = {
        'model': GPT_KEYVALUE_OPENAI_MODEL,
        'pairs': parsed_response.get('pairs', []),
        'keys': parsed_response.get('keys', [])
    }
    if include_raw:
        keyvalue_response['raw'] = openai_response

    return keyvalue_response


def build_image_data_url(image_filename, image_bytes):
    image_content_type = read_image_content_type(image_filename)
    image_base64 = base64.b64encode(image_bytes).decode('ascii')
    return f'data:{image_content_type};base64,{image_base64}'


def parse_openai_keyvalue_response(openai_response):
    output_text = extract_openai_output_text(openai_response)
    if not output_text:
        raise urllib.error.URLError('OpenAI 응답이 비어 있습니다.')

    try:
        parsed_response = json.loads(output_text)
    except json.JSONDecodeError as error:
        raise urllib.error.URLError(f'OpenAI JSON 파싱 실패: {error}') from error

    if not isinstance(parsed_response, dict):
        raise urllib.error.URLError('OpenAI 응답 형식이 올바르지 않습니다.')

    return parsed_response


def extract_openai_output_text(openai_response):
    direct_output_text = str(openai_response.get('output_text') or '').strip()
    if direct_output_text:
        return direct_output_text

    output_items = openai_response.get('output')
    if not isinstance(output_items, list):
        return ''

    text_parts = []
    for output_item in output_items:
        content_items = output_item.get('content') if isinstance(output_item, dict) else None
        if not isinstance(content_items, list):
            continue

        for content_item in content_items:
            if not isinstance(content_item, dict):
                continue

            content_text = content_item.get('text') or content_item.get('output_text')
            if content_text:
                text_parts.append(str(content_text))

    return '\n'.join(text_parts).strip()


def get_openai_api_key():
    openai_api_key = read_openai_api_key_from_env()
    if openai_api_key:
        return openai_api_key

    if not OPENAI_API_KEY_FILE:
        return ''

    with open(OPENAI_API_KEY_FILE, 'r', encoding='utf-8') as key_file:
        key_file_content = key_file.read()

    if OPENAI_API_KEY_SECTION:
        return read_private_file_section(key_file_content, OPENAI_API_KEY_SECTION)

    return key_file_content.strip()


def read_openai_api_key_from_env():
    import os

    return os.environ.get('OPENAI_API_KEY', '').strip()


def read_private_file_section(private_file_content, section_name):
    normalized_section_name = str(section_name or '').strip()
    section_lines = []
    is_section_active = False

    for private_file_line in private_file_content.splitlines():
        stripped_line = private_file_line.strip()

        if stripped_line.startswith('[') and stripped_line.endswith(']'):
            current_section_name = stripped_line[1:-1].strip()
            is_section_active = current_section_name == normalized_section_name
            continue

        if is_section_active:
            section_lines.append(private_file_line)

    return '\n'.join(section_lines).strip()
