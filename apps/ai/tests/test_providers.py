import asyncio
import json
import unittest
from uuid import uuid4
import httpx
from ferweb_ai.providers import OpenAIProvider, OllamaProvider
from ferweb_ai.models import Generation, ProviderError
from ferweb_ai.app import create_app


def generation(provider="openai"):
    return Generation(id=str(uuid4()), provider=provider, model="allowed-model",
                      messages=[{"role": "user", "content": "test"}], maxOutputTokens=256)


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelling_a_pending_provider_read_closes_the_http_stream(self):
        class TrackedStream(httpx.AsyncByteStream):
            closed = False
            async def __aiter__(self):
                yield b'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
                await asyncio.sleep(60)
            async def aclose(self):
                self.closed = True
        stream = TrackedStream()
        async def handler(request):
            if request.url.path == "/v1/models":
                return httpx.Response(200, json={"data": [{"id": "allowed-model"}]})
            return httpx.Response(200, stream=stream)
        iterator = OpenAIProvider("fixture-key", ["allowed-model"], httpx.MockTransport(handler)).stream(generation())
        self.assertEqual((await anext(iterator))["text"], "partial")
        waiting = asyncio.create_task(anext(iterator))
        await asyncio.sleep(0.01)
        waiting.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiting
        self.assertTrue(stream.closed)

    async def test_openai_stream_usage_and_no_storage(self):
        observed = []
        async def handler(request):
            observed.append(request)
            if request.url.path == "/v1/models":
                return httpx.Response(200, json={"data": [{"id": "allowed-model"}, {"id": "not-allowed"}]})
            body = json.loads(request.content)
            self.assertFalse(body["store"])
            self.assertTrue(body["stream"])
            self.assertEqual(body["max_output_tokens"], 256)
            events = [{"type": "response.output_text.delta", "delta": "Hola"}, {"type": "response.completed", "response": {"model": "reported-model", "usage": {"input_tokens": 0, "output_tokens": 5, "input_tokens_details": {"cached_tokens": 0}}}}]
            return httpx.Response(200, text="".join("data: " + json.dumps(event) + "\n\n" for event in events))
        provider = OpenAIProvider("test-key-never-real", ["allowed-model"], httpx.MockTransport(handler))
        self.assertEqual(await provider.models(), [{"id": "allowed-model", "revision": None}])
        events = [event async for event in provider.stream(generation())]
        self.assertEqual(events[0]["text"], "Hola")
        usage = events[-1]["usage"]
        self.assertEqual(usage["inputTokens"], 0)
        self.assertEqual(usage["cachedTokens"], 0)
        self.assertIsNone(usage["totalTokens"])
        self.assertIsNone(usage["costUsd"])

    async def test_openai_incomplete_and_sanitized_errors(self):
        async def handler(request):
            if request.url.path == "/v1/models":
                return httpx.Response(200, json={"data": [{"id": "allowed-model"}]})
            event = {"type": "response.incomplete", "response": {"incomplete_details": {"reason": "max_output_tokens"}}}
            return httpx.Response(200, text="data: " + json.dumps(event) + "\n\n")
        provider = OpenAIProvider("test-key", ["allowed-model"], httpx.MockTransport(handler))
        result = [event async for event in provider.stream(generation())]
        self.assertEqual(result[-1]["status"], "incomplete")
        self.assertTrue(all(value is None for value in result[-1]["usage"].values()))
        denied = OpenAIProvider("test-key", ["allowed-model"], httpx.MockTransport(lambda request: httpx.Response(429, text="private-key-and-body")))
        with self.assertRaises(ProviderError) as error:
            await denied.models()
        self.assertEqual(error.exception.code, "provider_rate_limit")
        self.assertNotIn("private-key", error.exception.message)

    async def test_ollama_rejects_cloud_models_and_keeps_unknown_totals(self):
        async def handler(request):
            if request.url.path == "/api/tags":
                return httpx.Response(200, json={"models": [{"name": "allowed-model", "digest": "sha-local"}, {"name": "remote-alias"}, {"name": "blocked:cloud"}]})
            if request.url.path == "/api/show":
                remote = json.loads(request.content)["model"] == "remote-alias"
                return httpx.Response(200, json={"capabilities": ["completion"], **({"remote_host": "https://ollama.com"} if remote else {})})
            body = json.loads(request.content)
            self.assertEqual(body["options"]["num_predict"], 256)
            return httpx.Response(200, text=json.dumps({"model": "allowed-model", "message": {"content": "local"}, "done": False}) + "\n" + json.dumps({"done": True, "done_reason": "stop", "prompt_eval_count": 4, "prompt_eval_cached_count": 2, "eval_count": 0, "total_duration": 5_000_000}) + "\n")
        provider = OllamaProvider("http://host.docker.internal:11434", ["allowed-model", "remote-alias", "blocked:cloud"], httpx.MockTransport(handler))
        self.assertEqual(await provider.models(), [{"id": "allowed-model", "revision": "sha-local"}])
        events = [event async for event in provider.stream(generation("ollama"))]
        self.assertEqual(events[-1]["usage"]["cachedTokens"], 2)
        self.assertEqual(events[-1]["usage"]["providerDurationMs"], 5)
        self.assertEqual(events[-1]["usage"]["outputTokens"], 0)
        self.assertIsNone(events[-1]["usage"]["totalTokens"])
        self.assertIsNone(events[-1]["usage"]["costUsd"])

    async def test_ollama_never_falls_back_to_external_provider(self):
        calls = []
        async def handler(request):
            calls.append(str(request.url))
            raise httpx.ConnectError("private-error", request=request)
        provider = OllamaProvider("http://host.docker.internal:11434", ["allowed-model"], httpx.MockTransport(handler))
        with self.assertRaises(httpx.ConnectError):
            _ = [event async for event in provider.stream(generation("ollama"))]
        self.assertTrue(all(url.startswith("http://host.docker.internal:11434/") for url in calls))
        with self.assertRaises(ValueError):
            OllamaProvider("https://public-provider.example", ["allowed-model"])

    async def test_service_auth_and_disabled_catalog_no_network(self):
        provider = OpenAIProvider("", [])
        app = create_app("fixture-token-123456789012345678901234", {"openai": provider})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            self.assertEqual((await client.get("/catalog/openai")).status_code, 401)
            result = await client.get("/catalog/openai", headers={"Authorization": "Bearer fixture-token-123456789012345678901234"})
            self.assertFalse(result.json()["available"])
            self.assertEqual(result.json()["error"]["code"], "provider_not_configured")
            invalid = await client.post("/generate", content=b'{"secret":"do-not-echo"}', headers={"Authorization": "Bearer fixture-token-123456789012345678901234"})
            self.assertEqual(invalid.status_code, 422)
            self.assertNotIn("do-not-echo", invalid.text)

    async def test_openai_missing_terminal_event_is_not_success(self):
        async def handler(request):
            if request.url.path == "/v1/models":
                return httpx.Response(200, json={"data": [{"id": "allowed-model"}]})
            return httpx.Response(200, text='data: {"type":"response.output_text.delta","delta":"partial"}\n\n')
        provider = OpenAIProvider("test-key", ["allowed-model"], httpx.MockTransport(handler))
        with self.assertRaises(ProviderError):
            _ = [event async for event in provider.stream(generation())]
