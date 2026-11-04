import json
import hmac
import os
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field
from .providers import OpenAIProvider, OllamaProvider
from .app import create_app
from .embeddings import LocalEmbeddings


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    openaiApiKey: str = ""
    openaiModels: list[str] = Field(default_factory=list, max_length=20)
    ollamaModels: list[str] = Field(default_factory=list, max_length=20)
    ollamaUrl: str = "http://host.docker.internal:11434"
    embeddingModel: str = Field(default="", max_length=200)
    embeddingDimensions: int = Field(default=768, ge=1, le=4096)


def load_settings():
    filename = os.environ.get("AI_PROVIDER_FILE")
    try:
        raw = Path(filename).read_bytes() if filename else b"{}"
        if len(raw) > 64_000:
            raise ValueError()
        return Settings.model_validate_json(raw)
    except Exception:
        raise RuntimeError("Invalid private AI provider configuration; values are not logged") from None


settings = load_settings()
app = create_app(os.environ.get("AI_SERVICE_TOKEN", ""), {
    "openai": OpenAIProvider(settings.openaiApiKey, settings.openaiModels),
    "ollama": OllamaProvider(settings.ollamaUrl, settings.ollamaModels),
}, LocalEmbeddings(settings.ollamaUrl, settings.embeddingModel, settings.embeddingDimensions),
    configuration_revision=hmac.digest(os.environ.get("AI_SERVICE_TOKEN", "").encode(),
        settings.model_dump_json().encode(), "sha256").hex())
