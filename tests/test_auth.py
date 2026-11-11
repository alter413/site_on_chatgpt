import hashlib

import httpx

from sandbox_bot.api import create_api
from sandbox_bot.store import Store


async def test_rate_limit_and_session_persist_and_revoke(tmp_path):
    path = tmp_path / "state.db"
    store = Store(path)
    app = create_api(store, "auth-backend-token-long-enough")
    headers = {"Authorization": "Bearer auth-backend-token-long-enough"}
    digest = hashlib.sha256(b"session-secret").hexdigest()
    version = hashlib.sha256(b"credential-version").hexdigest()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test", headers=headers
    ) as client:
        assert (
            await client.post(
                "/api/v1/auth/session/create", json={"digest": digest, "version": version}
            )
        ).status_code == 200
        assert (
            await client.post(
                "/api/v1/auth/session/check", json={"digest": digest, "version": version}
            )
        ).json()["valid"]
        assert not (
            await client.post(
                "/api/v1/auth/session/check", json={"digest": digest, "version": "a" * 64}
            )
        ).json()["valid"]
        for _ in range(10):
            assert (
                await client.post("/api/v1/auth/attempt", json={"key": "b" * 64})
            ).status_code == 200
        assert (
            await client.post("/api/v1/auth/attempt", json={"key": "b" * 64})
        ).status_code == 429
    store.close()
    store = Store(path)
    app = create_api(store, "auth-backend-token-long-enough")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test", headers=headers
    ) as client:
        assert (
            await client.post(
                "/api/v1/auth/session/check", json={"digest": digest, "version": version}
            )
        ).json()["valid"]
        assert (
            await client.post("/api/v1/auth/attempt", json={"key": "b" * 64})
        ).status_code == 429
        await client.post(
            "/api/v1/auth/session/revoke", json={"digest": digest, "version": version}
        )
        assert not (
            await client.post(
                "/api/v1/auth/session/check", json={"digest": digest, "version": version}
            )
        ).json()["valid"]
        assert (
            await client.post(
                "/api/v1/auth/session/create", json={"digest": "bad", "version": version}
            )
        ).status_code == 422
    store.close()


def test_expired_sessions_and_rate_windows(tmp_path):
    store = Store(tmp_path / "state.db")
    for _ in range(10):
        assert store.auth_attempt("a" * 64, now=1000)
    assert not store.auth_attempt("a" * 64, now=1001)
    assert store.auth_attempt("a" * 64, now=1901)
    store.create_session("b" * 64, "c" * 64, now=1000)
    assert store.check_session("b" * 64, "c" * 64, now=1001)
    assert not store.check_session("b" * 64, "c" * 64, now=1000 + 8 * 3600)
