import smtplib
import threading
from email.message import EmailMessage

from config import (
    OCR_NOTIFY_EMAIL_ENABLED,
    OCR_NOTIFY_EMAIL_TO,
    SMTP_NOTIFY_EMAIL_FROM,
    SMTP_NOTIFY_EMAIL_HOST,
    SMTP_NOTIFY_EMAIL_PASSWORD,
    SMTP_NOTIFY_EMAIL_PORT,
    SMTP_NOTIFY_EMAIL_TIMEOUT,
    SMTP_NOTIFY_EMAIL_USERNAME,
    SMTP_NOTIFY_EMAIL_USE_TLS
)


def get_email_notification_status():
    sender_email = SMTP_NOTIFY_EMAIL_FROM or SMTP_NOTIFY_EMAIL_USERNAME
    configured = is_email_notification_configured()

    return {
        'enabled': OCR_NOTIFY_EMAIL_ENABLED,
        'configured': configured,
        'connected': configured,
        'email': sender_email,
        'recipient': OCR_NOTIFY_EMAIL_TO or sender_email,
        'authMode': 'smtp'
    }


def send_email_notification_async(subject, message):
    thread = threading.Thread(target=send_email_notification, args=(subject, message), daemon=True)
    thread.start()


def send_email_notification(subject, message):
    if not OCR_NOTIFY_EMAIL_ENABLED:
        return False

    if not is_email_notification_configured():
        return False

    sender_email = SMTP_NOTIFY_EMAIL_FROM or SMTP_NOTIFY_EMAIL_USERNAME
    recipient_email = OCR_NOTIFY_EMAIL_TO or sender_email

    if not recipient_email:
        return False

    try:
        email_message = EmailMessage()
        email_message['From'] = sender_email
        email_message['To'] = recipient_email
        email_message['Subject'] = subject
        email_message.set_content(message)

        with smtplib.SMTP(SMTP_NOTIFY_EMAIL_HOST, SMTP_NOTIFY_EMAIL_PORT, timeout=SMTP_NOTIFY_EMAIL_TIMEOUT) as smtp:
            if SMTP_NOTIFY_EMAIL_USE_TLS:
                smtp.starttls()
            smtp.login(SMTP_NOTIFY_EMAIL_USERNAME, SMTP_NOTIFY_EMAIL_PASSWORD)
            smtp.send_message(email_message)

        return True
    except Exception:
        return False


def is_email_notification_configured():
    return bool(SMTP_NOTIFY_EMAIL_HOST and SMTP_NOTIFY_EMAIL_PORT and SMTP_NOTIFY_EMAIL_USERNAME and SMTP_NOTIFY_EMAIL_PASSWORD)
