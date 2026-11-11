import httpx

from sandbox_bot.ai import AIClient
from sandbox_bot.api import create_api
from sandbox_bot.store import Store


async def test_settings_are_write_only_for_keys_and_invalidate_generation(tmp_path):
    store = Store(tmp_path / "state.db")
    ai = AIClient("https://example.org/v1", "original-secret", "model-a")
    app = create_api(store, "dashboard-token-more-than-24", ai=ai)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app),
        base_url="http://test",
        headers={"Authorization": "Bearer dashboard-token-more-than-24"},
    ) as c:
        settings = (await c.get("/api/v1/settings")).json()
        assert settings["model"] == "model-a"
        assert "original-secret" not in str(settings)
        before = store.snapshot(1)
        result = await c.patch(
            "/api/v1/settings", json={"model": "model-b", "api_key": "new-secret"}
        )
        assert result.status_code == 200
        assert result.json()["model"] == "model-b"
        assert "new-secret" not in result.text
        assert ai.api_key == "new-secret"
        assert store.snapshot(1) != before
        bad = await c.patch("/api/v1/settings", json={"base_url": "file:///tmp"})
        assert bad.status_code == 422
        assert ai.base_url == "https://example.org/v1"
        bad = await c.patch("/api/v1/settings", json={"base_url": "https://other.example/v1"})
        assert bad.status_code == 422
        assert ai.base_url == "https://example.org/v1"
        assert "new-secret" not in str(store.settings())
    await ai.close()


async def test_real_counters_and_no_message_text(tmp_path):
    store = Store(tmp_path / "state.db")
    store.update_chat(42, {"enabled": True})
    store.record_event(42, "replied", duration_ms=1000, input_tokens=200, output_tokens=20)
    store.record_event(42, "failed", duration_ms=500)
    store.record_event(42, "skipped", reason="online")
    stats = store.dashboard(7)
    assert stats["totals"]["replied"] == 1
    assert stats["totals"]["failed"] == 1
    assert stats["totals"]["tokens"] == 220
    assert len(stats["daily"]) == 7
    assert sum(x["replied"] for x in stats["daily"]) == 1
    assert stats["enabled_chats"] == 1
    assert "text" not in str(store.activity())
