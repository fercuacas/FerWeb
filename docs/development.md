# Desarrollo de FerWeb con contexto acotado

Guía para mantener este repositorio desde el chat/terminal. La optimización funcional de IA se documenta por separado en [context-optimization.md](context-optimization.md). Consulta solo la sección del cambio; [status.md](status.md) es la entrada de estado y [history.md](history.md) conserva evidencias antiguas.

## Elegir lecturas

1. Raíz y estado una vez por tarea; no repitas contenido que siga vigente en el contexto.
2. Busca el símbolo/ruta con `rg`; abre los `AGENTS.md` de sus ancestros y el módulo afectado. Desde la raíz no presupongas que el cliente haya incorporado instrucciones de subcarpetas.
3. Lee la guía funcional solo si afecta reglas, contrato, seguridad o ejecución. Para estilo puntual basta componente/CSS y sus instrucciones. Si falta contexto, amplía por dependencia concreta.
4. Ante una tarea que cruza áreas, sigue la tabla; no leas las guías completas de todos los componentes.

Codex construye instrucciones según el directorio de arranque; no garantiza descubrir todas las subcarpetas al editar desde la raíz. Por eso la raíz pide consultar el camino objetivo. No cambiamos configuración global ni prometemos caché/ahorro automático del modelo. Referencia: [documentación oficial de AGENTS.md](https://developers.openai.com/codex/guides/agents-md/).

## Mapa por cambio

Rutas desde la raíz. Las instrucciones están junto al directorio indicado; suites bajo `apps/api/test/`, specs bajo `tests/browser/`.

| Cambio | Punto de entrada | Guía si afecta comportamiento | Prueba principal |
| --- | --- | --- | --- |
| Login/sesión | `apps/api/src/modules/identity/`, `apps/web/src/workspace-store.ts` | [API](api.md) | `identity.test.ts`, `workspace.integration.ts`, `workspace.spec.ts` |
| Proyectos/tareas | `apps/api/src/modules/projects/`, `apps/web/src/Workspace.tsx` | [API](api.md) | `workspace.integration.ts`, `workspace.spec.ts` |
| GitHub | `apps/api/src/modules/github/`, `apps/web/src/GitHub.tsx` | [GitHub](github.md) | `github.integration.ts`, `github.spec.ts` |
| Chat/streaming | `apps/api/src/modules/chat/`, `apps/web/src/Conversations.tsx` | [IA](ai.md) | `chat.integration.ts`, `chat.spec.ts` |
| Embeddings/proveedores | `apps/ai/ferweb_ai/` | [IA](ai.md), [fuentes](retrieval.md) si aplica | Python; chat/recuperación si cambia protocolo |
| Recuperación | `apps/api/src/modules/retrieval/`, `apps/web/src/RepositoryContext.tsx` | [Fuentes](retrieval.md) | `retrieval.integration.ts`, `retrieval.spec.ts` |
| Comparaciones | `apps/api/src/modules/laboratory/`, `apps/web/src/Laboratory.tsx` | [Laboratorio](laboratory.md) | `laboratory.integration.ts`, `laboratory.spec.ts` |
| Estrategias de contexto/adopción | `context-*` en laboratorio, captura de recuperación, chat, `apps/web/src/ContextStrategies.tsx` | [Contexto E10](context-optimization.md) | `context.integration.ts`, `context.spec.ts`; chat/recuperación si cambia su contrato |
| Cola/simulador | `apps/api/src/modules/jobs/`, `apps/api/src/job-worker.ts` | [Trabajos](jobs.md) | `jobs.integration.ts`, `jobs.spec.ts` |
| Codex/aislamiento | `coding-*` en jobs, `apps/runner/`, `apps/sandbox/`, `apps/web/src/Coding.tsx` | [Codex](codex.md) | `coding-boundaries.test.ts`, `coding.integration.ts`, `coding.spec.ts` |
| Catálogo de agentes | `apps/api/src/modules/agents/`, `apps/web/src/Agents.tsx`, `coding-service.ts` | [Roles](codex.md#roles-versionados-por-proyecto-p02) | `coding.integration.ts`, `coding.spec.ts` |
| Revisión/PR/comparación | `review-*` y `coding-service.ts` en jobs, cliente GitHub, `apps/web/src/CodingReview.tsx` | [Revisión y PR](reviews.md) | `review.integration.ts`, `coding-boundaries.test.ts`, `coding.spec.ts` |
| Esquemas/SQL | `packages/contracts/`, `apps/api/migrations/` | Contrato del dominio | Compilar consumidores, `migrations.test.ts`, `database.integration.ts` |
| Arranque/salud/Docker | `scripts/`, `compose*.yaml`, Dockerfiles, `apps/api/src/health.ts` | [Docker](docker.md), README para CA | `app.test.ts`, `status.spec.ts`, smoke; Compose si cambia operación |
| Release/CI/copia/carga | `compose.release.yaml`, `scripts/release*.mjs`, `scripts/verify-release.mjs`, `.github/workflows/ci.yaml`, `apps/web/serve.mjs`, `apps/api/src/observability.ts` | [Despliegue](deployment.md), [carga](load-testing.md), [revisión](release-review.md) | `observability.test.ts`, `npm run release:check` (incluye proxy/Chromium/recuperación/carga) |

Acoplamientos a revisar solo cuando correspondan:

- DTO: productor API + consumidor web; protocolo IA: cliente Node + Python.
- Archivo/propiedad/sesión: recursos dependientes, cancelación y cachés privadas.
- GitHub/permisos/procedencia: recuperación, fuentes de chat, laboratorio y Codex.
- Cola/Codex: generación, watchdog, controlador, sandbox y recolección.
- Corpus de navegador: fixtures compartidos de GitHub, recuperación y Codex.

## Validar sin cargar toda la suite en cada edición

Solo documentación: rutas/enlaces, coherencia, whitespace y formato de Markdown modificado. No requiere Docker ni tests funcionales, salvo usar el formateador en contenedor.

Para código, primero compila/prueba el área; al cerrar un cambio funcional usa `npm run docker:check`. No repitas checks superados sin cambios, fallos o dudas nuevas. Ese wrapper construye las imágenes actuales, prepara/retira fixtures y ejecuta todo. Formato habitual: `npm run docker:format`.

Para checks dirigidos dentro de Docker, preparar argumentos una vez por terminal desde la raíz; respeta una CA indicada por el operador o detecta la local:

```powershell
$ferwebComposeArgs = @('compose', '-f', 'compose.yaml')
if (!$env:FERWEB_BUILD_CA_FILE -and (Test-Path -LiteralPath '.local/build-ca.pem')) {
  $env:FERWEB_BUILD_CA_FILE = (Resolve-Path -LiteralPath '.local/build-ca.pem').Path
}
if ($env:FERWEB_BUILD_CA_FILE) { $ferwebComposeArgs += @('-f', 'compose.ca.yaml') }
docker @ferwebComposeArgs --profile tools build tools
```

La imagen `tools` copia los fuentes: reconstruir tras cambios antes de probar. Si cambia `apps/sandbox/`, reconstruye también con `docker @ferwebComposeArgs --profile build-sandbox build sandbox-image` (incluido en `npm run docker:up`). Estos argumentos no montan configuraciones privadas de proveedores. El Docker Desktop/motor Linux debe estar iniciado; no ejecutes compiladores o servicios nativos para sustituirlo.

Sin servicios ni proveedores, tipos/pruebas básicas/compilación:

```powershell
docker @ferwebComposeArgs --profile tools run --rm --no-deps tools npm run check
```

Integración específica: PostgreSQL preparado. Identidad/proyectos/GitHub/cola no necesitan proveedores externos; chat/laboratorio usan `ai-test`, recuperación añade Qdrant y Codex usa `runner-test` e imagen sandbox. Si hacen falta servicios habituales, `npm run docker:up` los construye/prepara. El siguiente ejemplo prueba Codex; cambia la selección de fixtures según la suite y retíralos incluso si falla:

```powershell
$ferwebFixtures = @('runner-test')
try {
  docker @ferwebComposeArgs --profile tools up --build --detach --wait @ferwebFixtures
  if ($LASTEXITCODE -ne 0) { throw 'Fixtures no preparados' }
  docker @ferwebComposeArgs --profile tools run --rm --no-deps tools sh -c 'npm run build && node --import tsx --test --test-concurrency=1 apps/api/test/coding.integration.ts'
  if ($LASTEXITCODE -ne 0) { throw 'Prueba fallida' }
} finally {
  docker @ferwebComposeArgs --profile tools stop @ferwebFixtures
  docker @ferwebComposeArgs --profile tools rm --force @ferwebFixtures
}
```

Sustituye la suite por la de la tabla. Para el recorrido de navegador de Codex, prepara también `ai-test` para el diagnóstico de capacidades y Qdrant para la limpieza. Ejecuta `docker @ferwebComposeArgs --profile tools run --rm --no-deps tools npm run test:browser -- coding.spec.ts` y retira los fixtures con la misma limpieza. Navegador completo necesita ambos fixtures. No ejecutes simultáneamente otras suites que los compartan.

Solo Python: `docker @ferwebComposeArgs --profile tools build ai-test`, después `docker @ferwebComposeArgs --profile tools run --rm --no-deps ai-test python -m unittest discover -s tests -v`. Sin modelos reales ni `ferweb_ai.verify`.

## Mantener instrucciones útiles

Raíz: reglas comunes, objetivo máximo 400 palabras. `AGENTS.md` locales: invariantes del área, no copias del historial. Estado: máximo 350 palabras. Historial: evidencia fechada que no se confunde con comprobaciones nuevas. Guías: decisiones/protocolos; no abrirlas por rutina. Documenta qué se probó realmente y qué queda pendiente; no afirmes porcentajes de ahorro de tokens sin mediciones del modelo.
