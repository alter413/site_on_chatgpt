import asyncio
import secrets
from pathlib import PurePosixPath
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, File, HTTPException, Path, UploadFile
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from .ai import validate_base_url
from .attachments import MAX_FILE, extract
from .store import Store

ChatID = Annotated[int, Path(gt=0)]
MAX_REQUEST = MAX_FILE + 64 * 1024


class RequestGuard:
    """Authenticate and cap the body before multipart parsing or temporary-file spooling."""

    def __init__(self, app, token):
        self.app = app
        self.token = token.encode("ascii")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        authorization = headers.get(b"authorization", b"").split(b" ", 1)
        if (
            len(authorization) != 2
            or authorization[0].lower() != b"bearer"
            or not secrets.compare_digest(authorization[1], self.token)
        ):
            response = JSONResponse(
                {"detail": "Нужен bearer-токен"},
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
            )
            return await response(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_REQUEST:
                return await JSONResponse({"detail": "Запрос слишком большой"}, status_code=413)(
                    scope, receive, send
                )
            if not message.get("more_body", False):
                break
        delivered = False

        async def buffered_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        return await self.app(scope, buffered_receive, send)


class ChatPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool | None = None
    name: str | None = Field(default=None, max_length=500)
    age: int | None = Field(default=None, ge=0, le=150, strict=True)
    location: str | None = Field(default=None, max_length=500)
    web_enabled: StrictBool | None = None


class StatusInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["online", "offline", "busy", "unavailable"]


class NoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100_000)


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str | None = Field(default=None, min_length=1, max_length=200)
    base_url: str | None = Field(default=None, min_length=1, max_length=2000)
    api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    search_key: str | None = Field(default=None, max_length=4096)
    reply_style: Literal["neutral", "friendly", "brief", "formal"] | None = None
    max_output_units: int | None = Field(default=None, ge=100, le=3500)


def create_api(store: Store, token: str, telegram=None, ai=None):
    if len(token) < 24 or not token.isascii() or any(c.isspace() for c in token):
        raise ValueError("Токен управления: минимум 24 ASCII-символа без пробелов")
    bearer = HTTPBearer(auto_error=False)

    async def authorize(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ):
        if credentials is None or not secrets.compare_digest(credentials.credentials, token):
            raise HTTPException(401, "Нужен bearer-токен", headers={"WWW-Authenticate": "Bearer"})

    app = FastAPI(
        title="Telegram Sandbox Management",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        dependencies=[Depends(authorize)],
    )
    app.add_middleware(RequestGuard, token=token)

    @app.exception_handler(ValueError)
    async def invalid(_request, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.get("/openapi.json", include_in_schema=False)
    async def schema():
        return app.openapi()

    @app.get("/api/v1/health")
    async def health():
        return {"ok": True, "telegram_connected": bool(telegram and telegram.connected())}

    def public_settings():
        return {
            "model": ai.model if ai else "",
            "base_url": ai.base_url if ai else "",
            "api_key_configured": bool(ai and ai.api_key),
            "search_key_configured": bool(ai and ai.search_key),
            "reply_style": ai.reply_style if ai else "neutral",
            "max_output_units": ai.max_output_units if ai else 3500,
            "runtime_available": ai is not None,
        }

    @app.get("/api/v1/settings")
    async def settings():
        return public_settings()

    @app.patch("/api/v1/settings")
    async def update_settings(body: SettingsPatch):
        if ai is None:
            raise HTTPException(503, "ИИ не подключён: запустите бот без --api-only")
        values = body.model_dump(exclude_unset=True)
        if any(v is None for v in values.values()):
            raise ValueError("Значения настроек не могут быть null")
        if "base_url" in values:
            values["base_url"] = validate_base_url(values["base_url"])
            if urlsplit(values["base_url"]).netloc != urlsplit(
                ai.base_url
            ).netloc and not values.get("api_key"):
                raise ValueError("Для другого провайдера введите новый API key")
        store.save_settings({k: v for k, v in values.items() if k not in {"api_key", "search_key"}})
        for key, value in values.items():
            setattr(ai, key, value)
        return public_settings()

    @app.get("/api/v1/models")
    async def models():
        if ai is None:
            raise HTTPException(503, "ИИ не подключён")
        try:
            return {"models": await ai.models()}
        except Exception:  # noqa: BLE001 — never return provider secrets
            raise HTTPException(502, "Провайдер не вернул список; введите модель вручную") from None

    @app.get("/api/v1/dashboard")
    async def dashboard(days: int = 7):
        if days not in {7, 14, 30}:
            raise HTTPException(422, "Период: 7, 14 или 30 дней")
        return store.dashboard(days)

    @app.get("/api/v1/activity")
    async def activity(limit: int = 50, before: int | None = None):
        return store.activity(limit, before)

    @app.get("/api/v1/status")
    async def get_status():
        return store.status()

    @app.put("/api/v1/status")
    async def status(body: StatusInput):
        store.set_status(body.status)
        return store.status()

    @app.get("/api/v1/dialogs")
    async def dialogs():
        if telegram is None or not telegram.connected():
            raise HTTPException(503, "Telegram не подключён")
        return await telegram.dialogs()

    @app.get("/api/v1/chats")
    async def chats():
        return store.chats()

    @app.get("/api/v1/chats/{chat_id}")
    async def chat(chat_id: ChatID):
        return store.chat(chat_id)

    @app.patch("/api/v1/chats/{chat_id}")
    async def patch_chat(chat_id: ChatID, body: ChatPatch):
        return store.update_chat(chat_id, body.model_dump(exclude_unset=True))

    @app.get("/api/v1/chats/{chat_id}/materials")
    async def materials(chat_id: ChatID):
        return store.materials(chat_id)

    @app.post("/api/v1/chats/{chat_id}/materials", status_code=201)
    async def add_note(chat_id: ChatID, body: NoteInput):
        return {"id": store.add_material(chat_id, body.title, {"text": body.text})}

    @app.post("/api/v1/chats/{chat_id}/files", status_code=201)
    async def upload(chat_id: ChatID, file: Annotated[UploadFile, File()]):
        try:
            data = await file.read(MAX_FILE + 1)
            # Never use client filenames as local filesystem paths.
            name = PurePosixPath((file.filename or "file").replace("\\", "/")).name[:200]
            content = await asyncio.to_thread(extract, name, data)
            return {"id": store.add_material(chat_id, name, content)}
        finally:
            await file.close()

    @app.delete("/api/v1/chats/{chat_id}/materials/{material_id}", status_code=204)
    async def delete(chat_id: ChatID, material_id: int):
        if not store.delete_material(chat_id, material_id):
            raise HTTPException(404, "Материал не найден в этой песочнице")

    return app
