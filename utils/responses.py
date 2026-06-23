from fastapi.responses import JSONResponse


def convert_to_json_safe(response_content):
    if isinstance(response_content, dict):
        return {
            convert_to_json_safe(response_key): convert_to_json_safe(response_value)
            for response_key, response_value in response_content.items()
        }
    if isinstance(response_content, list):
        return [convert_to_json_safe(response_item) for response_item in response_content]
    if isinstance(response_content, tuple):
        return [convert_to_json_safe(response_item) for response_item in response_content]
    if hasattr(response_content, 'item'):
        return response_content.item()
    if hasattr(response_content, 'tolist'):
        return response_content.tolist()
    return response_content


def json_response(response_body, status_code=200):
    return JSONResponse(content=convert_to_json_safe(response_body), status_code=status_code)
