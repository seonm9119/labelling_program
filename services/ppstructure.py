import base64
import json
import urllib.request
from config import (
    PP_STRUCTURE_API_TIMEOUT,
    PP_STRUCTURE_API_URL,
    PP_STRUCTURE_FORMAT_BLOCK_CONTENT,
    PP_STRUCTURE_USE_CHART_RECOGNITION,
    PP_STRUCTURE_USE_DOC_ORIENTATION_CLASSIFY,
    PP_STRUCTURE_USE_DOC_UNWARPING,
    PP_STRUCTURE_USE_FORMULA_RECOGNITION,
    PP_STRUCTURE_USE_REGION_DETECTION,
    PP_STRUCTURE_USE_SEAL_RECOGNITION,
    PP_STRUCTURE_USE_TABLE_RECOGNITION,
    PP_STRUCTURE_USE_TEXTLINE_ORIENTATION,
)


PP_STRUCTURE_MODEL = 'pp-structurev3'


def request_pp_structurev3(image_bytes, release_after_inference=True):
    byte_img = base64.b64encode(image_bytes).decode('utf-8')
    payload = json.dumps({
        'byte_img': byte_img,
        'release_after_inference': release_after_inference,
        'predict_options': {
            'use_doc_orientation_classify': PP_STRUCTURE_USE_DOC_ORIENTATION_CLASSIFY,
            'use_doc_unwarping': PP_STRUCTURE_USE_DOC_UNWARPING,
            'use_textline_orientation': PP_STRUCTURE_USE_TEXTLINE_ORIENTATION,
            'use_seal_recognition': PP_STRUCTURE_USE_SEAL_RECOGNITION,
            'use_table_recognition': PP_STRUCTURE_USE_TABLE_RECOGNITION,
            'use_formula_recognition': PP_STRUCTURE_USE_FORMULA_RECOGNITION,
            'use_chart_recognition': PP_STRUCTURE_USE_CHART_RECOGNITION,
            'use_region_detection': PP_STRUCTURE_USE_REGION_DETECTION,
            'format_block_content': PP_STRUCTURE_FORMAT_BLOCK_CONTENT,
        }
    }).encode('utf-8')

    request = urllib.request.Request(
        PP_STRUCTURE_API_URL,
        data=payload,
        headers={'Content-Type': 'application/json'}
    )

    with urllib.request.urlopen(request, timeout=PP_STRUCTURE_API_TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))


def build_pp_structurev3_layout_boxes(layout_response):
    layout_boxes = []

    for result_payload in layout_response.get('results', []):
        result_json = result_payload.get('json', {}) if isinstance(result_payload, dict) else {}
        result_body = result_json.get('res', {}) if isinstance(result_json, dict) else {}
        parsing_blocks = result_body.get('parsing_res_list', [])

        if parsing_blocks:
            add_pp_structurev3_parsing_boxes(layout_boxes, parsing_blocks)
            continue

        layout_detection_boxes = result_body.get('layout_det_res', {}).get('boxes', [])
        add_pp_structurev3_detection_boxes(layout_boxes, layout_detection_boxes)

    return layout_boxes


def add_pp_structurev3_parsing_boxes(layout_boxes, parsing_blocks):
    for parsing_block in parsing_blocks:
        block_bbox = parsing_block.get('block_bbox')
        block_label = parsing_block.get('block_label') or 'layout'

        layout_boxes.append({
            'id': f'pp-structurev3-{len(layout_boxes) + 1}',
            'type': normalize_layout_type(block_label),
            'label': block_label,
            'text': read_pp_structurev3_block_text(parsing_block),
            'confidence': parsing_block.get('score', 1.0),
            'bbox': block_bbox,
        })


def add_pp_structurev3_detection_boxes(layout_boxes, layout_detection_boxes):
    for detection_box in layout_detection_boxes:
        box_label = detection_box.get('label') or 'layout'

        layout_boxes.append({
            'id': f'pp-structurev3-{len(layout_boxes) + 1}',
            'type': normalize_layout_type(box_label),
            'label': box_label,
            'text': box_label,
            'confidence': detection_box.get('score', 1.0),
            'bbox': detection_box.get('coordinate') or detection_box.get('bbox'),
        })


def read_pp_structurev3_block_text(parsing_block):
    block_content = parsing_block.get('block_content')
    if block_content is None:
        return parsing_block.get('block_label', '')

    if isinstance(block_content, (dict, list)):
        return json.dumps(block_content, ensure_ascii=False)

    return str(block_content)


def normalize_layout_type(label):
    normalized_label = str(label or 'layout').strip().lower().replace(' ', '_').replace('-', '_')
    type_map = {
        'caption': 'caption',
        'doc_title': 'title',
        'figure': 'image',
        'figure_caption': 'caption',
        'footer': 'footer',
        'formula': 'formula',
        'header': 'header',
        'image': 'image',
        'list_item': 'list',
        'paragraph': 'text',
        'plain_text': 'text',
        'section_header': 'title',
        'table': 'table',
        'table_caption': 'caption',
        'text': 'text',
        'title': 'title',
    }

    return type_map.get(normalized_label, normalized_label or 'layout')
