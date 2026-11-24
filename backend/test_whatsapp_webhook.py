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
                                    "id": "wamid.test-message-id",
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

    async def test_send_otp_uses_approved_template_and_stores_hash(self) -> None:
        requests: list[httpx.Request] = []

        def mock_response(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/rpc/store_whatsapp_login_otp"):
                return httpx.Response(200, json=True)
            return httpx.Response(200, json={"messages": [{"id": "wamid.otp-test"}]})

        real_async_client = httpx.AsyncClient

        def make_meta_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
            kwargs["transport"] = httpx.MockTransport(mock_response)
            return real_async_client(*args, **kwargs)

        service_role_key = "test-service-role-key"
        mobile = "9876543210"
        otp_code = "012345"
        with (
            patch.dict(
                os.environ,
                {
                    "WHATSAPP_PHONE_NUMBER_ID": "test-phone-number-id",
                    "WHATSAPP_ACCESS_TOKEN": "test-access-token",
                    "WHATSAPP_TEMPLATE_NAME": "auth_login_otp",
                    "WHATSAPP_TEMPLATE_LANGUAGE": "en_US",
                    "NEXT_PUBLIC_SUPABASE_URL": "https://test-project.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": service_role_key,
                },
            ),
            patch("whatsapp_webhook.secrets.randbelow", return_value=12345),
            patch("whatsapp_webhook.httpx.AsyncClient", side_effect=make_meta_client),
        ):
            response = await self.client.post(
                "/send-whatsapp-otp",
                json={
                    "phoneNumber": "+91 98765-43210",
                    "purpose": "registration",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "success": True,
                "expiresInSeconds": 180,
                "resendAfterSeconds": 60,
            },
        )
        self.assertNotIn(otp_code, response.text)
        self.assertEqual(len(requests), 2)

        otp_storage = requests[0]
        self.assertTrue(otp_storage.url.path.endswith("/rpc/store_whatsapp_login_otp"))
        stored_hashes = json.loads(otp_storage.content)
        self.assertEqual(stored_hashes["p_purpose"], "registration")
        self.assertEqual(
            stored_hashes["p_phone_hash"],
            hmac.new(
                service_role_key.encode(),
                f"phone:{mobile}".encode(),
                hashlib.sha256,
            ).hexdigest(),
        )
        self.assertEqual(
            stored_hashes["p_otp_hash"],
            hmac.new(
                service_role_key.encode(),
                f"otp:{mobile}:{otp_code}".encode(),
                hashlib.sha256,
            ).hexdigest(),
        )

        meta_request = requests[1]
        self.assertEqual(
            meta_request.headers["Authorization"],
            "Bearer test-access-token",
        )
        self.assertEqual(
            meta_request.url.path,
            "/v27.0/test-phone-number-id/messages",
        )
        template = json.loads(meta_request.content)["template"]
        self.assertEqual(template["name"], "auth_login_otp")
        self.assertEqual(template["language"], {"code": "en_US"})
        self.assertEqual(
            template["components"][0]["parameters"],
            [{"type": "text", "text": otp_code}],
        )
        self.assertEqual(
            template["components"][1]["parameters"],
            [{"type": "text", "text": otp_code}],
        )

    async def test_send_otp_observes_supabase_rate_limit(self) -> None:
        requests: list[httpx.Request] = []

        def mock_response(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=False)

        real_async_client = httpx.AsyncClient

        def make_supabase_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
            kwargs["transport"] = httpx.MockTransport(mock_response)
            return real_async_client(*args, **kwargs)

        with (
            patch.dict(
                os.environ,
                {
                    "WHATSAPP_PHONE_NUMBER_ID": "test-phone-number-id",
                    "WHATSAPP_ACCESS_TOKEN": "test-access-token",
                    "NEXT_PUBLIC_SUPABASE_URL": "https://test-project.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
                },
            ),
            patch("whatsapp_webhook.httpx.AsyncClient", side_effect=make_supabase_client),
        ):
            response = await self.client.post(
                "/send-whatsapp-otp",
                json={"phoneNumber": "9876543210", "purpose": "registration"},
            )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["retry-after"], "60")
        self.assertEqual(len(requests), 1)

    async def test_send_otp_releases_reserved_code_when_meta_rejects(self) -> None:
        requests: list[httpx.Request] = []

        def mock_response(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/rpc/store_whatsapp_login_otp"):
                return httpx.Response(200, json=True)
            if request.method == "DELETE":
                return httpx.Response(204)
            return httpx.Response(
                400,
                json={"error": {"code": 132001, "message": "Template unavailable"}},
            )

        real_async_client = httpx.AsyncClient

        def make_meta_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
            kwargs["transport"] = httpx.MockTransport(mock_response)
            return real_async_client(*args, **kwargs)

        with (
            patch.dict(
                os.environ,
                {
                    "WHATSAPP_PHONE_NUMBER_ID": "test-phone-number-id",
                    "WHATSAPP_ACCESS_TOKEN": "test-access-token",
                    "NEXT_PUBLIC_SUPABASE_URL": "https://test-project.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
                },
            ),
            patch("whatsapp_webhook.httpx.AsyncClient", side_effect=make_meta_client),
        ):
            response = await self.client.post(
                "/send-whatsapp-otp",
                json={"phoneNumber": "9876543210", "purpose": "registration"},
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.headers["retry-after"], "60")
        release_request = next(request for request in requests if request.method == "DELETE")
        self.assertEqual(
            release_request.url.params["purpose"],
            "eq.registration",
        )

    async def test_send_otp_rejects_invalid_phone_number(self) -> None:
        response = await self.client.post(
            "/send-whatsapp-otp",
            json={"phoneNumber": "123", "purpose": "registration"},
        )

        self.assertEqual(response.status_code, 400)

    async def test_send_otp_rejects_login_purpose(self) -> None:
        response = await self.client.post(
            "/send-whatsapp-otp",
            json={"phoneNumber": "9876543210", "purpose": "login"},
        )

        self.assertEqual(response.status_code, 400)

    async def test_signed_text_message_sends_standard_reply(self) -> None:
        requests: list[httpx.Request] = []

        def mock_response(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/rest/v1/whatsapp_incoming_messages"):
                return httpx.Response(201)
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
                    "NEXT_PUBLIC_SUPABASE_URL": "https://test-project.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
                },
            ),
            patch("whatsapp_webhook.httpx.AsyncClient", side_effect=make_meta_client),
        ):
            with self.assertLogs("whatsapp_webhook", level="INFO") as captured:
                response = await self.client.post(
                    "/webhook",
                    content=body,
                    headers={"x-hub-signature-256": signature},
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "success"})
        log_output = "\n".join(captured.output)
        self.assertIn("sender=***9999", log_output)
        self.assertIn("message_id=wamid.test-message-id", log_output)
        self.assertIn("WhatsApp Cloud API accepted automatic reply", log_output)
        self.assertIn("message_id=wamid.test", log_output)
        self.assertNotIn("Hello MediQueue", log_output)
        self.assertEqual(len(requests), 2)
        storage_request = next(
            request
            for request in requests
            if request.url.path.endswith("/rest/v1/whatsapp_incoming_messages")
        )
        self.assertEqual(
            storage_request.headers["Authorization"],
            "Bearer test-service-role-key",
        )
        self.assertEqual(
            storage_request.url.params["on_conflict"],
            "whatsapp_message_id",
        )
        self.assertIn(
            "resolution=ignore-duplicates",
            storage_request.headers["Prefer"],
        )
        self.assertEqual(
            json.loads(storage_request.content),
            {
                "whatsapp_message_id": "wamid.test-message-id",
                "sender_phone": "919999999999",
                "sender_name": "Test Patient",
                "message_text": "Hello MediQueue",
            },
        )
        meta_request = next(
            request for request in requests if request.url.path.endswith("/messages")
        )
        self.assertEqual(meta_request.headers["Authorization"], "Bearer test-access-token")
        self.assertEqual(meta_request.url.path, "/v27.0/test-phone-number-id/messages")
        self.assertEqual(
            json.loads(meta_request.content),
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
            patch(
                "whatsapp_webhook.store_incoming_message",
                new_callable=AsyncMock,
            ) as store_message,
        ):
            response = await self.client.post(
                "/webhook",
                content=body,
                headers={"x-hub-signature-256": "sha256=invalid"},
            )

        self.assertEqual(response.status_code, 401)
        send_reply.assert_not_awaited()
        store_message.assert_not_awaited()

    async def test_meta_rejection_returns_error(self) -> None:
        def mock_response(_: httpx.Request) -> httpx.Response:
            if _.url.path.endswith("/rest/v1/whatsapp_incoming_messages"):
                return httpx.Response(201)
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
                    "NEXT_PUBLIC_SUPABASE_URL": "https://test-project.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
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

    async def test_storage_failure_does_not_send_auto_reply(self) -> None:
        def mock_response(_: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"message": "Database unavailable"})

        real_async_client = httpx.AsyncClient

        def make_supabase_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
            kwargs["transport"] = httpx.MockTransport(mock_response)
            return real_async_client(*args, **kwargs)

        body, signature = signed_payload()
        with (
            patch.dict(
                os.environ,
                {
                    "WHATSAPP_APP_SECRET": APP_SECRET,
                    "NEXT_PUBLIC_SUPABASE_URL": "https://test-project.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
                },
            ),
            patch("whatsapp_webhook.httpx.AsyncClient", side_effect=make_supabase_client),
            patch("whatsapp_webhook.send_auto_reply", new_callable=AsyncMock) as send_reply,
        ):
            response = await self.client.post(
                "/webhook",
                content=body,
                headers={"x-hub-signature-256": signature},
            )

        self.assertEqual(response.status_code, 502)
        send_reply.assert_not_awaited()

    async def test_delivery_status_is_logged_without_recipient_details(self) -> None:
        payload = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "statuses": [
                                    {
                                        "id": "wamid.delivery-test",
                                        "status": "failed",
                                        "errors": [{"code": 131026}],
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        }
        body = json.dumps(payload).encode()
        signature = "sha256=" + hmac.new(
            APP_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()

        with patch.dict(os.environ, {"WHATSAPP_APP_SECRET": APP_SECRET}):
            with self.assertLogs("whatsapp_webhook", level="INFO") as captured:
                response = await self.client.post(
                    "/webhook",
                    content=body,
                    headers={"x-hub-signature-256": signature},
                )

        self.assertEqual(response.status_code, 200)
        self.assertIn("status=failed", "\n".join(captured.output))
        self.assertIn("error_code=131026", "\n".join(captured.output))
