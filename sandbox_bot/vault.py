import json
import os
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class Vault:
    """Encrypted local credentials; the host filesystem must also protect the key file."""

    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "config.enc"
        self.key_path = directory / "vault.key"
        key = os.environ.get("SOVA_VAULT_KEY")
        if key:
            try:
                key = key.encode("ascii")
            except UnicodeError:
                raise ValueError("Неверный ключ зашифрованного хранилища") from None
        elif self.key_path.exists():
            key = self.key_path.read_bytes()
        else:
            if self.path.exists():
                raise ValueError("Потерян ключ: зашифрованное хранилище не изменено")
            key = Fernet.generate_key()
            descriptor = os.open(self.key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(key)
        try:
            self.cipher = Fernet(key)
        except (ValueError, TypeError):
            raise ValueError("Неверный ключ: хранилище не изменено") from None

    def load(self):
        if not self.path.exists():
            return {}
        try:
            data = json.loads(self.cipher.decrypt(self.path.read_bytes()))
            if not isinstance(data, dict):
                raise TypeError()
            return data
        except (InvalidToken, ValueError, TypeError):
            raise ValueError("Не удалось открыть зашифрованное хранилище; проверьте ключ") from None

    def save(self, data: dict):
        encrypted = self.cipher.encrypt(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(encrypted)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
