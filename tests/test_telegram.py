from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from sandbox_bot.store import Store
from sandbox_bot.telegram import TelegramGateway


class FakeClient:
    def __init__(self):
        self.downloads = 0

    async def download_media(self, message, file):
        self.downloads += 1
        return b"hello file"


class FakeEngine:
    def __init__(self):
        self.items = []

    async def handle(self, incoming, media, send):
        self.items.append((incoming, await media()))


def event(**fields):
    result = {
        "id": 1,
        "chat_id": 42,
        "is_private": True,
        "out": False,
        "raw_text": "hello",
        "date": datetime.now(UTC),
        "media": None,
        "document": None,
        "photo": None,
        "file": None,
        "grouped_id": None,
    }
    result.update(fields)
    item = SimpleNamespace(**result)
    item.message = item

    async def sender():
        return SimpleNamespace(bot=False)

    item.get_sender = sender
    return item


async def test_adapter_drops_old_groups_and_self(tmp_path):
    store = Store(tmp_path / "state.db")
    engine = FakeEngine()
    gateway = TelegramGateway(FakeClient(), store, engine, 99)
    for item in [
        event(is_private=False),
        event(chat_id=99),
        event(date=datetime.now(UTC) - timedelta(days=1)),
    ]:
        await gateway.on_message(item)
    assert engine.items == []
    await gateway.on_message(event())
    assert engine.items[0][0].text == "hello"


async def test_outgoing_invalidates_without_ai(tmp_path):
    store = Store(tmp_path / "state.db")
    engine = FakeEngine()
    gateway = TelegramGateway(FakeClient(), store, engine, 99)
    before = store.snapshot(42)
    await gateway.on_message(event(out=True))
    assert store.snapshot(42) != before
    assert not engine.items


async def test_media_preflight_does_not_download_unsupported_or_large(tmp_path):
    store = Store(tmp_path / "state.db")
    client = FakeClient()
    gateway = TelegramGateway(client, store, FakeEngine(), 99)
    import pytest

    for name, size in [("bad.exe", 10), ("big.txt", 20_000_000)]:
        item = event(
            media=True, document=True, file=SimpleNamespace(name=name, size=size, ext=".txt")
        )
        with pytest.raises(ValueError):
            await gateway.load_media(item)
    assert client.downloads == 0
