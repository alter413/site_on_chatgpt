import asyncio
import logging
from datetime import UTC, datetime

from telethon import events

from .attachments import IMAGE_EXT, MAX_FILE, TEXT_EXT, extract
from .engine import Incoming

log = logging.getLogger(__name__)


class TelegramGateway:
    def __init__(self, client, store, engine, owner_id):
        self.client = client
        self.store = store
        self.engine = engine
        self.owner_id = owner_id
        self.started_at = datetime.now(UTC).replace(microsecond=0)
        self.sent_ids: set[tuple[int, int]] = set()
        self.sending: dict[int, asyncio.Event] = {}

    def install(self):
        self.client.add_event_handler(self.on_message, events.NewMessage())

    def connected(self):
        return self.client.is_connected()

    async def dialogs(self):
        result = []
        async for dialog in self.client.iter_dialogs():
            if dialog.is_user and dialog.id != self.owner_id and not dialog.entity.bot:
                result.append(
                    {
                        "id": dialog.id,
                        "title": dialog.name,
                        "enabled": self.store.chat(dialog.id)["enabled"],
                    }
                )
        return result

    async def load_media(self, event):
        if not event.media:
            return {}
        if not event.photo and not event.document:
            # Link previews are not extra messages and are not fetched.
            if getattr(event.message.media, "webpage", None):
                return {}
            raise ValueError("Этот тип вложения не поддерживается")
        file = event.file
        if file is None or not file.size or file.size > MAX_FILE:
            raise ValueError("Вложение слишком большое или размер неизвестен")
        name = "photo.jpg" if event.photo else (file.name or ("attachment" + (file.ext or "")))
        from pathlib import Path

        if Path(name).suffix.lower() not in TEXT_EXT | IMAGE_EXT | {".pdf", ".docx"}:
            raise ValueError("Формат вложения не поддерживается")
        data = await self.client.download_media(event.message, file=bytes)
        if not isinstance(data, bytes):
            raise TypeError("Telegram не вернул файл")
        return await asyncio.to_thread(extract, name, data)

    async def on_message(self, event):
        if (
            not event.is_private
            or not event.chat_id
            or event.chat_id == self.owner_id
            or event.chat_id <= 0
            or event.date < self.started_at
        ):
            return
        try:
            if event.out:
                pending = self.sending.get(event.chat_id)
                if pending:
                    await pending.wait()
                if (event.chat_id, event.id) not in self.sent_ids:
                    self.store.touch(event.chat_id)
                return
            sender = await event.get_sender()
            incoming = Incoming(
                event.chat_id,
                event.id,
                event.raw_text or "",
                bot=sender is None or bool(getattr(sender, "bot", False)),
            )

            async def send(text):
                finished = asyncio.Event()
                self.sending[event.chat_id] = finished
                try:
                    message = await self.client.send_message(
                        event.chat_id, text, reply_to=event.id, parse_mode=None, link_preview=False
                    )
                    self.sent_ids.add((event.chat_id, message.id))
                    if len(self.sent_ids) > 10000:
                        self.sent_ids = {(event.chat_id, message.id)}
                finally:
                    self.sending.pop(event.chat_id, None)
                    finished.set()

            await self.engine.handle(incoming, lambda: self.load_media(event), send)
        except Exception as exc:  # noqa: BLE001 — log metadata only, never SDK exception text
            log.warning(
                "Telegram event skipped chat=%s error=%s", event.chat_id, type(exc).__name__
            )
