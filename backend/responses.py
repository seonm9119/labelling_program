from fastapi.responses import JSONResponse


def make_json_safe(value):
    if isinstance(value, dict):
        return {make_json_safe(key): make_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [make_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [make_json_safe(item) for item in value]
    if hasattr(value, 'item'):
        return value.item()
    if hasattr(value, 'tolist'):
        return value.tolist()
    return value


def json_response(response_body, status_code=200):
    return JSONResponse(content=make_json_safe(response_body), status_code=status_code)
