import argparse
import asyncio
import getpass
import logging
import os
import re
import secrets
from contextlib import contextmanager
from pathlib import Path

import uvicorn
from telethon import TelegramClient

from .ai import AIClient, validate_base_url
from .api import create_api
from .console import console
from .engine import Engine
from .store import Store
from .telegram import TelegramGateway


@contextmanager
def single_instance(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    stream = (directory / "app.lock").open("a+b")
    stream.seek(0)
    stream.write(b"0")
    stream.flush()
    stream.seek(0)
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        stream.close()
        raise ValueError("Эта папка данных уже используется другим процессом") from None
    try:
        yield
    finally:
        stream.close()


def ask(label, *, secret=False, default=""):
    while True:
        prompt = label + (f" [{default}]" if default else "") + ": "
        value = (getpass.getpass(prompt) if secret else input(prompt)).strip() or default
        if value:
            return value


async def run(args):
    directory = args.data_dir.resolve()
    token = os.environ.get("SANDBOX_ADMIN_TOKEN", "")
    if not token:
        token = getpass.getpass("Токен управления (Enter — сгенерировать): ").strip()
        if not token:
            token = secrets.token_urlsafe(32)
            print("Сохраните токен управления, он показан один раз:", token)
    if len(token) < 24:
        raise ValueError("Токен управления: минимум 24 символа")
    client = None
    ai = None
    store = None
    tasks = []
    with single_instance(directory):
        try:
            store = Store(directory / "state.sqlite3")
            store.set_status("online")
            gateway = None
            if not args.api_only:
                api_id = int(ask("Telegram API ID"))
                api_hash = ask("Telegram API hash", secret=True)
                if api_id <= 0 or not re.fullmatch(r"[0-9a-fA-F]{32}", api_hash):
                    raise ValueError("Неверные Telegram API ID/hash")
                base_url = validate_base_url(
                    ask(
                        "AI Base URL (с /v1 если требуется)",
                        default=store.settings().get("base_url", ""),
                    )
                )
                key = ask("AI API key (для локальной модели можно local)", secret=True)
                model = ask("AI model", default=store.settings().get("model", ""))
                search_key = getpass.getpass("Tavily API key (Enter — без интернета): ").strip()
                ai = AIClient(base_url, key, model, search_key)
                saved = store.settings()
                for field in ("reply_style", "max_output_units"):
                    if field in saved:
                        setattr(ai, field, saved[field])
                client = TelegramClient(
                    str(directory / "telegram"),
                    api_id,
                    api_hash,
                    flood_sleep_threshold=0,
                    request_retries=0,
                    catch_up=False,
                )
                await client.start(
                    phone=lambda: ask("Телефон Telegram (+...)"),
                    code_callback=lambda: ask("Код входа Telegram", secret=True),
                    password=lambda: ask("Пароль Telegram 2FA", secret=True),
                )
                owner = await client.get_me()
                if owner.bot:
                    raise ValueError("Нужен личный Telegram-аккаунт, а не bot token")
                gateway = TelegramGateway(client, store, Engine(store, ai), owner.id)
                gateway.install()
                print(f"Telegram подключён, ID владельца: {owner.id}. Статус: online.")
            app = create_api(store, token, gateway, ai=ai)
            server = uvicorn.Server(
                uvicorn.Config(
                    app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False
                )
            )
            api_task = asyncio.create_task(server.serve())
            tasks.append(api_task)
            if not args.no_console:
                tasks.append(asyncio.create_task(console(store, gateway)))
            if client:
                tasks.append(asyncio.ensure_future(client.run_until_disconnected()))
            print(f"Management API: http://127.0.0.1:{args.port}/api/v1")
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            server.should_exit = True
            # Surface startup/runtime failures without provider response bodies or secrets.
            for task in done:
                task.result()
            if api_task not in done:
                await api_task
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            if client:
                await client.disconnect()
            if ai:
                await ai.close()
            if store:
                store.close()


def main():
    parser = argparse.ArgumentParser(description="Telegram AI с песочницей для каждого чата")
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--api-only", action="store_true", help="API без входа в Telegram и AI")
    parser.add_argument("--no-console", action="store_true", help="Управлять только через API")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port должен быть 1–65535")
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s %(message)s")
    logging.getLogger("telethon").setLevel(logging.ERROR)
    try:
        asyncio.run(run(args))
    except (KeyboardInterrupt, EOFError):
        pass
    except ValueError as exc:
        print(f"Ошибка настройки: {exc}")
        raise SystemExit(1) from None
    except Exception as exc:  # noqa: BLE001 — do not print SDK exceptions containing secrets
        print(f"Запуск остановлен: {type(exc).__name__}. Проверьте сеть и реквизиты.")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
