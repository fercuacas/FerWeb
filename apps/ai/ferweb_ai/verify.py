"""Explicit operator command; never imported by automatic tests or application startup."""
import argparse
import asyncio
import json
import os
import time
from uuid import uuid4
import httpx


async def verify(provider, model):
    identifier = str(uuid4())
    started = time.monotonic()
    terminal = False
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", trust_env=False,
                                 headers={"Authorization": "Bearer " + os.environ["AI_SERVICE_TOKEN"]},
                                 timeout=httpx.Timeout(30, connect=5)) as client:
        try:
            async with asyncio.timeout(45):
                catalog = (await client.get("/catalog/" + provider)).json()
                if not catalog["available"] or model not in [entry["id"] for entry in catalog["models"]]:
                    raise RuntimeError("Model unavailable; review the configured provider catalog")
                async with client.stream("POST", "/generate", json={"id": identifier, "provider": provider,
                    "model": model, "maxOutputTokens": 64, "messages": [{"role": "user", "content": "Responde solamente OK."}]}) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        event = json.loads(line)
                        if event["type"] == "finish":
                            terminal = True
                            print(json.dumps({"provider": provider, "model": model, "status": event["status"],
                                "durationMs": (time.monotonic() - started) * 1000, "usage": event["usage"], "error": event["error"]}))
                            if event["status"] == "error":
                                raise RuntimeError("Provider verification failed")
                if not terminal:
                    raise RuntimeError("No terminal provider event")
        finally:
            if not terminal:
                await client.post("/cancel/" + identifier)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="One explicit real provider call, limited to 64 output tokens; may incur charges.")
    parser.add_argument("--provider", choices=["openai", "ollama"], required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    try:
        asyncio.run(verify(args.provider, args.model))
    except Exception:
        raise SystemExit("Real provider verification failed. No credential or provider body was logged.") from None
