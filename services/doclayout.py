import base64
import json
import urllib.request
from config import (
    DOCLAYOUT_API_TIMEOUT,
    DOCLAYOUT_API_URL,
    DOCLAYOUT_CONFIDENCE,
    DOCLAYOUT_IMAGE_SIZE,
    DOCLAYOUT_IOU,
    DOCLAYOUT_MAX_DET,
)


def request_doclayout(image_bytes, release_after_inference=True):
    byte_img = base64.b64encode(image_bytes).decode('utf-8')
    payload = json.dumps({
        'byte_img': byte_img,
        'release_after_inference': release_after_inference,
        'predict_options': {
            'imgsz': DOCLAYOUT_IMAGE_SIZE,
            'conf': DOCLAYOUT_CONFIDENCE,
            'iou': DOCLAYOUT_IOU,
            'max_det': DOCLAYOUT_MAX_DET
        }
    }).encode('utf-8')

    request = urllib.request.Request(
        DOCLAYOUT_API_URL,
        data=payload,
        headers={'Content-Type': 'application/json'}
    )

    with urllib.request.urlopen(request, timeout=DOCLAYOUT_API_TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))
