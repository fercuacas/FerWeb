# Servicio Python de IA

Lee [ai.md](../../docs/ai.md); añade [retrieval.md](../../docs/retrieval.md) solo para embeddings/procedencia.

- `ferweb_ai/providers.py`: OpenAI/Ollama; `embeddings.py`: embeddings locales; `models.py`/`app.py`: protocolo interno. Revisa cliente Node si cambia el protocolo.
- Claves/token solo en servidor. Modo local sin fallback externo, incluidos embeddings/evaluadores. No descargues modelos como efecto de tests.
- Conserva catálogo permitido, capacidades/límites, streaming/cancelación y errores sin secretos. Uso/duración ausentes son desconocidos; cerrar conexión no acredita parada/facturación remota.
- Dependencias fijadas con hashes en `requirements.in`/`requirements.lock`; no actualices paquetes ajenos al cambio.
- Tests en `tests/`, transportes simulados. `fake_app.py` es fixture; `ferweb_ai.verify` solo para validación real explícita, nunca automática.

Pruebas Python en `ai-test`; comando en [desarrollo](../../docs/development.md).
