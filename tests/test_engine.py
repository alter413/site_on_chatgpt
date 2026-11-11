import asyncio

import pytest

from sandbox_bot.engine import Engine, Incoming
from sandbox_bot.store import Store


class AI:
    def __init__(self):
        self.requests = []
        self.started = asyncio.Event()
        self.release = None

    async def answer(self, messages, web_enabled):
        self.requests.append((messages, web_enabled))
        self.started.set()
        if self.release:
            await self.release.wait()
        return "Ответ"


def setup(tmp_path):
    store = Store(tmp_path / "state.db")
    ai = AI()
    engine = Engine(store, ai)
    sent = []

    async def send(text):
        sent.append(text)

    async def media():
        return {"text": "CURRENT FILE"}

    return store, ai, engine, sent, send, media


@pytest.mark.parametrize("case", ["disabled", "online", "group", "bot", "outgoing", "self"])
async def test_forbidden_messages_never_load_media_or_call_ai(tmp_path, case):
    store, ai, engine, sent, send, _ = setup(tmp_path)
    store.set_status("busy")
    store.update_chat(1, {"enabled": True})
    flags = {"private": True, "bot": False, "outgoing": False, "own_chat": False}
    if case == "disabled":
        store.update_chat(1, {"enabled": False})
    elif case == "online":
        store.set_status("online")
    else:
        flags[{"group": "private", "self": "own_chat"}.get(case, case)] = case != "group"

    media_loads = []

    async def forbidden():
        media_loads.append(True)
        return {}

    await engine.handle(Incoming(1, 1, "hello", **flags), forbidden, send)
    assert not ai.requests
    assert not sent
    assert not media_loads


async def test_only_current_sandbox_and_message_are_sent(tmp_path):
    store, ai, engine, sent, send, media = setup(tmp_path)
    store.set_status("offline")
    store.update_chat(1, {"enabled": True, "name": "ALLOWED"})
    store.update_chat(2, {"name": "OTHER PERSON"})
    store.add_material(1, "my note", {"text": "ALLOWED SECRET"})
    store.add_material(2, "another note", {"text": "FORBIDDEN SECRET"})
    await engine.handle(Incoming(1, 10, "CURRENT MESSAGE"), media, send)
    await engine.handle(Incoming(1, 11, "NEXT MESSAGE"), media, send)
    prompt = str(ai.requests[-1])
    assert "ALLOWED SECRET" in prompt and "NEXT MESSAGE" in prompt
    assert "CURRENT FILE" in prompt and "offline" in prompt
    assert "FORBIDDEN SECRET" not in prompt and "OTHER PERSON" not in prompt
    assert "CURRENT MESSAGE" not in prompt
    assert len(store.materials(1)) == 1
    assert sent == ["Ответ", "Ответ"]


@pytest.mark.parametrize("change", ["online", "disable", "note", "manual", "toggle"])
async def test_changes_during_generation_cancel_reply(tmp_path, change):
    store, ai, engine, sent, send, media = setup(tmp_path)
    store.set_status("busy")
    store.update_chat(1, {"enabled": True})
    ai.release = asyncio.Event()
    task = asyncio.create_task(engine.handle(Incoming(1, 10, "hi"), media, send))
    await ai.started.wait()
    if change == "online":
        store.set_status("online")
    elif change == "disable":
        store.update_chat(1, {"enabled": False})
    elif change == "note":
        store.add_material(1, "new", {"text": "updated"})
    elif change == "manual":
        store.touch(1)
    else:
        store.set_status("online")
        store.set_status("busy")
    ai.release.set()
    await task
    assert sent == []


async def test_duplicate_and_failure_are_not_resent(tmp_path):
    store, ai, engine, sent, send, media = setup(tmp_path)
    store.set_status("busy")
    store.update_chat(1, {"enabled": True})

    async def fail(text):
        raise OSError("network uncertain")

    await engine.handle(Incoming(1, 10, "hi"), media, fail)
    await engine.handle(Incoming(1, 10, "hi"), media, send)
    assert len(ai.requests) == 1
    assert not sent


async def test_utf16_limit_and_cancel_during_media(tmp_path):
    store, ai, engine, sent, send, media = setup(tmp_path)
    store.set_status("busy")
    store.update_chat(1, {"enabled": True})

    async def long_answer(*_):
        return "😀" * 3500

    ai.answer = long_answer
    await engine.handle(Incoming(1, 1, "hi"), media, send)
    assert len(sent[0].encode("utf-16-le")) <= 7000

    async def cancelled_media():
        store.set_status("online")
        return {"text": "private file"}

    await engine.handle(Incoming(1, 2, "hi"), cancelled_media, send)
    assert len(sent) == 1


async def test_corrupt_attachment_and_provider_error_never_leak(tmp_path, caplog):
    store, ai, engine, sent, send, media = setup(tmp_path)
    store.set_status("busy")
    store.update_chat(1, {"enabled": True})

    async def corrupt():
        raise ValueError("PRIVATE FILE TEXT")

    await engine.handle(Incoming(1, 1, "incoming"), corrupt, send)
    assert not ai.requests and not sent

    async def failure(*_):
        raise RuntimeError("API_KEY_MUST_NOT_LEAK")

    ai.answer = failure
    await engine.handle(Incoming(1, 2, "incoming"), media, send)
    assert not sent
    assert "PRIVATE FILE TEXT" not in caplog.text
    assert "API_KEY_MUST_NOT_LEAK" not in caplog.text
