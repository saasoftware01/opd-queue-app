import json
import hmac
import logging
import os
import re
import secrets
from hashlib import sha256
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
AUTO_REPLY = "Thanks for contacting MediQueue. We received your message and will get back to you shortly."
META_GRAPH_API_VERSION = "v27.0"
OTP_TEMPLATE_NAME = "auth_login_otp"
OTP_TEMPLATE_LANGUAGE = "en_US"
OTP_EXPIRY_SECONDS = 180
OTP_RESEND_COOLDOWN_SECONDS = 60


def _normalize_indian_mobile(value: Any) -> tuple[str, str] | None:
    if not isinstance(value, str) or not re.fullmatch(r"[+0-9\s()-]+", value.strip()):
        return None

    digits = re.sub(r"[^0-9]", "", value)
    if len(digits) == 12 and digits.startswith("91"):
        mobile = digits[2:]
    elif len(digits) == 10:
        mobile = digits
    else:
        return None

    if not re.fullmatch(r"[6-9][0-9]{9}", mobile):
        return None
    return mobile, f"91{mobile}"


def _otp_hash(value: str, service_role_key: str) -> str:
    return hmac.new(service_role_key.encode(), value.encode(), sha256).hexdigest()


def _supabase_credentials() -> tuple[str, str] | None:
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        return None
    return supabase_url.rstrip("/"), service_role_key


def _supabase_headers(service_role_key: str) -> dict[str, str]:
    return {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }


async def _store_login_otp(phone_hash: str, otp_hash: str, purpose: str) -> bool:
    credentials = _supabase_credentials()
    if not credentials:
        logger.error("WhatsApp OTP storage is not configured.")
        raise HTTPException(status_code=503, detail="WhatsApp OTP service is not configured.")

    supabase_url, service_role_key = credentials
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{supabase_url}/rest/v1/rpc/store_whatsapp_login_otp",
                headers=_supabase_headers(service_role_key),
                json={
                    "p_phone_hash": phone_hash,
                    "p_otp_hash": otp_hash,
                    "p_purpose": purpose,
                },
            )
    except httpx.RequestError as exc:
        logger.error("Unable to reach Supabase for WhatsApp OTP storage: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Unable to prepare the WhatsApp verification code.",
        ) from exc

    if not response.is_success:
        logger.error("Supabase rejected WhatsApp OTP storage: status=%s", response.status_code)
        raise HTTPException(
            status_code=502,
            detail="Unable to prepare the WhatsApp verification code.",
        )
    try:
        reserved = response.json()
    except ValueError as exc:
        logger.error("Supabase returned an invalid WhatsApp OTP storage response.")
        raise HTTPException(
            status_code=502,
            detail="Unable to prepare the WhatsApp verification code.",
        ) from exc
    if not isinstance(reserved, bool):
        logger.error("Supabase returned an invalid WhatsApp OTP storage response.")
        raise HTTPException(
            status_code=502,
            detail="Unable to prepare the WhatsApp login code.",
        )
    return reserved


async def _release_login_otp(phone_hash: str, purpose: str) -> None:
    credentials = _supabase_credentials()
    if not credentials:
        logger.error("Unable to remove unsent WhatsApp OTP: Supabase is not configured.")
        return

    supabase_url, service_role_key = credentials
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.delete(
                f"{supabase_url}/rest/v1/whatsapp_login_otps",
                params={
                    "phone_hash": f"eq.{phone_hash}",
                    "purpose": f"eq.{purpose}",
                },
                headers=_supabase_headers(service_role_key),
            )
    except httpx.RequestError as exc:
        logger.error("Unable to remove unsent WhatsApp OTP: %s", exc)
        return
    if not response.is_success:
        logger.error(
            "Supabase rejected removal of unsent WhatsApp OTP: status=%s",
            response.status_code,
        )


def _meta_error(response: httpx.Response) -> tuple[int | str | None, str | None]:
    try:
        response_body = response.json()
    except ValueError:
        return None, None
    error = response_body.get("error") if isinstance(response_body, dict) else None
    if not isinstance(error, dict):
        return None, None
    code = error.get("code")
    message = error.get("message")
    return (
        code if isinstance(code, (int, str)) else None,
        message if isinstance(message, str) else None,
    )


@router.post("/send-whatsapp-otp")
async def send_whatsapp_otp(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid request body.") from exc
    if not isinstance(body, dict):
        raise HTTPException(
            status_code=400,
            detail="A valid mobile number and OTP purpose are required.",
        )

    phone = _normalize_indian_mobile(body.get("phoneNumber"))
    purpose = body.get("purpose")
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid 10-digit Indian mobile number.",
        )
    if purpose not in ("registration", "password_reset"):
        raise HTTPException(status_code=400, detail="A valid OTP purpose is required.")

    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    access_token = os.getenv("WHATSAPP_ACCESS_TOKEN")
    credentials = _supabase_credentials()
    if not phone_number_id or not access_token or not credentials:
        logger.error("WhatsApp OTP service is not configured.")
        raise HTTPException(status_code=503, detail="WhatsApp OTP service is not configured.")

    mobile, whatsapp_recipient = phone
    _, service_role_key = credentials
    phone_hash = _otp_hash(f"phone:{mobile}", service_role_key)
    otp_code = f"{secrets.randbelow(1_000_000):06d}"
    otp_hash = _otp_hash(f"otp:{mobile}:{otp_code}", service_role_key)
    reserved = await _store_login_otp(phone_hash, otp_hash, purpose)
    if not reserved:
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another OTP.",
            headers={"Retry-After": str(OTP_RESEND_COOLDOWN_SECONDS)},
        )

    template_name = os.getenv("WHATSAPP_TEMPLATE_NAME") or OTP_TEMPLATE_NAME
    template_language = os.getenv("WHATSAPP_TEMPLATE_LANGUAGE") or OTP_TEMPLATE_LANGUAGE
    url = (
        f"https://graph.facebook.com/{META_GRAPH_API_VERSION}/"
        f"{quote(phone_number_id, safe='')}/messages"
    )
    payload = {
        "messaging_product": "whatsapp",
        "to": whatsapp_recipient,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": template_language},
            "components": [
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": otp_code}],
                },
                {
                    "type": "button",
                    "sub_type": "url",
                    "index": "0",
                    "parameters": [{"type": "text", "text": otp_code}],
                },
            ],
        },
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
                json=payload,
            )
    except httpx.RequestError as exc:
        await _release_login_otp(phone_hash, purpose)
        logger.error("WhatsApp Cloud API OTP request failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Unable to send the WhatsApp verification code.",
            headers={"Retry-After": str(OTP_RESEND_COOLDOWN_SECONDS)},
        ) from exc

    if not response.is_success:
        error_code, error_message = _meta_error(response)
        await _release_login_otp(phone_hash, purpose)
        logger.error(
            "WhatsApp Cloud API rejected OTP: status=%s code=%s message=%s",
            response.status_code,
            error_code,
            error_message,
        )
        raise HTTPException(
            status_code=502,
            detail="Unable to send the WhatsApp verification code.",
            headers={"Retry-After": str(OTP_RESEND_COOLDOWN_SECONDS)},
        )

    return {
        "success": True,
        "expiresInSeconds": OTP_EXPIRY_SECONDS,
        "resendAfterSeconds": OTP_RESEND_COOLDOWN_SECONDS,
    }


async def store_incoming_message(
    message_id: str,
    sender_phone: str,
    sender_name: str | None,
    message_text: str,
) -> None:
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        logger.error("WhatsApp message storage is not configured.")
        raise HTTPException(status_code=503, detail="WhatsApp message storage is not configured.")

    url = f"{supabase_url.rstrip('/')}/rest/v1/whatsapp_incoming_messages"
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    }
    record = {
        "whatsapp_message_id": message_id,
        "sender_phone": sender_phone,
        "sender_name": sender_name,
        "message_text": message_text,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                url,
                params={"on_conflict": "whatsapp_message_id"},
                headers=headers,
                json=record,
            )
    except httpx.RequestError as exc:
        logger.error("Unable to reach Supabase for WhatsApp message storage: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Unable to store the incoming WhatsApp message.",
        ) from exc

    if not response.is_success:
        logger.error(
            "Supabase rejected WhatsApp message storage: status=%s",
            response.status_code,
        )
        raise HTTPException(
            status_code=502,
            detail="Unable to store the incoming WhatsApp message.",
        )


async def send_auto_reply(recipient_phone: str) -> None:
    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    access_token = os.getenv("WHATSAPP_ACCESS_TOKEN")
    if not phone_number_id or not access_token:
        logger.error("WhatsApp auto-reply is not configured.")
        raise HTTPException(status_code=503, detail="WhatsApp auto-reply is not configured.")

    url = (
        f"https://graph.facebook.com/{META_GRAPH_API_VERSION}/"
        f"{quote(phone_number_id, safe='')}/messages"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": recipient_phone,
                    "type": "text",
                    "text": {"preview_url": False, "body": AUTO_REPLY},
                },
            )
    except httpx.RequestError as exc:
        logger.error("WhatsApp auto-reply request failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Unable to reach the WhatsApp Cloud API.",
        ) from exc

    if not response.is_success:
        try:
            response_body = response.json()
        except ValueError:
            response_body = {}
        meta_error = response_body.get("error", {}) if isinstance(response_body, dict) else {}
        error_code = meta_error.get("code") if isinstance(meta_error, dict) else None
        error_message = meta_error.get("message") if isinstance(meta_error, dict) else None
        logger.error(
            "WhatsApp Cloud API rejected auto-reply: status=%s code=%s message=%s",
            response.status_code,
            error_code,
            error_message,
        )
        raise HTTPException(
            status_code=502,
            detail="WhatsApp Cloud API rejected the automatic reply.",
        )

    try:
        response_body = response.json()
    except ValueError:
        response_body = {}
    messages = response_body.get("messages", []) if isinstance(response_body, dict) else []
    message_id = (
        messages[0].get("id")
        if isinstance(messages, list) and messages and isinstance(messages[0], dict)
        else None
    )
    logger.info(
        "WhatsApp Cloud API accepted automatic reply: message_id=%s",
        message_id if isinstance(message_id, str) else "unavailable",
    )


@router.get("/webhook", response_class=Response)
def verify_webhook(
    mode: str = Query(..., alias="hub.mode"),
    verify_token: str = Query(..., alias="hub.verify_token"),
    challenge: str = Query(..., alias="hub.challenge"),
) -> Response:
    expected_token = os.getenv("WHATSAPP_VERIFY_TOKEN")
    if (
        mode != "subscribe"
        or not expected_token
        or not hmac.compare_digest(verify_token, expected_token)
    ):
        raise HTTPException(status_code=403, detail="Webhook verification failed")

    try:
        integer_challenge = int(challenge)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Challenge must be an integer") from exc

    return Response(content=str(integer_challenge), media_type="text/plain")


@router.post("/webhook")
async def receive_webhook(request: Request) -> dict[str, str]:
    app_secret = os.getenv("WHATSAPP_APP_SECRET")
    if not app_secret:
        logger.error("WhatsApp webhook signature verification is not configured.")
        raise HTTPException(
            status_code=503,
            detail="WhatsApp webhook signature verification is not configured.",
        )

    raw_body = await request.body()
    signature = request.headers.get("x-hub-signature-256", "")
    expected_signature = "sha256=" + hmac.new(
        app_secret.encode(),
        raw_body,
        sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook payload.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid webhook payload.")

    entries = payload.get("entry")
    if not isinstance(entries, list):
        entries = []

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        changes = entry.get("changes")
        if not isinstance(changes, list):
            continue

        for change in changes:
            if not isinstance(change, dict):
                continue
            value = change.get("value")
            if not isinstance(value, dict):
                continue
            statuses = value.get("statuses")
            if isinstance(statuses, list):
                for status in statuses:
                    if not isinstance(status, dict):
                        continue
                    status_value = status.get("status")
                    if not isinstance(status_value, str):
                        continue
                    message_id = status.get("id")
                    errors = status.get("errors")
                    error_code = None
                    if isinstance(errors, list) and errors and isinstance(errors[0], dict):
                        error_code = errors[0].get("code")
                    logger.info(
                        "WhatsApp delivery update: status=%s message_id=%s error_code=%s",
                        status_value,
                        message_id if isinstance(message_id, str) else "unavailable",
                        error_code if isinstance(error_code, (int, str)) else "none",
                    )
            messages = value.get("messages")
            if not isinstance(messages, list):
                continue
            contacts = value.get("contacts")
            if not isinstance(contacts, list):
                contacts = []

            for message in messages:
                if not isinstance(message, dict):
                    continue
                sender_phone = message.get("from")
                text = message.get("text")
                message_text = text.get("body") if isinstance(text, dict) else None
                if not isinstance(sender_phone, str):
                    continue
                if not sender_phone.isdigit() or not 5 <= len(sender_phone) <= 20:
                    logger.warning("Ignoring WhatsApp message with an invalid sender number.")
                    continue
                contact = next(
                    (
                        item
                        for item in contacts
                        if isinstance(item, dict) and item.get("wa_id") == sender_phone
                    ),
                    None,
                )
                if contact is None:
                    contact = next((item for item in contacts if isinstance(item, dict)), None)
                profile = contact.get("profile") if isinstance(contact, dict) else None
                profile_name = profile.get("name") if isinstance(profile, dict) else None
                if isinstance(message_text, str):
                    message_id = message.get("id")
                    if not isinstance(message_id, str) or not message_id:
                        raise HTTPException(
                            status_code=400,
                            detail="WhatsApp text message is missing its message ID.",
                        )
                    if len(message_text) > 4096:
                        raise HTTPException(
                            status_code=400,
                            detail="WhatsApp text message exceeds the supported length.",
                        )
                    await store_incoming_message(
                        message_id,
                        sender_phone,
                        profile_name if isinstance(profile_name, str) else None,
                        message_text,
                    )
                    logger.info(
                        "Received WhatsApp text message: sender=***%s "
                        "message_id=%s text_length=%s",
                        sender_phone[-4:],
                        message_id,
                        len(message_text),
                    )
                await send_auto_reply(sender_phone)

    return {"status": "success"}
