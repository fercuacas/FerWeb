from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=100_000)


class Generation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    provider: Literal["openai", "ollama"]
    model: str = Field(min_length=1, max_length=200)
    messages: list[Message] = Field(min_length=1, max_length=201)
    maxOutputTokens: int = Field(ge=1, le=4096)


def unknown_usage():
    return dict.fromkeys(("inputTokens", "outputTokens", "totalTokens", "cachedTokens",
                          "reasoningTokens", "costUsd", "providerDurationMs",
                          "loadDurationMs", "evaluationDurationMs"))


class ProviderError(Exception):
    def __init__(self, code="provider_unavailable", message="No se ha podido completar la consulta al proveedor."):
        self.code, self.message = code, message


def finish(status="completed", reason=None, usage=None, error=None):
    return {"type": "finish", "status": status, "reason": reason,
            "usage": usage if usage is not None else unknown_usage(), "error": error}
