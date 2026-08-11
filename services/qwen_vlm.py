import base64
import json
import re
import urllib.error
import urllib.request

from config import OLLAMA_KEYVALUE_API_URL, OLLAMA_KEYVALUE_MODEL, VLM_KEYVALUE_API_TIMEOUT, VLM_KEYVALUE_API_URL
from services.utils.keyvalue import normalize_keyvalue_keys, normalize_keyvalue_pairs, request_keyvalue_model


QWEN_KEYVALUE_MODEL = 'qwen-vlm'
QWEN_KEYVALUE_PROMPT = '''
You are an expert document labeling assistant.
Read the document image like OCR and extract key-value pairs from forms and tables.
For each label, find the visible filled-in value next to it, below it, or in the same table row.
Every object must include both "key" and "value".
If a value is truly missing, set "value" to "".
Do not return label-only objects.
Return JSON only in this exact shape:
{"pairs":[{"key":"보험종목","value":"펫으로 보험"},{"key":"증권번호","value":"1964788130277"}]}
Keep Korean labels in Korean and preserve the wording seen in the image.
'''.strip()


def extract_qwen_keyvalue_result(image_filename, image_bytes, include_raw=False):
    qwen_response = request_qwen_vlm_keyvalue(image_filename, image_bytes, include_raw)
    pair_items = normalize_keyvalue_pairs(qwen_response.get('pairs'), qwen_response.get('keys'))
    key_items = normalize_keyvalue_keys([pair.get('key') for pair in pair_items])

    keyvalue_response = {
        'model': qwen_response.get('model') or 'Qwen2.5-VL',
        'pairs': pair_items,
        'keys': key_items
    }
    if include_raw:
        keyvalue_response['raw'] = qwen_response.get('raw')

    return keyvalue_response


def request_qwen_vlm_keyvalue(image_filename, image_bytes, include_raw=False):
    if VLM_KEYVALUE_API_URL:
        return request_keyvalue_model(VLM_KEYVALUE_API_URL, VLM_KEYVALUE_API_TIMEOUT, image_filename, image_bytes, include_raw)

    return request_ollama_qwen_vlm_keyvalue(image_bytes, include_raw)


def request_ollama_qwen_vlm_keyvalue(image_bytes, include_raw=False):
    if not OLLAMA_KEYVALUE_API_URL:
        raise urllib.error.URLError('Ollama Key-Value API URL is not configured.')
    if not OLLAMA_KEYVALUE_MODEL:
        raise urllib.error.URLError('Ollama Key-Value model is not configured.')

    payload = {
        'model': OLLAMA_KEYVALUE_MODEL,
        'prompt': QWEN_KEYVALUE_PROMPT,
        'images': [base64.b64encode(image_bytes).decode('ascii')],
        'stream': False,
        'format': 'json',
        'options': {
            'temperature': 0,
            'num_ctx': 8192
        }
    }
    request = urllib.request.Request(
        OLLAMA_KEYVALUE_API_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )

    try:
        with urllib.request.urlopen(request, timeout=VLM_KEYVALUE_API_TIMEOUT) as response:
            ollama_response = json.loads(response.read().decode('utf-8'))
    except json.JSONDecodeError as error:
        raise urllib.error.URLError(f'Ollama 응답 JSON 파싱 실패: {error}') from error

    qwen_payload = parse_ollama_qwen_response(ollama_response)
    keyvalue_response = {
        'model': OLLAMA_KEYVALUE_MODEL,
        'pairs': qwen_payload.get('pairs', []),
        'keys': qwen_payload.get('keys', [])
    }
    if include_raw:
        keyvalue_response['raw'] = ollama_response

    return keyvalue_response


def parse_ollama_qwen_response(ollama_response):
    response_text = str(ollama_response.get('response') or '').strip()
    if not response_text:
        raise urllib.error.URLError('Ollama Qwen 응답이 비어 있습니다.')

    try:
        parsed_response = json.loads(response_text)
    except json.JSONDecodeError:
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if not json_match:
            raise urllib.error.URLError('Ollama Qwen 응답에서 JSON을 찾을 수 없습니다.')
        try:
            parsed_response = json.loads(json_match.group(0))
        except json.JSONDecodeError as error:
            raise urllib.error.URLError(f'Ollama Qwen JSON 파싱 실패: {error}') from error

    if isinstance(parsed_response, list):
        return {'keys': parsed_response}
    if not isinstance(parsed_response, dict):
        raise urllib.error.URLError('Ollama Qwen 응답 형식이 올바르지 않습니다.')

    if 'pairs' not in parsed_response and 'keys' not in parsed_response:
        parsed_response['pairs'] = [
            {'key': key, 'value': value}
            for key, value in parsed_response.items()
        ]
    if 'keys' not in parsed_response:
        parsed_response['keys'] = [
            pair.get('key')
            for pair in normalize_keyvalue_pairs(parsed_response.get('pairs'))
        ]

    return parsed_response
