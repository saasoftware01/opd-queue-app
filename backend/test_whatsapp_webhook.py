import hashlib
import hmac
import json
import os
import unittest
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx

from main import app

APP_SECRET = "test-app-secret"


def make_payload() -> dict[str, Any]:
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "contacts": [
                                {
                                    "wa_id": "919999999999",
                                    "profile": {"name": "Test Patient"},
                                }
                            ],
                            "messages": [
                                {
                                    "from": "919999999999",
                                    "text": {"body": "Hello MediQueue"},
                                }
                            ],
                        }
                    }
                ]
            }
        ]
    }


def signed_payload() -> tuple[bytes, str]:
    body = json.dumps(make_payload()).encode()
    digest = hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return body, f"sha256={digest}"


class WhatsAppWebhookTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()

    async def test_signed_text_message_sends_standard_reply(self) -> None:
        requests: list[httpx.Request] = []

        def mock_response(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={"messages": [{"id": "wamid.test"}]})

        real_async_client = httpx.AsyncClient

        def make_meta_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
            kwargs["transport"] = httpx.MockTransport(mock_response)
            return real_async_client(*args, **kwargs)

        body, signature = signed_payload()
        with (
            patch.dict(
                os.environ,
                {
                    "WHATSAPP_APP_SECRET": APP_SECRET,
                    "WHATSAPP_PHONE_NUMBER_ID": "test-phone-number-id",
                    "WHATSAPP_ACCESS_TOKEN": "test-access-token",
                },
            ),
            patch("whatsapp_webhook.httpx.AsyncClient", side_effect=make_meta_client),
        ):
            response = await self.client.post(
                "/webhook",
                content=body,
                headers={"x-hub-signature-256": signature},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "success"})
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].headers["Authorization"], "Bearer test-access-token")
        self.assertEqual(requests[0].url.path, "/v27.0/test-phone-number-id/messages")
        self.assertEqual(
            json.loads(requests[0].content),
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": "919999999999",
                "type": "text",
                "text": {
                    "preview_url": False,
                    "body": "Thanks for contacting MediQueue. We received your message and will get back to you shortly.",
                },
            },
        )

    async def test_invalid_signature_is_rejected_without_reply(self) -> None:
        body, _ = signed_payload()
        with (
            patch.dict(os.environ, {"WHATSAPP_APP_SECRET": APP_SECRET}),
            patch("whatsapp_webhook.send_auto_reply", new_callable=AsyncMock) as send_reply,
        ):
            response = await self.client.post(
                "/webhook",
                content=body,
                headers={"x-hub-signature-256": "sha256=invalid"},
            )

        self.assertEqual(response.status_code, 401)
        send_reply.assert_not_awaited()

    async def test_meta_rejection_returns_error(self) -> None:
        def mock_response(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={"error": {"code": 131030, "message": "Recipient not allowed"}},
            )

        real_async_client = httpx.AsyncClient

        def make_meta_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
            kwargs["transport"] = httpx.MockTransport(mock_response)
            return real_async_client(*args, **kwargs)

        body, signature = signed_payload()
        with (
            patch.dict(
                os.environ,
                {
                    "WHATSAPP_APP_SECRET": APP_SECRET,
                    "WHATSAPP_PHONE_NUMBER_ID": "test-phone-number-id",
                    "WHATSAPP_ACCESS_TOKEN": "test-access-token",
                },
            ),
            patch("whatsapp_webhook.httpx.AsyncClient", side_effect=make_meta_client),
        ):
            response = await self.client.post(
                "/webhook",
                content=body,
                headers={"x-hub-signature-256": signature},
            )

        self.assertEqual(response.status_code, 502)
