import asyncio
import os
import json
import re
import unicodedata
from ferweb_ai.app import create_app
from ferweb_ai.models import unknown_usage, finish, ProviderError


class SimulatedProvider:
    def __init__(self):
        self.active = 0

    async def models(self):
        return [{"id": "fixture-chat", "revision": "fixture-revision"}]

    async def stream(self, generation):
        self.active += 1
        try:
            async for event in self.answer(generation):
                yield event
        finally:
            self.active -= 1

    async def answer(self, generation):
        if generation.model != "fixture-chat":
            raise ProviderError("provider_model", "Modelo simulado no disponible.")
        prompt = generation.messages[-1].content
        if any(message.role == "system" for message in generation.messages):
            context = json.loads(generation.messages[-2].content)
            sources = context["repository_sources"]
            assert generation.messages[-2].role == "user"
            assert "DATOS NO CONFIABLES" in generation.messages[0].content
            if context.get("context_strategy"):
                yield {"type": "meta", "reportedModel": "fixture-context-reported"}
                if "fixture-context-cancel" in prompt and prompt.startswith("Resume exclusivamente"):
                    yield {"type": "delta", "text": "Parcial simulado"}
                    await asyncio.sleep(60)
                if prompt.startswith("Resume exclusivamente"):
                    if "fixture-context-summary-error" in prompt:
                        raise ProviderError("provider_rate_limit", "Error simulado del resumen.")
                    text = "Resumen simulado: cookie HttpOnly; scrypt; npm run docker:up; prioridades low, medium, high, urgent; estados todo, in_progress, done; Revisar permisos. [F1]"
                else:
                    text = "No dispongo de información suficiente." if "factura" in prompt.lower() else "Cookie HttpOnly y contraseñas scrypt; npm run docker:up; low, medium, high, urgent; todo, in_progress, done; Revisar permisos y observación temporal independiente del commit. [F1]"
                await asyncio.sleep(0.02)
                yield {"type": "delta", "text": text}
                usage = unknown_usage()
                if "fixture-context-unknown" not in prompt:
                    count = max(1, len(json.dumps([m.model_dump() for m in generation.messages])) // 4)
                    output = max(1, len(text) // 4)
                    usage.update(inputTokens=count, outputTokens=output, totalTokens=count+output, cachedTokens=min(count,50) if generation.provider == "openai" else 0)
                yield finish(usage=usage)
                return
            if context.get("laboratory"):
                yield {"type": "meta", "reportedModel": "fixture-lab-reported"}
                yield {"type": "delta", "text": "Respuesta de laboratorio: "}
                if prompt == "fixture-lab-error":
                    raise ProviderError("provider_rate_limit", "Límite simulado del proveedor.")
                if prompt == "fixture-lab-cancel":
                    await asyncio.sleep(60)
                else:
                    await asyncio.sleep(0.1)
                yield {"type": "delta", "text": "cookie HttpOnly; contraseñas scrypt. [F1]"}
                usage = unknown_usage()
                if prompt != "fixture-lab-unknown":
                    usage.update(inputTokens=100,outputTokens=20,totalTokens=120,cachedTokens=50 if generation.provider == "openai" else 0)
                yield finish(usage=usage)
                return
            yield {"type": "delta", "text": "Respuesta simulada con fuentes [F1]."}
            yield finish()
            return
        yield {"type": "meta", "reportedModel": "fixture-reported"}
        yield {"type": "delta", "text": "Respuesta "}
        if prompt == "fixture-error":
            raise ProviderError("provider_rate_limit", "El proveedor simulado ha limitado la consulta.")
        if prompt == "fixture-cancel":
            await asyncio.sleep(60)
        else:
            await asyncio.sleep(0.1)
        yield {"type": "delta", "text": f"simulada ({len(generation.messages)} mensajes)."}
        usage = unknown_usage()
        if prompt != "fixture-unknown":
            usage.update(inputTokens=11, outputTokens=7, totalTokens=18)
        yield finish(usage=usage)


# Test-only entrypoint. Never loaded by ferweb_ai.main or by provider configuration.
providers = {"openai": SimulatedProvider(), "ollama": SimulatedProvider()}

class SimulatedEmbeddings:
    async def describe(self):
        return {"provider": "ollama", "model": "fixture-embed", "revision": "fixture-embedding-v1", "dimensions": 8}

    async def embed(self, texts):
        groups = [r"auth|autenti|sesion|cookie|password|contrasena|login", r"task|tarea|priori|tablero", r"docker|compose|contenedor|arrancar|iniciar", r"permiso|permission|acceso|seguridad|access", r"github|repositorio|commit", r"factura|billing|invoice", r"demo|export|const", r"planeta|jupiter|cosmos"]
        vectors=[]
        for text in texts:
            normalized = ''.join(c for c in unicodedata.normalize('NFD',text.lower()) if unicodedata.category(c) != 'Mn')
            vector=[float(len(re.findall(group,normalized))) for group in groups]
            if not any(vector): vector[-1]=1.0
            vectors.append(vector)
        return {**await self.describe(), "vectors": vectors}

app = create_app(os.environ["AI_SERVICE_TOKEN"], providers, SimulatedEmbeddings(), simulated=True, configuration_revision="fixture-config-v1")


@app.get("/fixture/active")
async def active():
    return {"active": sum(provider.active for provider in providers.values())}
