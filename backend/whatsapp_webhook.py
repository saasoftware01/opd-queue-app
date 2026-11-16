import asyncio
import json
import hmac
import logging
import os
from hashlib import sha256
from typing import Any
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest, urlopen

from fastapi import APIRouter, HTTPException, Query, Request, Response

router = APIRouter()
logger = logging.getLogger(__name__)
AUTO_REPLY = "Thanks for contacting MediQueue. We received your message and will get back to you shortly."
META_GRAPH_API_VERSION = "v27.0"


def _post_whatsapp_message(url: str, access_token: str, recipient_phone: str) -> tuple[int, bytes]:
    request = URLRequest(
        url,
        data=json.dumps(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient_phone,
                "type": "text",
                "text": {"preview_url": False, "body": AUTO_REPLY},
            }
        ).encode(),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, response.read()
    except HTTPError as exc:
        return exc.code, exc.read()


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
        status_code, response_body_bytes = await asyncio.to_thread(
            _post_whatsapp_message, url, access_token, recipient_phone
        )
    except (URLError, OSError, TimeoutError) as exc:
        logger.error("WhatsApp auto-reply request failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Unable to reach the WhatsApp Cloud API.",
        ) from exc

    if not 200 <= status_code < 300:
        try:
            response_body = json.loads(response_body_bytes)
        except (ValueError, UnicodeDecodeError):
            response_body = {}
        meta_error = response_body.get("error", {}) if isinstance(response_body, dict) else {}
        error_code = meta_error.get("code") if isinstance(meta_error, dict) else None
        error_message = meta_error.get("message") if isinstance(meta_error, dict) else None
        logger.error(
            "WhatsApp Cloud API rejected auto-reply: status=%s code=%s message=%s",
            status_code,
            error_code,
            error_message,
        )
        raise HTTPException(
            status_code=502,
            detail="WhatsApp Cloud API rejected the automatic reply.",
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
                logger.info(
                    "WhatsApp text message received: sender=%s profile=%s text=%s",
                    sender_phone,
                    profile_name if isinstance(profile_name, str) else None,
                    message_text if isinstance(message_text, str) else None,
                )
                await send_auto_reply(sender_phone)

    return {"status": "success"}
