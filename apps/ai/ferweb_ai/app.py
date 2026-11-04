import asyncio
import contextlib
import hmac
import json
from collections.abc import AsyncIterator
import httpx
import anyio
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import ValidationError
from .models import Generation, ProviderError, finish


def safe_error(error):
    if isinstance(error, ProviderError):
        return {"code": error.code, "message": error.message}
    if isinstance(error, (httpx.TimeoutException, TimeoutError)):
        return {"code": "provider_timeout", "message": "El proveedor ha agotado el tiempo de espera."}
    return {"code": "provider_unavailable", "message": "No se ha podido completar la consulta al proveedor."}


def create_app(token: str, providers: dict, embeddings=None, *, simulated=False, configuration_revision=None):
    if len(token) < 32 or token.startswith("replace-with-"):
        raise ValueError("Configure the private AI service token")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    jobs: dict[str, asyncio.Event] = {}

    def authorize(request):
        actual = request.headers.get("authorization", "").encode()
        if not hmac.compare_digest(actual, ("Bearer " + token).encode()):
            raise HTTPException(401, "Unauthorized")

    @app.get("/health")
    async def health():
        return {"status": "ready"}

    @app.api_route("/embeddings", methods=["GET", "POST"])
    async def embed(request: Request):
        authorize(request)
        if embeddings is None:
            return JSONResponse({"error": "embedding_unconfigured"}, status_code=503)
        try:
            async with asyncio.timeout(60):
                if request.method == "GET":
                    return {**await embeddings.describe(), "simulated": simulated, "configurationRevision": configuration_revision}
                raw = b""
                async for chunk in request.stream():
                    raw += chunk
                    if len(raw) > 100_000:
                        raise HTTPException(413, "Request too large")
                body = json.loads(raw)
                if not isinstance(body, dict):
                    return JSONResponse({"error": "invalid_embeddings"}, status_code=422)
                texts = body.get("texts")
                if set(body) != {"texts"} or not isinstance(texts, list) or not 1 <= len(texts) <= 32 or any(not isinstance(text, str) or not 1 <= len(text) <= 4000 for text in texts):
                    return JSONResponse({"error": "invalid_embeddings"}, status_code=422)
                return {**await embeddings.embed(texts), "simulated": simulated, "configurationRevision": configuration_revision}
        except HTTPException:
            raise
        except Exception as error:
            return JSONResponse({"error": safe_error(error)}, status_code=503)

    @app.get("/catalog/{provider}")
    async def catalog(provider: str, request: Request):
        authorize(request)
        if provider not in providers:
            raise HTTPException(404, "Unknown provider")
        try:
            async with asyncio.timeout(30):
                models = await providers[provider].models()
            return {"provider": provider, "available": True, "models": models, "error": None, "simulated": simulated, "configurationRevision": configuration_revision}
        except Exception as error:
            return {"provider": provider, "available": False, "models": [], "error": safe_error(error), "simulated": simulated, "configurationRevision": configuration_revision}

    @app.post("/cancel/{generation_id}")
    async def cancel(generation_id: str, request: Request):
        authorize(request)
        job = jobs.get(generation_id)
        if job:
            job.set()
        return {"cancelRequested": bool(job), "remoteCancellationConfirmed": None}

    @app.post("/generate")
    async def generate(request: Request):
        authorize(request)
        raw = b""
        async for chunk in request.stream():
            raw += chunk
            if len(raw) > 512_000:
                raise HTTPException(413, "Request too large")
        try:
            generation = Generation.model_validate_json(raw)
        except ValidationError:
            return JSONResponse({"error": "invalid_generation"}, status_code=422)
        if generation.provider not in providers:
            raise HTTPException(404, "Unknown provider")
        if generation.id in jobs:
            raise HTTPException(409, "Generation already running")
        if len(jobs) >= 4:
            raise HTTPException(503, "Generation capacity reached")
        event = asyncio.Event()
        jobs[generation.id] = event

        async def output() -> AsyncIterator[str]:
            iterator = providers[generation.provider].stream(generation).__aiter__()
            pending = None
            cancelled = asyncio.create_task(event.wait())
            try:
                async with asyncio.timeout(300):
                    while True:
                        pending = asyncio.create_task(anext(iterator))
                        done, _ = await asyncio.wait((pending, cancelled), return_when=asyncio.FIRST_COMPLETED)
                        if cancelled in done:
                            yield json.dumps({"type": "cancelled"}) + "\n"
                            return
                        try:
                            value = pending.result()
                        except StopAsyncIteration:
                            return
                        yield json.dumps(value, ensure_ascii=False) + "\n"
            except asyncio.CancelledError:
                raise
            except Exception as error:
                yield json.dumps(finish("error", "error", error=safe_error(error))) + "\n"
            finally:
                try:
                    # ASGI disconnect can cancel an AnyIO scope repeatedly. Complete
                    # upstream cleanup even while that outer scope is cancelled.
                    with anyio.move_on_after(5, shield=True):
                        for task in (pending, cancelled):
                            if task:
                                task.cancel()
                                with contextlib.suppress(asyncio.CancelledError, Exception):
                                    await task
                        await iterator.aclose()
                finally:
                    jobs.pop(generation.id, None)

        return StreamingResponse(output(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store"})

    return app
