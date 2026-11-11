from types import SimpleNamespace

import httpx
import pytest
from telethon.crypto import AuthKey
from telethon.errors import (
    PasswordHashInvalidError,
    PhoneCodeInvalidError,
    SessionPasswordNeededError,
)

from sandbox_bot.api import create_api
from sandbox_bot.runtime import Runtime
from sandbox_bot.store import Store


class Telegram:
    def __init__(self, session, api_id, api_hash, **kwargs):
        self.session = session
        self.authorized = bool(session.auth_key)
        self.active = False
        self.sent = 0
        self.handlers = []

    async def connect(self):
        self.active = True

    async def disconnect(self):
        self.active = False

    def is_connected(self):
        return self.active

    async def is_user_authorized(self):
        return self.authorized

    async def send_code_request(self, phone):
        self.sent += 1
        return SimpleNamespace(phone_code_hash="private-code-hash")

    async def sign_in(self, **fields):
        if "password" in fields:
            if fields["password"] != "private-2fa":
                raise PasswordHashInvalidError(None)
            self.authorized = True
        elif fields.get("code") == "12345":
            raise SessionPasswordNeededError(None)
        elif fields.get("code") == "54321":
            self.authorized = True
        else:
            raise PhoneCodeInvalidError(None)
        if self.authorized:
            self.session.set_dc(2, "149.154.167.51", 443)
            self.session.auth_key = AuthKey(b"x" * 256)

    async def get_me(self):
        return SimpleNamespace(
            id=42, bot=False, phone="79991234567", first_name="Owner", last_name=""
        )

    def add_event_handler(self, handler, event):
        self.handlers.append(handler)

    async def log_out(self):
        self.authorized = False
        self.active = False


async def test_code_2fa_saved_credentials_and_no_code_persistence(tmp_path):
    store = Store(tmp_path / "state.db")
    runtime = Runtime(tmp_path, store, client_factory=Telegram)
    app = create_api(store, "setup-token-more-than-24-chars", runtime=runtime)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url="http://test",
        headers={"Authorization": "Bearer setup-token-more-than-24-chars"},
    ) as c:
        assert (
            await c.post(
                "/api/v1/telegram/code",
                json={"api_id": 1234, "api_hash": "a" * 32, "phone": "+79991234567"},
            )
        ).json()["state"] == "code_required"
        assert (await c.post("/api/v1/telegram/verify", json={"code": "12345"})).json()[
            "state"
        ] == "password_required"
        assert (
            await c.post("/api/v1/telegram/password", json={"password": "wrong"})
        ).status_code == 422
        result = await c.post("/api/v1/telegram/password", json={"password": "private-2fa"})
        assert result.json()["state"] == "connected"
        assert runtime.connected()
        assert len(runtime.client.handlers) == 1
        state = (await c.get("/api/v1/telegram")).text
        assert (
            "private-2fa" not in state
            and "private-code-hash" not in state
            and '"api_hash"' not in state
        )
        saved = runtime.vault.load()
        assert "code" not in saved and "password" not in saved
        assert saved["telegram"]["api_id"] == 1234
        assert saved["telegram"]["api_hash"] == "a" * 32
        await c.post("/api/v1/telegram/logout", json={})
        assert not runtime.connected()
        assert store.status()["status"] == "online"
    await runtime.stop()


async def test_ai_can_be_created_from_site_and_restored_without_secret_response(tmp_path):
    store = Store(tmp_path / "state.db")
    runtime = Runtime(tmp_path, store, client_factory=Telegram)
    app = create_api(store, "setup-token-more-than-24-chars", runtime=runtime)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url="http://test",
        headers={"Authorization": "Bearer setup-token-more-than-24-chars"},
    ) as c:
        assert (await c.get("/api/v1/settings")).json()["runtime_available"]
        result = await c.patch(
            "/api/v1/settings",
            json={
                "base_url": "https://example.com/v1",
                "model": "vision",
                "api_key": "saved-private-key",
            },
        )
        assert result.status_code == 200
        assert "saved-private-key" not in result.text
        assert runtime.ai.api_key == "saved-private-key"
    await runtime.stop()
    restored = Runtime(tmp_path, store, client_factory=Telegram)
    await restored.start()
    assert restored.ai.model == "vision" and restored.ai.api_key == "saved-private-key"
    await restored.stop()


async def test_verify_without_challenge_and_invalid_credentials_fail(tmp_path):
    store = Store(tmp_path / "state.db")
    runtime = Runtime(tmp_path, store, client_factory=Telegram)
    with pytest.raises(ValueError):
        await runtime.verify_code("12345")
    with pytest.raises(ValueError):
        await runtime.request_code(0, "bad", "not a phone")
    await runtime.stop()


async def test_session_restores_after_restart_without_sending_code(tmp_path):
    store = Store(tmp_path / "state.db")
    runtime = Runtime(tmp_path, store, client_factory=Telegram)
    await runtime.request_code(1234, "a" * 32, "+79991234567")
    await runtime.verify_code("54321")
    assert runtime.public_state()["session_saved"]
    await runtime.stop()
    restored = Runtime(tmp_path, store, client_factory=Telegram)
    await restored.start()
    assert restored.connected()
    assert restored.client.sent == 0
    assert restored.public_state()["phone"] == "+79991234567"
    await restored.stop()


async def test_logout_reconnects_saved_session_before_revoking(tmp_path):
    store = Store(tmp_path / "state.db")
    runtime = Runtime(tmp_path, store, client_factory=Telegram)
    await runtime.request_code(1234, "a" * 32, "+79991234567")
    await runtime.verify_code("54321")
    await runtime.stop()
    revoked = []

    class RevokingTelegram(Telegram):
        async def log_out(self):
            assert self.active and self.authorized
            revoked.append(True)
            return await super().log_out()

    restored = Runtime(tmp_path, store, client_factory=RevokingTelegram)
    await restored.logout()
    assert revoked == [True]
    assert not restored.public_state()["session_saved"]
    assert "telegram_session" not in restored.vault.load()
    await restored.stop()


async def test_code_attempt_limit_and_sensitive_validation_output(tmp_path):
    store = Store(tmp_path / "state.db")
    runtime = Runtime(tmp_path, store, client_factory=Telegram)
    await runtime.request_code(1234, "a" * 32, "+79991234567")
    for _ in range(5):
        with pytest.raises(ValueError, match="Неверный код"):
            await runtime.verify_code("00000")
    with pytest.raises(ValueError, match="истекли"):
        await runtime.verify_code("54321")
    app = create_api(store, "setup-token-more-than-24-chars", runtime=runtime)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url="http://test",
        headers={"Authorization": "Bearer setup-token-more-than-24-chars"},
    ) as client:
        response = await client.post(
            "/api/v1/telegram/code",
            json={"api_id": 1234, "api_hash": "PRIVATE_SECRET_VALUE", "phone": "+79991234567"},
        )
        assert response.status_code == 422
        assert "PRIVATE_SECRET_VALUE" not in response.text
    await runtime.stop()
