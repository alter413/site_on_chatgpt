import pytest

from sandbox_bot.console import execute, split_command
from sandbox_bot.main import single_instance
from sandbox_bot.store import Store


def test_windows_paths_keep_backslashes():
    assert split_command('upload 42 "C:\\My Files\\note.txt"') == [
        "upload",
        "42",
        "C:\\My Files\\note.txt",
    ]


async def test_console_workflow(tmp_path):
    store = Store(tmp_path / "state.db")
    await execute("enable 42", store)
    await execute('profile 42 name "Марк"', store)
    await execute("profile 42 age 25", store)
    await execute('profile 42 location "Москва"', store)
    await execute('note 42 "Не могу сейчас ответить"', store)
    path = tmp_path / "note with spaces.txt"
    path.write_text("owner facts", encoding="utf-8")
    await execute(f'upload 42 "{path}"', store)
    await execute("web 42 on", store)
    await execute("status unavailable", store)
    view = await execute("show 42", store)
    assert view["profile"]["name"] == "Марк" and view["profile"]["age"] == 25
    assert len(view["materials"]) == 2
    await execute(f"remove 42 {view['materials'][0]['id']}", store)
    await execute("disable 42", store)
    assert not store.chat(42)["enabled"]
    assert store.status()["status"] == "unavailable"
    with pytest.raises(ValueError):
        await execute("profile 42 enabled true", store)
    with pytest.raises(ValueError):
        await execute("dialogs", store)


def test_single_instance_lock(tmp_path):
    with single_instance(tmp_path), pytest.raises(ValueError, match="другим процессом"):  # noqa: SIM117 — two distinct lock acquisitions
        with single_instance(tmp_path):
            pytest.fail("second instance must be rejected")
    with single_instance(tmp_path):
        pass
