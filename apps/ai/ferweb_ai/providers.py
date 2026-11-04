import json
import ssl
import os
from typing import Protocol, AsyncIterator
from urllib.parse import urlparse
import httpx
from .models import Generation, ProviderError, unknown_usage, finish


class Provider(Protocol):
    async def models(self) -> list[dict]: ...
    def stream(self, generation: Generation) -> AsyncIterator[dict]: ...


def count(value):
    return value if type(value) in (int, float) and value >= 0 else None


def check(response):
    if response.is_success:
        return
    code = {401: "provider_auth", 403: "provider_auth", 404: "provider_model", 429: "provider_rate_limit", 400: "provider_configuration"}.get(response.status_code, "provider_unavailable")
    raise ProviderError(code, "El proveedor ha rechazado la consulta. Revisa configuración, modelo y límites.")


async def lines(response):
    pending = b""
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        pending += chunk
        if len(pending) > 1_000_000 or total > 8_000_000:
            raise ProviderError("provider_protocol", "La respuesta supera los límites de lectura.")
        while b"\n" in pending:
            line, pending = pending.split(b"\n", 1)
            yield line.rstrip(b"\r").decode("utf-8")
    if pending:
        yield pending.decode("utf-8")


class HttpProvider:
    def __init__(self, allowed, transport=None):
        self.allowed = allowed
        self.transport = transport

    def client(self):
        context = ssl.create_default_context()
        if os.environ.get("AI_EXTRA_CA_FILE"):
            context.load_verify_locations(os.environ["AI_EXTRA_CA_FILE"])
        return httpx.AsyncClient(timeout=httpx.Timeout(60, connect=5), follow_redirects=False,
                                 trust_env=False, verify=context, transport=self.transport)

    async def validate(self, model):
        if model not in [entry["id"] for entry in await self.models()]:
            raise ProviderError("provider_model", "El modelo no está disponible o no está permitido.")


class OpenAIProvider(HttpProvider):
    def __init__(self, key, allowed, transport=None):
        super().__init__(allowed, transport)
        self.key = key

    def headers(self):
        return {"Authorization": "Bearer " + self.key}

    async def models(self):
        if not self.key or not self.allowed:
            raise ProviderError("provider_not_configured", "OpenAI no está configurado en el servidor.")
        async with self.client() as client:
            response = await client.get("https://api.openai.com/v1/models", headers=self.headers())
            check(response)
            available = {item["id"] for item in response.json()["data"]}
            return [{"id": model, "revision": None} for model in self.allowed if model in available]

    async def stream(self, generation):
        await self.validate(generation.model)
        data = {"model": generation.model, "input": [message.model_dump() for message in generation.messages],
                "max_output_tokens": generation.maxOutputTokens, "stream": True, "store": False}
        async with self.client() as client:
            async with client.stream("POST", "https://api.openai.com/v1/responses", headers=self.headers(), json=data) as response:
                check(response)
                event_data = []
                async for line in lines(response):
                    if line.startswith("data:"):
                        event_data.append(line[5:].lstrip())
                    elif not line and event_data:
                        event = json.loads("\n".join(event_data))
                        event_data = []
                        kind = event.get("type")
                        if kind in ("response.output_text.delta", "response.refusal.delta"):
                            yield {"type": "delta", "text": event["delta"]}
                        elif kind in ("response.created", "response.in_progress"):
                            yield {"type": "meta", "reportedModel": event.get("response", {}).get("model")}
                        elif kind in ("response.completed", "response.incomplete", "response.failed"):
                            result = event.get("response", {})
                            yield {"type": "meta", "reportedModel": result.get("model")}
                            usage = unknown_usage()
                            raw = result.get("usage") or {}
                            for target, source in (("inputTokens", "input_tokens"), ("outputTokens", "output_tokens"), ("totalTokens", "total_tokens")):
                                usage[target] = count(raw.get(source))
                            usage["cachedTokens"] = count((raw.get("input_tokens_details") or {}).get("cached_tokens"))
                            usage["reasoningTokens"] = count((raw.get("output_tokens_details") or {}).get("reasoning_tokens"))
                            status = {"response.completed": "completed", "response.incomplete": "incomplete", "response.failed": "error"}[kind]
                            error = {"code": "provider_error", "message": "OpenAI no ha completado la respuesta."} if status == "error" else None
                            reason = "max_output_tokens" if (result.get("incomplete_details") or {}).get("reason") == "max_output_tokens" else status
                            yield finish(status, reason, usage, error)
                            return
                        elif kind == "error":
                            raise ProviderError("provider_error", "OpenAI ha comunicado un error durante la generación.")
        raise ProviderError("provider_protocol", "El flujo terminó sin confirmación del proveedor.")


class OllamaProvider(HttpProvider):
    capability = "completion"
    def __init__(self, base_url, allowed, transport=None):
        super().__init__(allowed, transport)
        parsed = urlparse(base_url)
        if parsed.scheme != "http" or parsed.hostname not in ("host.docker.internal", "ollama", "127.0.0.1", "localhost") or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("Ollama must use an explicitly local server")
        self.base = base_url.rstrip("/")

    async def models(self):
        if not self.allowed:
            raise ProviderError("provider_not_configured", "Ollama no está configurado en el servidor.")
        async with self.client() as client:
            response = await client.get(self.base + "/api/tags")
            check(response)
            result = []
            for item in response.json()["models"]:
                model = item.get("name", item.get("model"))
                if model not in self.allowed or "cloud" in model.lower() or item.get("remote_host") or item.get("remote_model"):
                    continue
                detail = await client.post(self.base + "/api/show", json={"model": model})
                check(detail)
                info = detail.json()
                if info.get("remote_host") or info.get("remote_model") or self.capability not in info.get("capabilities", []):
                    continue
                result.append({"id": model, "revision": item.get("digest")})
            return result

    async def stream(self, generation):
        await self.validate(generation.model)
        async with self.client() as client:
            async with client.stream("POST", self.base + "/api/chat", json={"model": generation.model,
                "messages": [message.model_dump() for message in generation.messages], "stream": True,
                "options": {"num_predict": generation.maxOutputTokens}}) as response:
                check(response)
                async for line in lines(response):
                    if not line:
                        continue
                    event = json.loads(line)
                    if event.get("error"):
                        raise ProviderError("provider_error", "Ollama ha comunicado un error durante la generación.")
                    if event.get("model"):
                        yield {"type": "meta", "reportedModel": event["model"]}
                    content = (event.get("message") or {}).get("content")
                    if content:
                        yield {"type": "delta", "text": content}
                    if event.get("done"):
                        usage = unknown_usage()
                        usage["inputTokens"] = count(event.get("prompt_eval_count"))
                        usage["cachedTokens"] = count(event.get("prompt_eval_cached_count"))
                        usage["outputTokens"] = count(event.get("eval_count"))
                        for target, source in (("providerDurationMs", "total_duration"), ("loadDurationMs", "load_duration"), ("evaluationDurationMs", "eval_duration")):
                            value = count(event.get(source))
                            usage[target] = value / 1_000_000 if value is not None else None
                        status = "incomplete" if event.get("done_reason") == "length" else "completed"
                        yield finish(status, "length" if status == "incomplete" else "stop", usage)
                        return
        raise ProviderError("provider_protocol", "El flujo terminó sin confirmación del proveedor.")
