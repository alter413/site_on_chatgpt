import pytest

from sandbox_bot.store import Store


def test_defaults_and_persistent_isolation(tmp_path):
    path = tmp_path / "state.db"
    store = Store(path)
    assert store.status()["status"] == "online"
    assert not store.chat(1)["enabled"]
    store.update_chat(1, {"name": "Alice", "enabled": True})
    store.add_material(1, "secret", {"text": "only Alice knows"})
    assert store.chat(2)["name"] == ""
    assert store.materials(2) == []
    store.close()
    store = Store(path)
    assert store.chat(1)["name"] == "Alice"
    assert store.materials(1)[0]["content"]["text"] == "only Alice knows"
    store.close()


def test_revision_invalidates_pending_work(tmp_path):
    store = Store(tmp_path / "state.db")
    store.update_chat(1, {"enabled": True})
    before = store.snapshot(1)
    store.set_status("busy")
    assert store.snapshot(1) != before
    before = store.snapshot(1)
    store.add_material(1, "note", {"text": "x"})
    assert store.snapshot(1) != before
    before = store.snapshot(1)
    store.touch(1)
    assert store.snapshot(1) != before


def test_material_delete_is_scoped_and_dedup_persists(tmp_path):
    store = Store(tmp_path / "state.db")
    item = store.add_material(1, "note", {"text": "x"})
    assert not store.delete_material(2, item)
    assert store.delete_material(1, item)
    assert store.claim(1, 10)
    assert not store.claim(1, 10)
    assert store.claim(2, 10)


def test_invalid_update_and_budget(tmp_path):
    store = Store(tmp_path / "state.db")
    with pytest.raises(ValueError):
        store.update_chat(1, {"enabled": True, "unknown": "bad"})
    assert not store.chat(1)["enabled"]
    with pytest.raises(ValueError):
        store.add_material(1, "huge", {"text": "x" * 210_000})
