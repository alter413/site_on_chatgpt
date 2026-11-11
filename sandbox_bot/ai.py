import copy
import json
from contextvars import ContextVar
from urllib.parse import urlsplit

import httpx

SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Поиск общих сведений в интернете. query должен быть "
        "точной подстрокой текущего входящего сообщения, до 300 символов. Не отправляй профиль.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
}


def validate_base_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.scheme not in {"https", "http"}
        or (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"})
    ):
        raise ValueError("Base URL: HTTPS без пароля/query; HTTP разрешён только для localhost")
    return value.rstrip("/")


class AIClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        search_key: str = "",
        *,
        http: httpx.AsyncClient | None = None,
    ):
        self.base_url = validate_base_url(base_url)
        self.api_key = api_key
        self.model = model
        self.search_key = search_key
        self.http = http or httpx.AsyncClient(timeout=90, follow_redirects=False)
        self.usage = ContextVar("ai_usage", default=None)
        self.max_output_units = 3500
        self.reply_style = "neutral"

    async def close(self):
        await self.http.aclose()

    async def _post(self, url, key, payload):
        async with self.http.stream(
            "POST", url, headers={"Authorization": f"Bearer {key}"}, json=payload
        ) as response:
            if response.status_code != 200:
                raise RuntimeError(f"Provider HTTP {response.status_code}")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 4 * 1024 * 1024:
                    raise RuntimeError("Ответ провайдера слишком большой")
            return json.loads(data)

    async def _completion(self, messages, tools=False):
        payload = {"model": self.model, "messages": messages, "store": False}
        if tools:
            payload["tools"] = [SEARCH_TOOL]
            payload["tool_choice"] = "auto"
            payload["parallel_tool_calls"] = False
        result = await self._post(self.base_url + "/chat/completions", self.api_key, payload)
        usage = self.usage.get()
        if usage is not None:
            raw = result.get("usage") or {}
            usage["input_tokens"] += int(raw.get("prompt_tokens") or 0)
            usage["output_tokens"] += int(raw.get("completion_tokens") or 0)
        message = result["choices"][0]["message"]
        if not isinstance(message, dict):
            raise TypeError("Некорректный формат ответа модели")
        return message

    async def answer(self, messages: list, web_enabled: bool) -> str:
        self.usage.set({"input_tokens": 0, "output_tokens": 0})
        if self.reply_style != "neutral":
            messages = copy.deepcopy(messages)
            messages.insert(
                1,
                {
                    "role": "system",
                    "content": {
                        "friendly": "Стиль ответа: дружелюбный, но без выдуманных фактов.",
                        "brief": "Стиль ответа: максимально коротко, 1–2 предложения.",
                        "formal": "Стиль ответа: сдержанный и деловой.",
                    }[self.reply_style],
                },
            )
        use_search = web_enabled and bool(self.search_key)
        message = await self._completion(messages, use_search)
        calls = message.get("tool_calls") or []
        if calls:
            if not use_search or len(calls) > 3:
                raise RuntimeError("Модель запросила недоступный инструмент")
            # A search query can only quote current input. Sandbox data cannot be added to it.
            current = ""
            for part in messages[-1].get("content", []):
                if part.get("type") == "text" and part["text"].startswith(
                    "Текущее входящее сообщение:\n"
                ):
                    current = part["text"].split("\n", 1)[1]
            followup = copy.deepcopy(messages)
            followup.append(
                {"role": "assistant", "content": message.get("content"), "tool_calls": calls}
            )
            for call in calls:
                result = {"error": "Запрос запрещён: используй подстроку текущего сообщения"}
                try:
                    function = call["function"]
                    query = json.loads(function["arguments"])["query"]
                    if (
                        function["name"] == "web_search"
                        and isinstance(query, str)
                        and 2 <= len(query) <= 300
                        and query in current
                    ):
                        raw = await self._post(
                            "https://api.tavily.com/search",
                            self.search_key,
                            {"query": query, "max_results": 3, "include_raw_content": False},
                        )
                        result = {
                            "results": [
                                {
                                    "title": str(r.get("title", ""))[:300],
                                    "url": str(r.get("url", ""))[:2000],
                                    "content": str(r.get("content", ""))[:4000],
                                }
                                for r in raw.get("results", [])[:3]
                            ]
                        }
                except (KeyError, ValueError, TypeError):
                    result = {"error": "Некорректный запрос поиска"}
                followup.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "content": json.dumps(result, ensure_ascii=False),
                    }
                )
            message = await self._completion(followup)
            if message.get("tool_calls"):
                raise RuntimeError("Лимит инструментов исчерпан")
        text = message.get("content")
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("Модель вернула пустой ответ")
        return text.strip()

    async def models(self):
        async with self.http.stream(
            "GET", self.base_url + "/models", headers={"Authorization": f"Bearer {self.api_key}"}
        ) as response:
            if response.status_code != 200:
                raise RuntimeError(f"Provider HTTP {response.status_code}")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > 2 * 1024 * 1024:
                    raise RuntimeError("Список моделей слишком большой")
            return sorted(
                {r["id"] for r in json.loads(body).get("data", []) if isinstance(r.get("id"), str)}
            )[:500]
