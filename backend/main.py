import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from dotenv import dotenv_values
from fastapi import FastAPI

from whatsapp_webhook import router

logging.basicConfig(level=logging.INFO)

BACKEND_ENV_KEYS = (
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_TEMPLATE_NAME",
    "WHATSAPP_TEMPLATE_LANGUAGE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
)
ENV_FILE = Path(__file__).resolve().parents[1] / ".env.local"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if ENV_FILE.is_file():
        env_values = dotenv_values(ENV_FILE)
        for key in BACKEND_ENV_KEYS:
            if not os.environ.get(key) and env_values.get(key):
                os.environ[key] = env_values[key]
    yield


app = FastAPI(title="WhatsApp Webhook API", lifespan=lifespan)
app.include_router(router)
