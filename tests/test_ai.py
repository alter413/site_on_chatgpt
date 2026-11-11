import json

import httpx
import pytest

from sandbox_bot.ai import AIClient, validate_base_url


def response(content=None, calls=None):
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": content,
                    **({"tool_calls": calls} if calls else {}),
                }
            }
        ]
    }


def test_url_validation():
    assert validate_base_url("https://example.com/v1/") == "https://example.com/v1"
    assert validate_base_url("http://localhost:1234/v1")
    for url in ["http://example.com", "https://a:b@example.com", "file:///tmp", "https://x?key=x"]:
        with pytest.raises(ValueError):
            validate_base_url(url)


async def test_stateless_multimodal_request_and_auth():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=response("hello"))

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    ai = AIClient("https://provider.test/v1", "secret", "vision", http=http)
    messages = [
        {
            "role": "user",
            "content": [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}}],
        }
    ]
    assert await ai.answer(messages, False) == "hello"
    payload = json.loads(seen[0].content)
    assert payload["messages"] == messages and payload["store"] is False
    assert "tools" not in payload
    assert seen[0].headers["authorization"] == "Bearer secret"
    assert str(seen[0].url) == "https://provider.test/v1/chat/completions"
    await http.aclose()


@pytest.mark.parametrize("query,search_count", [("weather Moscow", 1), ("SANDBOX SECRET", 0)])
async def test_web_cannot_send_sandbox_facts(query, search_count):
    seen = []
    completions = 0

    def handler(request):
        nonlocal completions
        seen.append(request)
        if request.url.host == "api.tavily.com":
            return httpx.Response(
                200,
                json={
                    "results": [
                        {"title": "Weather", "url": "https://example.org", "content": "Sunny"}
                    ]
                },
            )
        completions += 1
        if completions == 1:
            return httpx.Response(
                200,
                json=response(
                    calls=[
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "web_search",
                                "arguments": json.dumps({"query": query}),
                            },
                        }
                    ]
                ),
            )
        return httpx.Response(200, json=response("done"))

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    ai = AIClient("https://provider.test/v1", "key", "model", "tavily", http=http)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "SANDBOX SECRET"},
                {
                    "type": "text",
                    "text": "Текущее входящее сообщение:\nPlease search weather Moscow",
                },
            ],
        }
    ]
    assert await ai.answer(messages, True) == "done"
    assert sum(r.url.host == "api.tavily.com" for r in seen) == search_count
    assert len(messages) == 1
    await http.aclose()


async def test_provider_failure_not_retried():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(429, text="secret provider details")

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    ai = AIClient("https://provider.test", "key", "model", http=http)
    with pytest.raises(RuntimeError, match="429") as exc:
        await ai.answer([], False)
    assert "secret provider" not in str(exc.value)
    assert len(seen) == 1
    await http.aclose()
