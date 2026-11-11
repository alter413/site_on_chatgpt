import json
import secrets
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

STATUSES = {"online", "offline", "busy", "unavailable"}
CHAT_FIELDS = {"enabled", "name", "age", "location", "web_enabled"}
MAX_CONTEXT = 200_000


class Store:
    """Used on the single application event loop; no network operations in transactions."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS state (
                id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL, revision INTEGER NOT NULL);
            INSERT OR IGNORE INTO state VALUES (1, 'online', 0);
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL DEFAULT '', age INTEGER, location TEXT NOT NULL DEFAULT '',
                web_enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS materials (
                id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL REFERENCES chats(id),
                title TEXT NOT NULL, content TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS processed (
                chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
                PRIMARY KEY(chat_id, message_id));
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY, at TEXT NOT NULL, chat_id INTEGER,
                outcome TEXT NOT NULL, reason TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
                model TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS events_at ON events(at);
            CREATE TABLE IF NOT EXISTS auth_attempts (
                key TEXT PRIMARY KEY, started INTEGER NOT NULL, attempts INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS owner_sessions (
                digest TEXT PRIMARY KEY, version TEXT NOT NULL, created INTEGER NOT NULL,
                expires INTEGER NOT NULL);
        """)

    def close(self):
        self.db.close()

    def auth_attempt(self, key: str, *, now=None):
        now = int(time.time()) if now is None else now
        with self.db:
            self.db.execute("DELETE FROM auth_attempts WHERE started <= ?", (now - 900,))
            row = self.db.execute(
                "SELECT attempts FROM auth_attempts WHERE key=?", (key,)
            ).fetchone()
            if row:
                if row[0] >= 10:
                    return False
                self.db.execute("UPDATE auth_attempts SET attempts=attempts+1 WHERE key=?", (key,))
            else:
                if self.db.execute("SELECT COUNT(*) FROM auth_attempts").fetchone()[0] >= 10000:
                    return False
                self.db.execute("INSERT INTO auth_attempts VALUES (?,?,1)", (key, now))
            return True

    def create_session(self, digest: str, version: str, *, now=None):
        now = int(time.time()) if now is None else now
        with self.db:
            self.db.execute(
                "DELETE FROM owner_sessions WHERE expires<=? OR version!=?", (now, version)
            )
            self.db.execute(
                "INSERT OR REPLACE INTO owner_sessions VALUES (?,?,?,?)",
                (digest, version, now, now + 8 * 3600),
            )
            self.db.execute(
                "DELETE FROM owner_sessions WHERE digest NOT IN "
                "(SELECT digest FROM owner_sessions ORDER BY created DESC,rowid DESC LIMIT 64)"
            )

    def check_session(self, digest: str, version: str, *, now=None):
        now = int(time.time()) if now is None else now
        row = self.db.execute(
            "SELECT version,expires FROM owner_sessions WHERE digest=?", (digest,)
        ).fetchone()
        return bool(row and row[1] > now and secrets.compare_digest(row[0], version))

    def revoke_session(self, digest: str):
        with self.db:
            self.db.execute("DELETE FROM owner_sessions WHERE digest=?", (digest,))

    def status(self):
        return dict(self.db.execute("SELECT status, revision FROM state WHERE id=1").fetchone())

    def set_status(self, status: str):
        if status not in STATUSES:
            raise ValueError("Допустимые статусы: online, offline, busy, unavailable")
        with self.db:
            self.db.execute("UPDATE state SET status=?, revision=revision+1 WHERE id=1", (status,))

    def chat(self, chat_id: int):
        row = self.db.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
        if row is None:
            return {
                "id": chat_id,
                "enabled": False,
                "name": "",
                "age": None,
                "location": "",
                "web_enabled": False,
                "revision": 0,
            }
        result = dict(row)
        result["enabled"] = bool(result["enabled"])
        result["web_enabled"] = bool(result["web_enabled"])
        return result

    def chats(self):
        ids = self.db.execute("SELECT id FROM chats ORDER BY id").fetchall()
        return [self.chat(row[0]) for row in ids]

    def _ensure(self, chat_id: int):
        if chat_id <= 0:
            raise ValueError("Нужен положительный ID личного чата")
        self.db.execute("INSERT OR IGNORE INTO chats(id) VALUES (?)", (chat_id,))

    def touch(self, chat_id: int):
        with self.db:
            self._ensure(chat_id)
            self.db.execute("UPDATE chats SET revision=revision+1 WHERE id=?", (chat_id,))

    def update_chat(self, chat_id: int, fields: dict):
        if not fields.keys() <= CHAT_FIELDS:
            raise ValueError("Неизвестное поле профиля")
        for key, value in fields.items():
            if key in {"enabled", "web_enabled"} and type(value) is not bool:
                raise ValueError("Ожидалось логическое значение")
            if (
                key == "age"
                and value is not None
                and (type(value) is not int or not 0 <= value <= 150)
            ):
                raise ValueError("Возраст: 0–150 или null")
            if key in {"name", "location"} and (not isinstance(value, str) or len(value) > 500):
                raise ValueError("Имя/местонахождение: до 500 символов")
        with self.db:
            self._ensure(chat_id)
            for key, value in fields.items():
                self.db.execute(f"UPDATE chats SET {key}=? WHERE id=?", (value, chat_id))
            self.db.execute("UPDATE chats SET revision=revision+1 WHERE id=?", (chat_id,))
        return self.chat(chat_id)

    def materials(self, chat_id: int):
        rows = self.db.execute(
            "SELECT id,title,content FROM materials WHERE chat_id=? ORDER BY id", (chat_id,)
        )
        return [
            {"id": r["id"], "title": r["title"], "content": json.loads(r["content"])} for r in rows
        ]

    def add_material(self, chat_id: int, title: str, content: dict):
        encoded = json.dumps(content, ensure_ascii=False)
        if not title.strip() or len(title) > 200:
            raise ValueError("Заголовок: 1–200 символов")
        with self.db:
            self._ensure(chat_id)
            used = self.db.execute(
                "SELECT COALESCE(SUM(length(content)),0) FROM materials WHERE chat_id=?", (chat_id,)
            ).fetchone()[0]
            if used + len(encoded) > MAX_CONTEXT:
                raise ValueError("Песочница заполнена: максимум 200000 символов с изображениями")
            cursor = self.db.execute(
                "INSERT INTO materials(chat_id,title,content) VALUES (?,?,?)",
                (chat_id, title, encoded),
            )
            self.db.execute("UPDATE chats SET revision=revision+1 WHERE id=?", (chat_id,))
            return cursor.lastrowid

    def delete_material(self, chat_id: int, material_id: int):
        with self.db:
            cursor = self.db.execute(
                "DELETE FROM materials WHERE chat_id=? AND id=?", (chat_id, material_id)
            )
            if cursor.rowcount:
                self.db.execute("UPDATE chats SET revision=revision+1 WHERE id=?", (chat_id,))
            return bool(cursor.rowcount)

    def snapshot(self, chat_id: int):
        return self.status()["revision"], self.chat(chat_id)["revision"]

    def claim(self, chat_id: int, message_id: int):
        with self.db:
            cursor = self.db.execute(
                "INSERT OR IGNORE INTO processed VALUES (?,?)", (chat_id, message_id)
            )
            return bool(cursor.rowcount)

    def save_settings(self, values: dict):
        with self.db:
            for key, value in values.items():
                self.db.execute(
                    "INSERT OR REPLACE INTO settings VALUES (?,?)",
                    (key, json.dumps(value, ensure_ascii=False)),
                )
            self.db.execute("UPDATE state SET revision=revision+1 WHERE id=1")

    def settings(self):
        return {r[0]: json.loads(r[1]) for r in self.db.execute("SELECT key,value FROM settings")}

    def record_event(
        self,
        chat_id: int | None,
        outcome: str,
        *,
        reason="",
        duration_ms=0,
        input_tokens=0,
        output_tokens=0,
        model="",
    ):
        with self.db:
            self.db.execute(
                "INSERT INTO events(at,chat_id,outcome,reason,duration_ms,"
                "input_tokens,output_tokens,model) VALUES (?,?,?,?,?,?,?,?)",
                (
                    datetime.now(UTC).isoformat(),
                    chat_id,
                    outcome,
                    reason[:100],
                    max(0, int(duration_ms)),
                    max(0, int(input_tokens)),
                    max(0, int(output_tokens)),
                    model[:200],
                ),
            )
            self.db.execute("DELETE FROM events WHERE id < (SELECT MAX(id)-20000 FROM events)")

    def activity(self, limit=50, before=None):
        rows = self.db.execute(
            "SELECT * FROM events WHERE id < ? ORDER BY id DESC LIMIT ?",
            (before or 2**63 - 1, min(200, max(1, limit))),
        )
        return [dict(r) for r in rows]

    def dashboard(self, days=7):
        today = datetime.now(UTC).date()
        dates = [(today - timedelta(days=n)).isoformat() for n in reversed(range(days))]
        rows = [dict(r) for r in self.db.execute("SELECT * FROM events WHERE at >= ?", (dates[0],))]
        totals = {
            k: sum(r["outcome"] == k for r in rows)
            for k in ("replied", "failed", "skipped", "cancelled")
        }
        totals["tokens"] = sum(r["input_tokens"] + r["output_tokens"] for r in rows)
        totals["input_tokens"] = sum(r["input_tokens"] for r in rows)
        totals["output_tokens"] = sum(r["output_tokens"] for r in rows)
        replied = [r for r in rows if r["outcome"] == "replied"]
        totals["avg_latency_ms"] = (
            round(sum(r["duration_ms"] for r in replied) / len(replied)) if replied else 0
        )
        attempts = totals["replied"] + totals["failed"]
        totals["success_rate"] = round(100 * totals["replied"] / attempts, 1) if attempts else None
        daily = [
            {
                "date": d,
                **{
                    k: sum(r["at"][:10] == d and r["outcome"] == k for r in rows)
                    for k in ("replied", "failed", "skipped", "cancelled")
                },
            }
            for d in dates
        ]
        hourly = [
            {"hour": h, "count": sum(int(r["at"][11:13]) == h for r in rows)} for h in range(24)
        ]
        chats = self.chats()
        context = []
        for chat in chats:
            size = self.db.execute(
                "SELECT COALESCE(SUM(length(content)),0),COUNT(*) FROM materials WHERE chat_id=?",
                (chat["id"],),
            ).fetchone()
            context.append(
                {
                    "chat_id": chat["id"],
                    "characters": size[0],
                    "materials": size[1],
                    "limit": MAX_CONTEXT,
                }
            )
        return {
            "days": days,
            "timezone": "UTC",
            "totals": totals,
            "daily": daily,
            "hourly": hourly,
            "enabled_chats": sum(c["enabled"] for c in chats),
            "total_chats": len(chats),
            "context": context,
            "retention_limit": 20000,
        }
