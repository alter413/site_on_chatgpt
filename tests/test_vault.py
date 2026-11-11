import pytest

from sandbox_bot.vault import Vault


def test_encrypted_persistence_and_no_raw_secrets(tmp_path):
    vault = Vault(tmp_path)
    vault.save(
        {"api_hash": "private-hash", "api_key": "private-ai-key", "session": "private-session"}
    )
    assert b"private-hash" not in (tmp_path / "config.enc").read_bytes()
    assert b"private-ai-key" not in (tmp_path / "config.enc").read_bytes()
    assert Vault(tmp_path).load()["session"] == "private-session"


def test_corrupt_vault_does_not_overwrite_saved_data(tmp_path):
    vault = Vault(tmp_path)
    vault.save({"secret": "private"})
    (tmp_path / "config.enc").write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="хранилище"):
        Vault(tmp_path).load()
    assert (tmp_path / "config.enc").read_bytes() == b"corrupt"
