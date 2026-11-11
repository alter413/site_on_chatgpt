import httpx
import pytest

from sandbox_bot.api import create_api
from sandbox_bot.store import Store


@pytest.fixture
def app(tmp_path):
    store = Store(tmp_path / "state.db")
    app = create_api(store, "test-token-which-is-long-enough")
    yield app
    store.close()


async def test_auth_and_management(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as c:
        assert (await c.get("/api/v1/chats")).status_code == 401
        assert (await c.get("/openapi.json")).status_code == 401
        c.headers["Authorization"] = "Bearer wrong"
        assert (await c.put("/api/v1/status", json={"status": "busy"})).status_code == 401
        c.headers["Authorization"] = "Bearer test-token-which-is-long-enough"
        assert (await c.put("/api/v1/status", json={"status": "busy"})).json()["status"] == "busy"
        assert (
            await c.patch("/api/v1/chats/42", json={"enabled": True, "name": "Me"})
        ).status_code == 200
        assert (await c.get("/api/v1/chats/42")).json()["name"] == "Me"
        item = (
            await c.post("/api/v1/chats/42/materials", json={"title": "note", "text": "secret"})
        ).json()
        assert (await c.get("/api/v1/chats/43/materials")).json() == []
        assert (await c.delete(f"/api/v1/chats/43/materials/{item['id']}")).status_code == 404
        assert (await c.delete(f"/api/v1/chats/42/materials/{item['id']}")).status_code == 204
        assert (await c.get("/openapi.json")).status_code == 200


async def test_validation_upload_and_no_cors(app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url="http://test",
        headers={"Authorization": "Bearer test-token-which-is-long-enough"},
    ) as c:
        for payload in [{"age": -1}, {"name": "x" * 501}, {"extra": "bad"}, {"enabled": "yes"}]:
            assert (await c.patch("/api/v1/chats/1", json=payload)).status_code == 422
        assert (await c.patch("/api/v1/chats/-100", json={"enabled": True})).status_code == 422
        result = await c.post("/api/v1/chats/1/files", files={"file": ("../note.txt", b"hello")})
        assert result.status_code == 201
        result = await c.post("/api/v1/chats/1/files", files={"file": ("bad.exe", b"MZ")})
        assert result.status_code == 422
        result = await c.options(
            "/api/v1/chats",
            headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "GET"},
        )
        assert "access-control-allow-origin" not in result.headers


async def test_body_limit_and_auth_before_file_parsing(app):
    from sandbox_bot.api import MAX_REQUEST

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as c:
        result = await c.post(
            "/api/v1/chats/1/files",
            content=b"x" * (MAX_REQUEST + 1),
            headers={"Content-Type": "multipart/form-data; boundary=bad"},
        )
        assert result.status_code == 401
        c.headers["Authorization"] = "Bearer test-token-which-is-long-enough"
        result = await c.post("/api/v1/chats/1/files", content=b"x" * (MAX_REQUEST + 1))
        assert result.status_code == 413
