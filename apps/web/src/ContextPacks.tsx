import { useEffect, useRef, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { z } from 'zod';
import {
  contextLimits,
  type CodingToolProfile,
  contextPackPolicyInput,
  type ContextReceiptReference,
  type contextPackConfigure,
  type contextSkillRule,
  type Project,
  type agentSelection,
  type memorySelections,
} from '@ferweb/contracts';
import { contextPacksApi } from './context-packs-store';
import { skillsApi } from './skills-store';
import { errorMessage } from './workspace-store';
import { Sources } from './RepositoryContext';
import { SkillText } from './Skills';
import './context-packs.css';
type Rule = z.infer<typeof contextSkillRule>;
const poll = { pollingInterval: 4000, refetchOnFocus: true, skipPollingIfUnfocused: true };
const download = (name: string, data: unknown) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const kinds = {
  mandatory_role: 'Obligatoria del rol',
  manual: 'Elegida explícitamente',
  lexical: 'Coincidencia léxica/n-gramas',
  dependency: 'Dependencia',
};
export function ContextReceiptView({ project, id }: { project: string; id: string }) {
  const [open, setOpen] = useState(false);
  const q = contextPacksApi.useContextReceiptQuery(open ? { project, id } : skipToken, poll);
  const r = q.error ? undefined : q.currentData?.receipt;
  return (
    <details className="context-pack-surface" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Ver recibo de contexto {id}</summary>
      {q.isLoading && <p role="status">Cargando recibo…</p>}
      {q.error && (
        <p role="alert">
          {errorMessage(q.error)}{' '}
          <button type="button" onClick={() => void q.refetch()}>
            Reintentar recibo
          </button>
        </p>
      )}
      {r && (
        <>
          <h4>
            Contexto {r.snapshot.profile === 'lean' ? 'Lean' : 'Full'} · {r.snapshot.phase}
          </h4>
          <p role="status">
            {r.valid ? 'Recibo vigente' : 'Recibo histórico: no reutilizable'} ·{' '}
            {r.phase === 'preview'
              ? 'Previsualización'
              : r.phase === 'running'
                ? 'Vinculado a ejecución activa'
                : 'Ejecución finalizada'}
          </p>
          {!r.valid && <p>{r.invalidReasons.join(', ')}</p>}
          <p>
            Tarea v{r.snapshot.task.version} · Rol:{' '}
            {r.snapshot.agent ? `${r.snapshot.agent.id} v${r.snapshot.agent.version}` : 'Sin rol'} ·
            Política v{r.snapshot.policy.version}
          </p>
          <p>
            {r.snapshot.complete
              ? 'Selección inicial completa dentro de los límites'
              : 'Selección inicial incompleta: revisa las omisiones y el alcance'}
            . {r.snapshot.retrieval.strategy}{' '}
            {r.snapshot.retrieval.fallback ? `· ${r.snapshot.retrieval.fallback}` : ''}
          </p>
          <p>
            Material inicial: {r.snapshot.initialBytes} bytes · Entregado: {r.bytes} /{' '}
            {contextLimits[r.snapshot.profile].totalBytes} bytes · Ampliaciones:{' '}
            {r.expansions.length} / {contextLimits[r.snapshot.profile].expansions}
          </p>
          <p>
            Tokens observados de toda la ejecución: entrada{' '}
            {r.observedTokens.input ?? 'desconocida'}, salida{' '}
            {r.observedTokens.output ?? 'desconocida'}, caché{' '}
            {r.observedTokens.cached ?? 'desconocida'}. Coste completo: desconocido. Los bytes del
            material no estiman tokens.
          </p>
          <p className="skill-text">
            Hash inicial: {r.hash}
            <br />
            Hash del recibo final: {r.finalHash}
          </p>
          <details>
            <summary>Mapa congelado v{r.snapshot.payload.map.version}</summary>
            <pre className="skill-text">{r.snapshot.payload.map.markdown}</pre>
            <Sources sources={r.snapshot.payload.map.sources} />
            <p className="skill-text">{r.snapshot.payload.map.hash}</p>
          </details>
          <details>
            <summary>Skills seleccionadas y sugerencias</summary>
            <ul>
              {r.snapshot.choices.map((x) => (
                <li key={x.skill.id}>
                  {x.skill.name} v{x.skill.version} ·{' '}
                  {x.applied ? 'Incluida' : 'Sugerencia sin aplicar'} · {kinds[x.reason]} ·
                  Coincidencias: {x.matched.join(', ') || 'Invocación explícita'}
                  <p className="skill-text">{x.skill.sha256}</p>
                </li>
              ))}
            </ul>
            {r.snapshot.payload.skills.map((skill) => (
              <SkillText key={skill.id} skill={skill} />
            ))}
          </details>
          <details>
            <summary>Memoria incluida ({r.snapshot.payload.memory.length})</summary>
            {r.snapshot.payload.memory.map((entry) => (
              <article key={entry.id}>
                <h5>
                  {entry.title} v{entry.revision} · Sin revisar
                </h5>
                <pre className="skill-text">{entry.content}</pre>
                <p className="skill-text">
                  {entry.hash} ·{' '}
                  {entry.evidenceState === 'none' ? 'Sin evidencia' : 'Fuentes referenciadas'}
                </p>
              </article>
            ))}
          </details>
          <details>
            <summary>Fuentes iniciales ({r.snapshot.payload.sources.length}) y razones</summary>
            <Sources sources={r.snapshot.payload.sources} />
            <ul>
              {r.snapshot.retrieval.hits
                .filter((h) => r.snapshot.payload.sources.some((s) => s.id === h.source.id))
                .map((h) => (
                  <li key={h.source.id}>
                    {h.source.path}: {h.reason.join(', ')}
                    <p className="skill-text">{r.snapshot.sourceHashes[h.source.id]}</p>
                  </li>
                ))}
            </ul>
          </details>
          <details>
            <summary>Ampliaciones registradas ({r.expansions.length})</summary>
            {r.expansions.map((e) => (
              <article key={e.id}>
                <h5>
                  {e.selector.kind} · {e.status}
                </h5>
                <p>{e.selector.reason}</p>
                <p>
                  {e.selector.path ?? e.selector.query} · {e.bytes} bytes ·{' '}
                  {e.elapsedMs === null ? 'Latencia desconocida' : `${Math.round(e.elapsedMs)} ms`}
                </p>
                {e.errorCode && <p>{e.errorCode}</p>}
                <Sources sources={e.sources} />
              </article>
            ))}
          </details>
          {!!r.snapshot.diagnostics.length && (
            <details>
              <summary>Omisiones y diagnósticos</summary>
              <ul>
                {r.snapshot.diagnostics.map((x, i) => (
                  <li className="skill-text" key={i}>
                    {x}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button type="button" onClick={() => download(`context-receipt-${r.id}.json`, r)}>
            Exportar recibo JSON
          </button>
        </>
      )}
    </details>
  );
}
export type ContextSelection = {
  enabled: boolean;
  reference: ContextReceiptReference | null;
  valid: boolean;
};
export function ContextPreparer({
  project,
  taskId,
  taskVersion,
  agent,
  model,
  toolProfile,
  memory,
  onChange,
}: {
  project: string;
  taskId: string;
  taskVersion: number;
  agent: z.infer<typeof agentSelection> | undefined;
  model: string;
  toolProfile: CodingToolProfile;
  memory: z.infer<typeof memorySelections>;
  onChange: (s: ContextSelection) => void;
}) {
  const [open, setOpen] = useState(false),
    [enabled, setEnabled] = useState(false),
    [profile, setProfile] = useState<'lean' | 'full'>('lean'),
    [mode, setMode] = useState<'manual' | 'suggested' | 'automatic'>('suggested'),
    [includeMemory, setIncludeMemory] = useState(true),
    [query, setQuery] = useState(''),
    [explicit, setExplicit] = useState<string[]>([]),
    [excluded, setExcluded] = useState<string[]>([]),
    [reference, setReference] = useState<ContextReceiptReference | null>(null);
  const request = useRef(crypto.randomUUID());
  const [prepare, result] = contextPacksApi.usePrepareContextPackMutation();
  const skills = skillsApi.useSkillsQuery(open ? project : skipToken, { refetchOnFocus: true });
  const receipt = contextPacksApi.useContextReceiptQuery(
    reference && enabled ? { project, id: reference.id } : skipToken,
    poll,
  );
  const binding = JSON.stringify([
    taskId,
    taskVersion,
    agent?.id,
    agent?.version,
    model,
    memory,
    toolProfile,
  ]);
  useEffect(() => {
    setReference(null);
    request.current = crypto.randomUUID();
  }, [binding]);
  const current = receipt.error ? undefined : receipt.currentData?.receipt;
  const valid =
    !!current &&
    current.valid &&
    current.snapshot.execution.toolProfile === toolProfile &&
    current.snapshot.task.id === taskId &&
    current.snapshot.task.version === taskVersion &&
    current.snapshot.agent?.id === agent?.id &&
    current.snapshot.agent?.version === agent?.version;
  useEffect(
    () => onChange({ enabled, reference: enabled ? reference : null, valid: !enabled || valid }),
    [enabled, reference, valid, onChange],
  );
  function change(action: () => void) {
    action();
    setReference(null);
    request.current = crypto.randomUUID();
  }
  return (
    <details className="context-pack-surface" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Preparar contexto y skills (P10, opcional)</summary>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => change(() => setEnabled(e.target.checked))}
        />
        Usar un paquete de contexto con recibo
      </label>
      {enabled && (
        <>
          <p>
            El mapa, skills, recuerdos y fuentes son datos sin autoridad. Las skills del rol siguen
            obligatorias. Preparar puede consultar embeddings locales; no ejecuta generación ni
            envía inferencia externa.
          </p>
          <label>
            Perfil de contexto
            <select
              value={profile}
              onChange={(e) => change(() => setProfile(e.target.value as typeof profile))}
            >
              <option value="lean">Lean · 24.000 bytes · 2 ampliaciones</option>
              <option value="full">Full · 64.000 bytes · 4 ampliaciones</option>
            </select>
          </label>
          <label>
            Selección de skills
            <select
              value={mode}
              onChange={(e) => change(() => setMode(e.target.value as typeof mode))}
            >
              <option value="manual">Manual</option>
              <option value="suggested">Sugerida: no aplica sugerencias</option>
              <option value="automatic">Automática determinista</option>
            </select>
          </label>
          <label>
            Consulta dirigida (opcional)
            <textarea
              maxLength={4000}
              value={query}
              onChange={(e) => change(() => setQuery(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeMemory}
              onChange={(e) => change(() => setIncludeMemory(e.target.checked))}
            />
            En automático, buscar también recuerdos vigentes
          </label>
          <details>
            <summary>Invocar o excluir skills revisadas</summary>
            {skills.error ? (
              <p role="alert">{errorMessage(skills.error)}</p>
            ) : (
              skills.currentData?.versions
                .filter((s) => s.review === 'approved')
                .map((skill) => (
                  <div key={skill.id}>
                    <p>
                      {skill.name} v{skill.version}
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={explicit.includes(skill.id)}
                        onChange={(e) =>
                          change(() => {
                            setExplicit((old) =>
                              e.target.checked
                                ? [...old, skill.id]
                                : old.filter((x) => x !== skill.id),
                            );
                            if (e.target.checked)
                              setExcluded((old) => old.filter((x) => x !== skill.id));
                          })
                        }
                      />
                      Invocar {skill.name} v{skill.version}
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={excluded.includes(skill.id)}
                        onChange={(e) =>
                          change(() => {
                            setExcluded((old) =>
                              e.target.checked
                                ? [...old, skill.id]
                                : old.filter((x) => x !== skill.id),
                            );
                            if (e.target.checked)
                              setExplicit((old) => old.filter((x) => x !== skill.id));
                          })
                        }
                      />
                      Excluir {skill.name} v{skill.version}
                    </label>
                  </div>
                ))
            )}
          </details>
          <button
            type="button"
            disabled={!taskId || !taskVersion || result.isLoading}
            onClick={() =>
              void prepare({
                project,
                body: {
                  requestId: request.current,
                  taskId,
                  taskVersion,
                  ...(agent && { agent }),
                  ...(model && { model }),
                  ...(toolProfile === 'typescript-react-v1' && { toolProfile }),
                  profile,
                  mode,
                  explicitSkillIds: explicit,
                  excludedSkillIds: excluded,
                  memory,
                  includeMemory,
                  ...(query.trim() && { query: query.trim() }),
                },
              })
                .unwrap()
                .then(({ receipt: r }) => setReference({ id: r.id, hash: r.hash }))
                .catch(() => {})
            }
          >
            Preparar y previsualizar contexto
          </button>
          {result.isLoading && <p role="status">Preparando fuentes y selección…</p>}
          {result.error && <p role="alert">{errorMessage(result.error)}</p>}
          {receipt.error && <p role="alert">{errorMessage(receipt.error)}</p>}
          {reference && (
            <>
              <p>
                {valid
                  ? 'Contexto vigente listo para ejecutar'
                  : 'El contexto se está comprobando o quedó invalidado; prepara uno nuevo.'}
              </p>
              <ContextReceiptView project={project} id={reference.id} />
            </>
          )}
        </>
      )}
    </details>
  );
}
export function TeamContextOptions({
  value,
  onChange,
}: {
  value: z.infer<typeof contextPackConfigure> | null;
  onChange: (v: z.infer<typeof contextPackConfigure> | null) => void;
}) {
  return (
    <details className="context-pack-surface">
      <summary>Contexto por rol del equipo (P10)</summary>
      <label>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    profile: 'lean',
                    mode: 'suggested',
                    explicitSkillIds: [],
                    excludedSkillIds: [],
                    includeMemory: true,
                  }
                : null,
            )
          }
        />
        Preparar un recibo independiente para cada rol/fase
      </label>
      {value && (
        <>
          <label>
            Perfil de contexto del equipo
            <select
              value={value.profile}
              onChange={(e) =>
                onChange({ ...value, profile: e.target.value as typeof value.profile })
              }
            >
              <option value="lean">Lean</option>
              <option value="full">Full</option>
            </select>
          </label>
          <label>
            Selección de skills del equipo
            <select
              value={value.mode}
              onChange={(e) => onChange({ ...value, mode: e.target.value as typeof value.mode })}
            >
              <option value="manual">Solo skills vinculadas al rol</option>
              <option value="suggested">Sugerencias sin aplicar</option>
              <option value="automatic">Automática determinista</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.includeMemory}
              onChange={(e) => onChange({ ...value, includeMemory: e.target.checked })}
            />
            Buscar memoria vigente en modo automático
          </label>
          <p>
            Revisa los recibos en el plan antes de aprobarlo. Cada hijo conserva sus propias
            ampliaciones; el presupuesto y plazo del equipo siguen compartidos.
          </p>
        </>
      )}
    </details>
  );
}
function HybridLookup({ project }: { project: string }) {
  const [draft, setDraft] = useState(''),
    [query, setQuery] = useState('');
  const q = contextPacksApi.useHybridSearchQuery(query ? { project, query } : skipToken, {
    refetchOnFocus: true,
  });
  return (
    <section aria-label="Probar búsqueda híbrida">
      <h4>Búsqueda por ruta, símbolo o significado</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <label>
          Consulta híbrida
          <input
            required
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button>Buscar fuentes</button>
      </form>
      {q.isFetching && <p role="status">Buscando fuentes…</p>}
      {q.error && <p role="alert">{errorMessage(q.error)}</p>}
      {!q.error && q.currentData && (
        <>
          <p>
            {q.currentData.strategy} ·{' '}
            {q.currentData.fallback ?? 'Ramas léxica y vectorial disponibles'} ·{' '}
            {Math.round(q.currentData.elapsedMs)} ms{' '}
            {q.currentData.simulated ? '· Embeddings simulados' : ''}
          </p>
          {q.currentData.insufficient ? (
            <p>
              No hay fuentes seleccionadas; no demuestra que el proyecto carezca de esa información.
            </p>
          ) : (
            <Sources sources={q.currentData.sources} />
          )}
          <ul>
            {q.currentData.hits.map((h) => (
              <li key={h.source.id}>
                {h.source.path}: {h.reason.join(', ')} · ranking léxico {h.lexicalRank ?? 'ausente'}
                , vectorial {h.vectorRank ?? 'ausente'}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
export function ProjectContextPacks({ project }: { project: Project }) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(''),
    [markdown, setMarkdown] = useState(''),
    [paths, setPaths] = useState<string[]>([]),
    [mapVersion, setMapVersion] = useState(0),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState('');
  const q = contextPacksApi.useContextPacksQuery(open ? project.id : skipToken, poll),
    catalog = contextPacksApi.useContextCatalogQuery(open ? project.id : skipToken, {
      refetchOnFocus: true,
    });
  const [index, indexing] = contextPacksApi.useIndexPackCatalogMutation(),
    [generate, generating] = contextPacksApi.useDraftContextMapMutation(),
    [save, saving] = contextPacksApi.useSaveContextMapMutation(),
    [exportCatalog, exporting] = contextPacksApi.useExportPackCatalogMutation();
  const [rules, setRules] = useState<Rule[]>([]),
    [ruleVersion, setRuleVersion] = useState(0),
    [rulesDirty, setRulesDirty] = useState(false);
  const [savePolicy, policyState] = contextPacksApi.useSaveContextPackPolicyMutation();
  const skills = skillsApi.useSkillsQuery(open ? project.id : skipToken, { refetchOnFocus: true });
  const data = q.error ? undefined : q.currentData;
  useEffect(() => {
    if (data?.map && !dirty) {
      setMarkdown(data.map.markdown);
      setPaths(data.map.sources.map((s) => s.path));
      setMapVersion(data.map.version);
    }
    if (data && !rulesDirty) {
      setRules(data.policy.rules);
      setRuleVersion(data.policy.version);
    }
  }, [data, dirty, rulesDirty]);
  const available = skills.error
    ? []
    : (skills.currentData?.versions.filter((s) => s.review === 'approved') ?? []);
  function ruleFor(id: string): Rule {
    return (
      rules.find((r) => r.id === id) ?? {
        id,
        profiles: ['lean', 'full'],
        explicitOnly: false,
        dependsOn: [],
        excludes: [],
        keywordsEs: [],
        keywordsEn: [],
      }
    );
  }
  function updateRule(id: string, patch: Partial<Rule>) {
    setRules((old) => [...old.filter((r) => r.id !== id), { ...ruleFor(id), ...patch }]);
    setRulesDirty(true);
  }
  return (
    <details className="context-pack-surface" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Mapa, catálogo y recibos de contexto (P10)</summary>
      <p>
        El mapa breve vive en PostgreSQL y enlaza documentos versionados. El catálogo de
        archivos/fragmentos es incremental; el JSON exportado es una copia. Ningún texto recuperado
        amplía permisos.
      </p>
      {q.isLoading && <p role="status">Cargando preparación de contexto…</p>}
      {q.error && (
        <p role="alert">
          {errorMessage(q.error)}{' '}
          <button onClick={() => void q.refetch()}>Reintentar contexto</button>
        </p>
      )}
      {data && (
        <>
          <section aria-label="Catálogo de contexto">
            <h3>Catálogo de fuentes</h3>
            {catalog.error && (
              <p role="alert">
                {errorMessage(catalog.error)}{' '}
                <button onClick={() => void catalog.refetch()}>Consultar catálogo</button>
              </p>
            )}
            {!catalog.error && catalog.currentData && (
              <p>
                {catalog.currentData.documents.length} documentos ·{' '}
                {catalog.currentData.documents.reduce((n, d) => n + d.chunks.length, 0)} fragmentos
                · {catalog.currentData.partial ? 'Snapshot parcial' : 'Snapshot completo'} ·{' '}
                {catalog.currentData.embeddingSpace === 'lexical-v1'
                  ? 'Solo léxico'
                  : catalog.currentData.embeddingIdentity
                    ? 'Embeddings locales configurados'
                    : 'Embeddings no disponibles: posible recuperación léxica'}
              </p>
            )}
            {!project.archivedAt && (
              <>
                <button
                  disabled={indexing.isLoading}
                  onClick={() =>
                    void index({ project: project.id, lexicalOnly: true })
                      .unwrap()
                      .then(() =>
                        setMessage(
                          'Catálogo léxico actualizado. El chat vectorial requiere un índice con embeddings.',
                        ),
                      )
                      .catch(() => {})
                  }
                >
                  Actualizar catálogo léxico
                </button>
                <button
                  disabled={indexing.isLoading}
                  onClick={() =>
                    void index({ project: project.id, lexicalOnly: false })
                      .unwrap()
                      .then(() => setMessage('Catálogo y vectores locales actualizados.'))
                      .catch(() => {})
                  }
                >
                  Actualizar catálogo con embeddings locales
                </button>
              </>
            )}
            {indexing.isLoading && <p role="status">Actualizando catálogo de fuentes…</p>}
            {indexing.error && <p role="alert">{errorMessage(indexing.error)}</p>}
            <button
              disabled={exporting.isLoading || !catalog.currentData || !!catalog.error}
              onClick={() =>
                void exportCatalog(project.id)
                  .unwrap()
                  .then((d) => download(`context-catalog-${project.id}.json`, d))
                  .catch(() => {})
              }
            >
              Exportar catálogo JSON
            </button>
            {exporting.error && <p role="alert">{errorMessage(exporting.error)}</p>}
          </section>
          <section aria-label="Mapa del proyecto">
            <h3>Mapa breve del proyecto</h3>
            {project.archivedAt ? (
              <pre className="skill-text">{data.map?.markdown ?? 'Sin mapa guardado.'}</pre>
            ) : (
              <>
                <button
                  disabled={generating.isLoading || !!catalog.error}
                  onClick={() =>
                    void generate(project.id)
                      .unwrap()
                      .then((r) => {
                        setMarkdown(r.markdown);
                        setPaths(r.paths);
                        setMapVersion(data.map?.version ?? 0);
                        setDirty(true);
                      })
                      .catch(() => {})
                  }
                >
                  Proponer mapa desde documentos existentes
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save({
                      project: project.id,
                      body: { version: mapVersion, markdown, paths },
                    })
                      .unwrap()
                      .then(() => {
                        setDirty(false);
                        setMessage(
                          'Mapa versionado guardado. Los recibos anteriores deben comprobarse de nuevo.',
                        );
                      })
                      .catch(() => {});
                  }}
                >
                  <label>
                    Mapa Markdown
                    <textarea
                      required
                      maxLength={8000}
                      rows={14}
                      value={markdown}
                      onChange={(e) => {
                        setMarkdown(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </label>
                  <fieldset>
                    <legend>Documentos del repositorio que respaldan el mapa (hasta cinco)</legend>
                    {!catalog.error &&
                      catalog.currentData?.documents
                        .filter((d) => d.kind === 'file' && /\.md$/i.test(d.path))
                        .map((d) => (
                          <label key={d.path}>
                            <input
                              type="checkbox"
                              checked={paths.includes(d.path)}
                              disabled={paths.length >= 5 && !paths.includes(d.path)}
                              onChange={(e) => {
                                setPaths((old) =>
                                  e.target.checked
                                    ? [...old, d.path]
                                    : old.filter((p) => p !== d.path),
                                );
                                setDirty(true);
                              }}
                            />
                            {d.path}
                          </label>
                        ))}
                  </fieldset>
                  {dirty && mapVersion !== (data.map?.version ?? 0) && (
                    <p role="alert">
                      El mapa cambió desde que abriste el borrador. Guarda una nueva propuesta tras
                      revisar la versión actual.
                    </p>
                  )}
                  <button disabled={saving.isLoading || !markdown.trim()}>
                    Guardar mapa del proyecto
                  </button>
                </form>
                {generating.error && <p role="alert">{errorMessage(generating.error)}</p>}
                {saving.error && <p role="alert">{errorMessage(saving.error)}</p>}
              </>
            )}
          </section>
          <HybridLookup project={project.id} />
          <details>
            <summary>Política de skills: perfiles, dependencias e invocación</summary>
            <p>
              Reglas por versión revisada. Las dependencias no autorizan recursos bloqueados; una
              skill de invocación explícita debe elegirse por ID en el preparador.
            </p>
            {skills.error && <p role="alert">{errorMessage(skills.error)}</p>}
            <fieldset disabled={!!project.archivedAt || policyState.isLoading}>
              {available.map((s) => {
                const rule = ruleFor(s.id);
                return (
                  <details key={s.id}>
                    <summary>
                      {s.name} v{s.version}
                    </summary>
                    <label>
                      <input
                        type="checkbox"
                        checked={rule.explicitOnly}
                        onChange={(e) => updateRule(s.id, { explicitOnly: e.target.checked })}
                      />
                      Requiere invocación explícita
                    </label>
                    {(['lean', 'full'] as const).map((profile) => (
                      <label key={profile}>
                        <input
                          type="checkbox"
                          checked={rule.profiles.includes(profile)}
                          onChange={(e) =>
                            updateRule(s.id, {
                              profiles: e.target.checked
                                ? [...rule.profiles, profile]
                                : rule.profiles.filter((p) => p !== profile),
                            })
                          }
                        />
                        Disponible en {profile}
                      </label>
                    ))}
                    <label>
                      Palabras en español
                      <input
                        defaultValue={rule.keywordsEs.join(', ')}
                        onBlur={(e) =>
                          updateRule(s.id, {
                            keywordsEs: e.target.value
                              .split(',')
                              .map((x) => x.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                    <label>
                      Palabras en inglés
                      <input
                        defaultValue={rule.keywordsEn.join(', ')}
                        onBlur={(e) =>
                          updateRule(s.id, {
                            keywordsEn: e.target.value
                              .split(',')
                              .map((x) => x.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                    <label>
                      Dependencias
                      <select
                        multiple
                        value={rule.dependsOn}
                        onChange={(e) =>
                          updateRule(s.id, {
                            dependsOn: [...e.target.selectedOptions].map((x) => x.value),
                          })
                        }
                      >
                        {available
                          .filter((x) => x.id !== s.id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} v{x.version}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Exclusiones mutuas
                      <select
                        multiple
                        value={rule.excludes}
                        onChange={(e) =>
                          updateRule(s.id, {
                            excludes: [...e.target.selectedOptions].map((x) => x.value),
                          })
                        }
                      >
                        {available
                          .filter((x) => x.id !== s.id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} v{x.version}
                            </option>
                          ))}
                      </select>
                    </label>
                  </details>
                );
              })}
            </fieldset>
            {!project.archivedAt && (
              <button
                disabled={policyState.isLoading}
                onClick={() => {
                  const parsed = contextPackPolicyInput.safeParse({ version: ruleVersion, rules });
                  if (!parsed.success) {
                    setMessage('Revisa perfiles y límites de las reglas antes de guardarlas.');
                    return;
                  }
                  void savePolicy({ project: project.id, body: parsed.data })
                    .unwrap()
                    .then(() => {
                      setRulesDirty(false);
                      setMessage('Política versionada guardada.');
                    })
                    .catch(() => {});
                }}
              >
                Guardar política de skills
              </button>
            )}
            {policyState.error && <p role="alert">{errorMessage(policyState.error)}</p>}
          </details>
          <section aria-label="Recibos de contexto">
            <h3>Recibos guardados</h3>
            {!data.receipts.length && (
              <p>Sin recibos. Prepara contexto desde un trabajo o un plan.</p>
            )}
            {data.receipts.map((r) => (
              <p key={r.id}>
                <button onClick={() => setSelected(r.id)}>
                  {r.phase} · {r.jobId ? 'Ejecución' : 'Previsualización'} · {r.createdAt}
                </button>
              </p>
            ))}
            {selected && <ContextReceiptView key={selected} project={project.id} id={selected} />}
          </section>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
