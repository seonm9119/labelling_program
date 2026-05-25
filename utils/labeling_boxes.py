from io import BytesIO
from PIL import Image as PILImage


def read_image_size(image_bytes):
    with PILImage.open(BytesIO(image_bytes)) as image:
        return image.size


def normalize_labeling_bbox(raw_bbox):
    if not raw_bbox:
        return None

    if len(raw_bbox) == 4 and all(isinstance(point, (int, float)) for point in raw_bbox):
        x1, y1, x2, y2 = raw_bbox
        return [float(x1), float(y1), float(x2), float(y2)]

    if len(raw_bbox) >= 4 and all(isinstance(point, (list, tuple)) and len(point) >= 2 for point in raw_bbox):
        x_points = [float(point[0]) for point in raw_bbox]
        y_points = [float(point[1]) for point in raw_bbox]
        return [min(x_points), min(y_points), max(x_points), max(y_points)]

    return None


def build_labeling_boxes(source_boxes, image_width, image_height, box_id_prefix):
    labeling_boxes = []

    for box_index, source_box in enumerate(source_boxes):
        normalized_bbox = normalize_labeling_bbox(source_box.get('bbox'))
        if not normalized_bbox:
            continue

        x1, y1, x2, y2 = normalized_bbox
        x1 = max(0.0, min(float(image_width), x1))
        x2 = max(0.0, min(float(image_width), x2))
        y1 = max(0.0, min(float(image_height), y1))
        y2 = max(0.0, min(float(image_height), y2))

        if x2 <= x1 or y2 <= y1:
            continue

        labeling_box = {
            'id': source_box.get('id') or f'{box_id_prefix}-{box_index + 1}',
            'type': source_box.get('type') or source_box.get('kind') or 'text',
            'text': source_box.get('text') if source_box.get('text') is not None else source_box.get('label', ''),
            'confidence': source_box.get('confidence', 1.0),
            'bbox': [x1, y1, x2, y2]
        }

        if source_box.get('html'):
            labeling_box['html'] = source_box.get('html')

        labeling_boxes.append(labeling_box)

    return labeling_boxes
