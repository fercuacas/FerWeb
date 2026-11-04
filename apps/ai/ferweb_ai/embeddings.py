import math
from .providers import OllamaProvider, check
from .models import ProviderError


class LocalEmbeddings(OllamaProvider):
    """Only an operator-selected local model; no cloud adapter or fallback."""
    def __init__(self, base, model, dimensions, transport=None):
        super().__init__(base, [model] if model else [], transport)
        self.model, self.dimensions = model, dimensions
        self.capability = "embedding"

    async def describe(self):
        models = await self.models()
        found = next((item for item in models if item["id"] == self.model), None)
        if not found or not found.get("revision"):
            raise ProviderError("embedding_unavailable", "Configura un modelo local de embeddings con digest conocido.")
        return {"model": self.model, "revision": found["revision"], "dimensions": self.dimensions, "provider": "ollama"}

    async def embed(self, texts):
        description = await self.describe()
        async with self.client() as client:
            response = await client.post(self.base + "/api/embed", json={
                "model": self.model, "input": texts, "truncate": False,
            })
            check(response)
            vectors = response.json().get("embeddings", [])
        if len(vectors) != len(texts) or any(
            len(vector) != self.dimensions or not all(type(x) in (int, float) and math.isfinite(x) for x in vector)
            or not any(x != 0 for x in vector) for vector in vectors
        ):
            raise ProviderError("embedding_dimensions", "Las dimensiones del modelo no coinciden con la configuración.")
        # Recheck the observed digest to avoid publishing mixed model revisions.
        if await self.describe() != description:
            raise ProviderError("embedding_changed", "El modelo de embeddings ha cambiado durante la consulta.")
        return {**description, "vectors": vectors}
