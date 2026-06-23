import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from config import (
    GOOGLE_API_TIMEOUT,
    GOOGLE_EMAIL_STATE_PATH,
    GOOGLE_EMAIL_TOKEN_PATH,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI,
    OCR_NOTIFY_EMAIL_AUTH_MODE,
    OCR_NOTIFY_EMAIL_ENABLED,
    OCR_NOTIFY_EMAIL_TO
)
from utils.email_notification import get_email_notification_status


GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
GOOGLE_EMAIL_SCOPES = [
    'openid',
    'email',
    'https://www.googleapis.com/auth/gmail.send'
]


def get_google_email_status():
    if OCR_NOTIFY_EMAIL_AUTH_MODE == 'smtp':
        email_status = get_email_notification_status()
        email_status.update({
            'clientId': '',
            'redirectUri': '',
            'canConnectGoogle': False
        })
        return email_status

    token_data = read_json_file(GOOGLE_EMAIL_TOKEN_PATH)
    connected_email = token_data.get('email', '')

    return {
        'enabled': OCR_NOTIFY_EMAIL_ENABLED,
        'configured': is_google_email_configured(),
        'connected': bool(token_data.get('refresh_token')),
        'clientId': GOOGLE_OAUTH_CLIENT_ID,
        'email': connected_email,
        'recipient': OCR_NOTIFY_EMAIL_TO or connected_email,
        'redirectUri': GOOGLE_OAUTH_REDIRECT_URI,
        'authMode': 'google',
        'canConnectGoogle': is_google_email_configured()
    }


def build_google_email_auth_url(redirect_uri=''):
    if not is_google_email_configured():
        raise ValueError('Google OAuth Client ID/Secret 설정이 필요합니다.')

    selected_redirect_uri = (redirect_uri or GOOGLE_OAUTH_REDIRECT_URI).strip()
    if not selected_redirect_uri:
        raise ValueError('Google OAuth Redirect URI 설정이 필요합니다.')

    state_value = secrets.token_urlsafe(24)
    write_json_file(GOOGLE_EMAIL_STATE_PATH, {
        'state': state_value,
        'redirectUri': selected_redirect_uri,
        'createdAt': time.time()
    })

    query_params = {
        'client_id': GOOGLE_OAUTH_CLIENT_ID,
        'redirect_uri': selected_redirect_uri,
        'response_type': 'code',
        'scope': ' '.join(GOOGLE_EMAIL_SCOPES),
        'access_type': 'offline',
        'prompt': 'consent',
        'include_granted_scopes': 'true',
        'state': state_value
    }

    return f'{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(query_params)}'


def complete_google_email_oauth(code, state):
    if not code:
        raise ValueError('Google 인증 코드가 없습니다.')

    state_data = validate_google_oauth_state(state)
    redirect_uri = state_data.get('redirectUri') or GOOGLE_OAUTH_REDIRECT_URI

    current_token_data = read_json_file(GOOGLE_EMAIL_TOKEN_PATH)
    token_data = request_google_token({
        'code': code,
        'client_id': GOOGLE_OAUTH_CLIENT_ID,
        'client_secret': GOOGLE_OAUTH_CLIENT_SECRET,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code'
    })

    if not token_data.get('refresh_token') and current_token_data.get('refresh_token'):
        token_data['refresh_token'] = current_token_data['refresh_token']

    token_data['expiresAt'] = time.time() + int(token_data.get('expires_in', 3600)) - 60
    token_data['email'] = get_google_user_email(token_data.get('access_token', '')) or current_token_data.get('email', '')
    write_json_file(GOOGLE_EMAIL_TOKEN_PATH, token_data)
    remove_json_file(GOOGLE_EMAIL_STATE_PATH)

    return get_google_email_status()


def complete_google_email_popup_code(code, origin):
    if not code:
        raise ValueError('Google 인증 코드가 없습니다.')

    if not origin:
        raise ValueError('Google 인증 origin이 없습니다.')

    current_token_data = read_json_file(GOOGLE_EMAIL_TOKEN_PATH)
    token_data = request_google_token({
        'code': code,
        'client_id': GOOGLE_OAUTH_CLIENT_ID,
        'client_secret': GOOGLE_OAUTH_CLIENT_SECRET,
        'redirect_uri': origin,
        'grant_type': 'authorization_code'
    })

    if not token_data.get('refresh_token') and current_token_data.get('refresh_token'):
        token_data['refresh_token'] = current_token_data['refresh_token']

    token_data['expiresAt'] = time.time() + int(token_data.get('expires_in', 3600)) - 60
    token_data['email'] = get_google_user_email(token_data.get('access_token', '')) or current_token_data.get('email', '')
    token_data['origin'] = origin
    write_json_file(GOOGLE_EMAIL_TOKEN_PATH, token_data)

    return get_google_email_status()


def get_google_access_token():
    token_data = read_json_file(GOOGLE_EMAIL_TOKEN_PATH)

    if not token_data.get('refresh_token'):
        raise ValueError('Google 계정이 연결되어 있지 않습니다.')

    if token_data.get('access_token') and token_data.get('expiresAt', 0) > time.time():
        return token_data['access_token'], token_data.get('email', '')

    refreshed_token_data = request_google_token({
        'client_id': GOOGLE_OAUTH_CLIENT_ID,
        'client_secret': GOOGLE_OAUTH_CLIENT_SECRET,
        'refresh_token': token_data['refresh_token'],
        'grant_type': 'refresh_token'
    })
    token_data.update(refreshed_token_data)
    token_data['expiresAt'] = time.time() + int(refreshed_token_data.get('expires_in', 3600)) - 60
    write_json_file(GOOGLE_EMAIL_TOKEN_PATH, token_data)

    return token_data['access_token'], token_data.get('email', '')


def request_google_token(token_request_body):
    encoded_token_request_body = urllib.parse.urlencode(token_request_body).encode('utf-8')
    request = urllib.request.Request(
        GOOGLE_TOKEN_URL,
        data=encoded_token_request_body,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST'
    )

    return read_google_response_json(request)


def get_google_user_email(access_token):
    if not access_token:
        return ''

    request = urllib.request.Request(
        GOOGLE_USERINFO_URL,
        headers={'Authorization': f'Bearer {access_token}'},
        method='GET'
    )

    try:
        user_info = read_google_response_json(request)
        return user_info.get('email', '')
    except Exception:
        return ''


def read_google_response_json(request):
    try:
        with urllib.request.urlopen(request, timeout=GOOGLE_API_TIMEOUT) as response:
            return json.loads(response.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as error:
        error_body = error.read().decode('utf-8', errors='replace')
        raise ValueError(error_body or str(error))


def validate_google_oauth_state(state):
    state_data = read_json_file(GOOGLE_EMAIL_STATE_PATH)

    if not state or state != state_data.get('state'):
        raise ValueError('Google 인증 상태값이 올바르지 않습니다.')

    if time.time() - state_data.get('createdAt', 0) > 600:
        raise ValueError('Google 인증 요청 시간이 만료되었습니다.')

    return state_data


def is_google_email_configured():
    return bool(GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET)


def read_json_file(file_path):
    try:
        if not file_path.exists():
            return {}

        return json.loads(file_path.read_text(encoding='utf-8') or '{}')
    except (OSError, json.JSONDecodeError):
        return {}


def write_json_file(file_path, json_content):
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(json_content, ensure_ascii=False, indent=2), encoding='utf-8')
    try:
        file_path.chmod(0o600)
    except OSError:
        return


def remove_json_file(file_path):
    try:
        file_path.unlink()
    except FileNotFoundError:
        return
