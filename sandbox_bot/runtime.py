import asyncio
import copy
import re
import time
from contextvars import ContextVar

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError,
    PasswordHashInvalidError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberInvalidError,
    SessionPasswordNeededError,
)
from telethon.sessions import StringSession

from .ai import AIClient, validate_base_url
from .engine import Engine
from .telegram import TelegramGateway
from .vault import Vault


class SetupError(ValueError):
    pass


class LiveAI:
    def __init__(self, runtime):
        self.runtime = runtime
        self.usage = ContextVar("live_ai_usage", default=None)

    @property
    def model(self):
        return self.runtime.ai.model if self.runtime.ai else ""

    @property
    def max_output_units(self):
        return self.runtime.ai.max_output_units if self.runtime.ai else 3500

    async def answer(self, messages, web_enabled):
        ai = self.runtime.ai
        if ai is None:
            raise RuntimeError("ИИ не настроен")
        try:
            return await ai.answer(messages, web_enabled)
        finally:
            self.usage.set(ai.usage.get())


class Runtime:
    def __init__(self, directory, store, *, client_factory=TelegramClient):
        self.directory = directory
        self.store = store
        self.vault = Vault(directory)
        self.config = self.vault.load()
        self.client_factory = client_factory
        self.client = None
        self.gateway = None
        self.ai = None
        self.engine = Engine(store, LiveAI(self))
        self.lock = asyncio.Lock()
        self.state = "disconnected" if self.config.get("telegram") else "not_configured"
        self.account = None
        self.code_hash = None
        self.challenge_at = 0
        self.attempts = 0
        self.last_request = 0

    def _save(self, config):
        self.vault.save(config)
        self.config = config

    async def start(self):
        async with self.lock:
            await self._restore()

    async def _restore(self):
        settings = self.config.get("ai", {})
        if all(settings.get(k) for k in ("base_url", "api_key", "model")):
            self.configure_ai(settings)
        credentials = self.config.get("telegram")
        if credentials and (
            self.config.get("telegram_session") or (self.directory / "telegram.session").exists()
        ):
            try:
                self.client = self._new_client(credentials["api_id"], credentials["api_hash"])
                await asyncio.wait_for(self.client.connect(), 15)
                if await asyncio.wait_for(self.client.is_user_authorized(), 15):
                    await self._finish(credentials)
                else:
                    await self._disconnect()
            except Exception:  # noqa: BLE001 — SDK errors can contain secrets
                await self._disconnect()
                self.state = "disconnected"

    def configure_ai(self, values):
        previous = self.config.get("ai", {})
        merged = {**previous, **values}
        if not all(merged.get(key) for key in ("base_url", "api_key", "model")):
            raise ValueError("Укажите Base URL, модель и API key")
        merged["base_url"] = validate_base_url(merged["base_url"])
        config = copy.deepcopy(self.config)
        config["ai"] = merged
        self._save(config)
        if self.ai is None:
            self.ai = AIClient(
                merged["base_url"], merged["api_key"], merged["model"], merged.get("search_key", "")
            )
        for key, value in merged.items():
            setattr(self.ai, key, value)
        self.store.save_settings(
            {k: v for k, v in merged.items() if k not in {"api_key", "search_key"}}
        )

    def _new_client(self, api_id, api_hash):
        if self.config.get("telegram_session"):
            session = StringSession(self.config["telegram_session"])
        elif (self.directory / "telegram.session").exists():
            session = str(self.directory / "telegram")
        else:
            session = StringSession()
        return self.client_factory(
            session, api_id, api_hash, flood_sleep_threshold=0, request_retries=0, catch_up=False
        )

    def connected(self):
        return bool(self.gateway and self.client and self.client.is_connected())

    def public_state(self):
        saved = self.config.get("telegram", {})
        phone = saved.get("phone", "")
        return {
            "state": self.state
            if self.state != "connected" or self.connected()
            else "disconnected",
            "connected": self.connected(),
            "api_id": saved.get("api_id"),
            "api_hash_configured": bool(saved.get("api_hash")),
            "phone": phone,
            "phone_masked": "+" + "*" * max(0, len(phone) - 5) + phone[-4:] if phone else "",
            "session_saved": bool(
                self.config.get("telegram_session")
                or (self.directory / "telegram.session").exists()
            ),
            "account": self.account,
        }

    async def dialogs(self):
        if not self.connected():
            raise ValueError("Telegram не подключён")
        return await self.gateway.dialogs()

    async def _disconnect(self):
        self.gateway = None
        self.account = None
        if self.client:
            await self.client.disconnect()
        self.client = None

    async def _finish(self, credentials):
        owner = await asyncio.wait_for(self.client.get_me(), 15)
        if owner.bot:
            raise SetupError("Нужен личный Telegram-аккаунт")
        if str(owner.phone or "").lstrip("+") != credentials["phone"].lstrip("+"):
            raise SetupError("Сохранена сессия другого номера. Сначала выйдите из Telegram")
        config = copy.deepcopy(self.config)
        config["telegram"] = credentials
        config["telegram_session"] = StringSession.save(self.client.session)
        self._save(config)
        self.code_hash = None
        self.attempts = 0
        self.state = "connected"
        self.store.set_status("online")
        self.account = {
            "id": owner.id,
            "name": " ".join(filter(None, [owner.first_name, owner.last_name])),
        }
        self.gateway = TelegramGateway(self.client, self.store, self.engine, owner.id)
        self.gateway.install()

    async def request_code(self, api_id, api_hash, phone):
        if self.lock.locked():
            raise ValueError("Операция уже выполняется. Подождите её завершения")
        async with self.lock, asyncio.timeout(22):
            if type(api_id) is not int or api_id <= 0:
                raise ValueError("Неверный Telegram API ID")
            api_hash = api_hash or self.config.get("telegram", {}).get("api_hash", "")
            if not re.fullmatch(r"[0-9a-fA-F]{32}", api_hash):
                raise ValueError("API hash должен содержать 32 шестнадцатеричных символа")
            phone = re.sub(r"[\s()-]", "", phone)
            if not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone):
                raise ValueError("Телефон должен быть в международном формате +79991234567")
            credentials = {"api_id": api_id, "api_hash": api_hash, "phone": phone}
            if self.connected():
                if credentials == self.config.get("telegram"):
                    return self.public_state()
                raise ValueError("Сначала выйдите из текущего Telegram-аккаунта")
            if self.last_request and time.monotonic() - self.last_request < 60:
                raise ValueError("Повторный запрос кода доступен через минуту")
            await self._disconnect()
            self.code_hash = None
            self.client = self._new_client(api_id, api_hash)
            try:
                await asyncio.wait_for(self.client.connect(), 15)
                if await asyncio.wait_for(self.client.is_user_authorized(), 15):
                    await self._finish(credentials)
                else:
                    self.last_request = time.monotonic()
                    response = await asyncio.wait_for(self.client.send_code_request(phone), 15)
                    config = copy.deepcopy(self.config)
                    config["telegram"] = credentials
                    self._save(config)
                    self.code_hash = response.phone_code_hash
                    self.challenge_at = time.monotonic()
                    self.attempts = 0
                    self.state = "code_required"
            except Exception as exc:  # noqa: BLE001 — return only sanitized errors
                await self._disconnect()
                self.state = "disconnected"
                self._error(exc)
            return self.public_state()

    def _challenge(self, expected):
        if self.state != expected or not self.client or not self.code_hash:
            raise ValueError("Сначала запросите новый код входа")
        if time.monotonic() - self.challenge_at > 600 or self.attempts >= 5:
            self.code_hash = None
            self.state = "disconnected"
            raise ValueError("Попытки или время входа истекли. Запросите код заново")
        self.attempts += 1

    @staticmethod
    def _error(exc):
        if isinstance(exc, SetupError):
            raise exc
        messages = {
            PhoneCodeInvalidError: "Неверный код Telegram",
            PhoneCodeExpiredError: "Код Telegram истёк. Запросите новый",
            PasswordHashInvalidError: "Неверный пароль двухэтапной проверки",
            PhoneNumberInvalidError: "Telegram отклонил номер телефона",
        }
        message = next(
            (text for kind, text in messages.items() if isinstance(exc, kind)),
            "Не удалось выполнить вход в Telegram. Проверьте реквизиты и сеть",
        )
        if isinstance(exc, FloodWaitError):
            message = f"Telegram ограничил запросы. Подождите {exc.seconds} секунд"
        raise ValueError(message) from None

    async def verify_code(self, code):
        async with self.lock:
            self._challenge("code_required")
            if not re.fullmatch(r"[0-9]{4,8}", code):
                raise ValueError("Код должен содержать 4–8 цифр")
            try:
                await asyncio.wait_for(
                    self.client.sign_in(
                        phone=self.config["telegram"]["phone"],
                        code=code,
                        phone_code_hash=self.code_hash,
                    ),
                    15,
                )
                await self._finish(self.config["telegram"])
            except SessionPasswordNeededError:
                self.state = "password_required"
                self.attempts = 0
            except Exception as exc:  # noqa: BLE001 — sanitize Telegram RPC errors
                if isinstance(exc, PhoneCodeExpiredError):
                    self.code_hash = None
                    self.state = "disconnected"
                self._error(exc)
            return self.public_state()

    async def verify_password(self, password):
        async with self.lock:
            self._challenge("password_required")
            try:
                await asyncio.wait_for(self.client.sign_in(password=password), 15)
                await self._finish(self.config["telegram"])
            except Exception as exc:  # noqa: BLE001 — never return password/SDK bodies
                self._error(exc)
            return self.public_state()

    async def logout(self):
        async with self.lock:
            self.store.set_status("online")
            if self.client is None and self.public_state()["session_saved"]:
                credentials = self.config.get("telegram")
                if not credentials:
                    raise ValueError("Telegram не подтвердил выход. Проверьте соединение")
                self.client = self._new_client(credentials["api_id"], credentials["api_hash"])
            if self.client:
                try:
                    async with asyncio.timeout(22):
                        if not self.client.is_connected():
                            await self.client.connect()
                        result = await self.client.log_out()
                        if result is False:
                            raise SetupError("Telegram не подтвердил выход")
                except Exception:  # noqa: BLE001 — do not claim logout succeeded
                    raise ValueError("Telegram не подтвердил выход. Проверьте соединение") from None
            config = copy.deepcopy(self.config)
            config.pop("telegram_session", None)
            self._save(config)
            await self._disconnect()
            self.state = "disconnected"
            self.code_hash = None
            self.last_request = 0
            return self.public_state()

    async def stop(self):
        await self._disconnect()
        if self.ai:
            await self.ai.close()
