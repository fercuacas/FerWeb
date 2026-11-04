# Web React / TypeScript

Ámbito: `apps/web/`. Redux/RTK Query gestionan datos remotos y estado compartido; estado local para borradores/controles sin uso compartido. Reutiliza contratos de `packages/contracts`; autorización siempre en servidor.

- `Workspace.tsx`: proyectos/tareas; `workspace-store.ts`: identidad y datos privados. Conserva limpieza de caché al salir/cambiar sesión, versiones, archivo y borradores tras error.
- Busca la pantalla concreta: `GitHub.tsx`, `Conversations.tsx`, `RepositoryContext.tsx`, `Laboratory.tsx`, `Jobs.tsx`, `Coding.tsx`/`CodingReview.tsx`, con sus stores/CSS. Revisión/PR y comparación: `docs/reviews.md`.
- Si cambia comportamiento/contrato, consulta la sección pertinente de su guía: `docs/api.md`, `github.md`, `ai.md`, `retrieval.md`, `laboratory.md`, `jobs.md` o `codex.md` desde la raíz, y el módulo API afectado. Para estilo puntual basta componente/CSS.
- No muestres caché privada si falla revalidación. Conserva carga, vacío, error, parciales, cancelación, teclado/foco y móvil. Métricas ausentes no son cero.

Compila web/contratos y prueba el recorrido afectado; preparación en [desarrollo](../../docs/development.md). No dividas todos los componentes como efecto de un cambio puntual.
