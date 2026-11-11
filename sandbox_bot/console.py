import asyncio
import json
import shlex
import threading
from pathlib import Path

from .attachments import MAX_FILE, extract

HELP = """
dialogs                          — личные чаты Telegram: название и ID
chats                            — настроенные песочницы
status online|offline|busy|unavailable
enable ID / disable ID           — разрешить/запретить автоответ
profile ID name "Имя"             — имя для этой песочницы
profile ID age 25                 — возраст (null — удалить)
profile ID location "Город"        — местонахождение
note ID "Текст о себе"            — добавить заметку
upload ID "C:\\path\\file.pdf"     — загрузить материал в песочницу
show ID                          — профиль и список материалов
remove ID MATERIAL_ID            — удалить материал
web ID on|off                    — разрешить/запретить интернет
help / quit
"""


def split_command(line):
    lexer = shlex.shlex(line, posix=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    lexer.escape = ""
    return list(lexer)


async def execute(line, store, telegram=None):
    args = split_command(line)
    if not args:
        return None
    command, *values = args
    if command == "quit" and not values:
        return "quit"
    if command == "help":
        return HELP
    if command == "status" and len(values) == 1:
        store.set_status(values[0])
        return store.status()
    if command == "chats":
        return store.chats()
    if command == "dialogs":
        if telegram is None:
            raise ValueError("Telegram не подключён в --api-only")
        return await telegram.dialogs()
    if not values:
        raise ValueError("Неизвестная команда. help — справка")
    chat_id = int(values[0])
    if chat_id <= 0:
        raise ValueError("Нужен положительный ID личного чата")
    if command in {"enable", "disable"} and len(values) == 1:
        return store.update_chat(chat_id, {"enabled": command == "enable"})
    if command == "web" and len(values) == 2 and values[1] in {"on", "off"}:
        return store.update_chat(chat_id, {"web_enabled": values[1] == "on"})
    if command == "profile" and len(values) == 3:
        key, value = values[1:]
        if key not in {"name", "age", "location"}:
            raise ValueError("Поля профиля: name, age, location")
        if key == "age":
            value = None if value == "null" else int(value)
        return store.update_chat(chat_id, {key: value})
    if command == "note" and len(values) == 2:
        if not values[1].strip() or len(values[1]) > 100_000:
            raise ValueError("Заметка: 1–100000 символов")
        return {"id": store.add_material(chat_id, "Заметка", {"text": values[1]})}
    if command == "upload" and len(values) == 2:
        path = Path(values[1]).expanduser()
        if path.stat().st_size > MAX_FILE:
            raise ValueError("Файл больше 8 МБ")

        def read():
            with path.open("rb") as stream:
                return extract(path.name, stream.read(MAX_FILE + 1))

        content = await asyncio.to_thread(read)
        return {"id": store.add_material(chat_id, path.name, content)}
    if command == "show" and len(values) == 1:
        return {
            "profile": store.chat(chat_id),
            "materials": [
                {"id": m["id"], "title": m["title"], "type": list(m["content"])}
                for m in store.materials(chat_id)
            ],
        }
    if command == "remove" and len(values) == 2:
        return {"deleted": store.delete_material(chat_id, int(values[1]))}
    raise ValueError("Неверная команда или число аргументов. help — справка")


async def console(store, telegram=None):
    """A daemon reader avoids blocking shutdown on Windows console input."""
    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def reader():
        while True:
            try:
                line = input("sandbox> ")
            except (EOFError, OSError):
                line = "quit"
            try:
                loop.call_soon_threadsafe(queue.put_nowait, line)
            except RuntimeError:
                return
            if line.strip() == "quit":
                return

    print(HELP)
    threading.Thread(target=reader, daemon=True).start()
    while True:
        line = await queue.get()
        try:
            result = await execute(line, store, telegram)
            if result == "quit":
                return
            if result is not None:
                print(
                    result
                    if isinstance(result, str)
                    else json.dumps(result, ensure_ascii=False, indent=2)
                )
        except Exception as exc:  # noqa: BLE001 — keep console alive and redact provider errors
            if isinstance(exc, (ValueError, OSError)):
                print(f"Ошибка: {exc}")
            else:
                print(f"Ошибка: {type(exc).__name__}")
