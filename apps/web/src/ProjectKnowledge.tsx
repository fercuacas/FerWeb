import { useEffect, useRef, useState } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import { z } from 'zod';
import {
  memoryDraft,
  memorySourceInput,
  type memoryEntry,
  type memorySelection,
  type Project,
} from '@ferweb/contracts';
import { memoryApi } from './memory-store';
import { errorMessage } from './workspace-store';
import './memory.css';
import { ProjectContextPacks } from './ContextPacks';
type Entry = z.infer<typeof memoryEntry>;
export type MemorySelection = z.infer<typeof memorySelection>;
const poll = { pollingInterval: 4000, refetchOnFocus: true };
const notice =
  'Datos sin revisar: no conceden permisos ni sustituyen las fuentes. Un hash identifica contenido, no demuestra que siga vigente.';
const selection = (e: Entry): MemorySelection => ({ id: e.id, revision: e.revision, hash: e.hash });
export function MemoryText({ entry }: { entry: Entry }) {
  return (
    <article aria-label="Entrada de memoria">
      <h4>
        {entry.title} · v{entry.revision}
      </h4>
      <p>
        {entry.kind} · {entry.status === 'active' ? 'Activa' : 'Retirada'} ·{' '}
        {entry.validity === 'current' ? 'Vigente' : 'Histórica'} ·{' '}
        {entry.evidenceState === 'none'
          ? 'Sin evidencia'
          : 'Fuentes referenciadas; contenido sin revisar'}
      </p>
      <pre className="skill-text">{entry.content}</pre>
      {entry.lesson && (
        <dl>
          <dt>Fallo observado</dt>
          <dd>{entry.lesson.failure}</dd>
          <dt>Decisión</dt>
          <dd>{entry.lesson.decision}</dd>
          <dt>Validación</dt>
          <dd>{entry.lesson.validation ?? 'No disponible'}</dd>
        </dl>
      )}
      <p>
        Observado: {entry.observedAt} · Registrado: {entry.recordedAt} · Fin:{' '}
        {entry.validUntil ?? 'Abierto'}
      </p>
      <p className="skill-text">
        ID: {entry.id} · Hash: {entry.hash} · Revisión anterior:{' '}
        {entry.previousRevision ?? 'Ninguna'}
      </p>
      <p>
        Autor: {entry.origin.userId} · Origen: {entry.origin.kind} / {entry.origin.label}
      </p>
      {entry.origin.reported && (
        <details>
          <summary>Metadatos declarados en la importación</summary>
          <pre className="skill-text">{JSON.stringify(entry.origin.reported, null, 2)}</pre>
        </details>
      )}
      <p>
        Etiquetas: {entry.tags.join(', ') || 'Ninguna'} · Destinos:{' '}
        {entry.targets.join(', ') || 'Sin restricción de búsqueda'}
      </p>
      <ul>
        {entry.evidence.map((s, i) => (
          <li key={i}>
            <pre className="skill-text">{JSON.stringify(s.input, null, 2)}</pre>
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.input.kind === 'code' && s.input.canonical
                  ? 'Documento canónico'
                  : 'Fuente en GitHub'}
              </a>
            )}
            <span className="skill-text"> · {s.hash}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
function SelectedMemory({
  project,
  item,
  onValidity,
}: {
  project: string;
  item: MemorySelection;
  onValidity: (id: string, valid: boolean) => void;
}) {
  const q = memoryApi.useMemoryReadQuery({ project, id: item.id }, poll);
  const e = q.error ? undefined : q.currentData?.entry;
  const valid =
    !!e &&
    e.revision === item.revision &&
    e.hash === item.hash &&
    e.status === 'active' &&
    e.validity === 'current';
  useEffect(() => onValidity(item.id, valid), [item.id, valid, onValidity]);
  return (
    <>
      {q.isLoading && <p role="status">Comprobando memoria…</p>}
      {q.error && <p role="alert">{errorMessage(q.error)}</p>}
      {e && (
        <>
          <p>
            {e.title} v{item.revision} ·{' '}
            {valid ? 'Vigente' : 'Selección cambiada o retirada: elimínala y vuelve a seleccionar'}
          </p>
          <details>
            <summary>Ver memoria seleccionada</summary>
            <MemoryText entry={e} />
          </details>
        </>
      )}
    </>
  );
}
export function MemoryPicker({
  project,
  value,
  onChange,
  onValidity,
}: {
  project: string;
  value: MemorySelection[];
  onChange: (v: MemorySelection[]) => void;
  onValidity: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0),
    [id, setId] = useState(''),
    [lookup, setLookup] = useState('');
  const [valid, setValid] = useState<Record<string, boolean>>({});
  const q = memoryApi.useMemorySearchQuery(
    open ? { project, body: { query, cursor } } : skipToken,
    poll,
  );
  const direct = memoryApi.useMemoryReadQuery(
    open && lookup ? { project, id: lookup } : skipToken,
    poll,
  );
  const update = useRef((id: string, ok: boolean) =>
    setValid((old) => (old[id] === ok ? old : { ...old, [id]: ok })),
  ).current;
  const ok = value.every((x) => valid[x.id] === true);
  useEffect(() => onValidity(ok), [ok, onValidity]);
  return (
    <section className="memory-picker" aria-label="Memoria para la ejecución">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Memoria de proyecto (opcional, máximo tres)</summary>
        <p>{notice} Solo se enviarán las entradas que selecciones expresamente.</p>
        <label>
          Buscar memoria
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
          />
        </label>
        <label>
          ID de memoria para seleccionar
          <input value={id} onChange={(e) => setId(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={!z.uuid().safeParse(id).success}
          onClick={() => setLookup(id)}
        >
          Consultar ID para seleccionar
        </button>
        {direct.error && <p role="alert">{errorMessage(direct.error)}</p>}
        {!direct.error && direct.currentData && (
          <>
            <MemoryText entry={direct.currentData.entry} />
            <button
              type="button"
              disabled={
                value.length >= 3 ||
                value.some((x) => x.id === direct.currentData!.entry.id) ||
                direct.currentData.entry.status !== 'active'
              }
              onClick={() => onChange([...value, selection(direct.currentData!.entry)])}
            >
              Seleccionar memoria por ID
            </button>
          </>
        )}
        {q.error && <p role="alert">{errorMessage(q.error)}</p>}
        {q.isLoading && <p role="status">Buscando memoria…</p>}
        {!q.error && q.currentData && (
          <>
            <p>
              {q.currentData.complete
                ? 'Consulta completa'
                : 'Consulta incompleta: puede faltar memoria accesible'}
            </p>
            {q.currentData.entries
              .filter((x) => x.status === 'active' && x.validity === 'current')
              .map((e) => (
                <p key={e.id}>
                  {e.title} v{e.revision}{' '}
                  <button
                    type="button"
                    disabled={value.length >= 3 || value.some((x) => x.id === e.id)}
                    onClick={() => onChange([...value, selection(e)])}
                  >
                    Seleccionar {e.title}
                  </button>
                </p>
              ))}
            {q.currentData.nextCursor !== null && (
              <button type="button" onClick={() => setCursor(q.currentData!.nextCursor!)}>
                Consultar más memoria
              </button>
            )}
            {cursor > 0 && (
              <button type="button" onClick={() => setCursor(0)}>
                Inicio de memoria
              </button>
            )}
          </>
        )}
      </details>
      {value.map((item) => (
        <div key={item.id}>
          <SelectedMemory project={project} item={item} onValidity={update} />
          <button type="button" onClick={() => onChange(value.filter((x) => x.id !== item.id))}>
            Quitar memoria {item.id}
          </button>
        </div>
      ))}
    </section>
  );
}
const blank = (): z.infer<typeof memoryDraft> => ({
  kind: 'note',
  title: '',
  content: '',
  observedAt: new Date().toISOString(),
  status: 'active',
  tags: [],
  targets: [],
  lesson: null,
  sources: [],
});
function SourceEditor({
  value,
  onChange,
}: {
  value: z.infer<typeof memorySourceInput>[];
  onChange: (v: z.infer<typeof memorySourceInput>[]) => void;
}) {
  const [kind, setKind] = useState<'code' | 'task' | 'job' | 'delivery'>('code'),
    [id, setId] = useState(''),
    [step, setStep] = useState(''),
    [path, setPath] = useState(''),
    [commit, setCommit] = useState(''),
    [start, setStart] = useState(1),
    [end, setEnd] = useState(1),
    [version, setVersion] = useState(1),
    [canonical, setCanonical] = useState(false),
    [error, setError] = useState('');
  function add() {
    const parsed = memorySourceInput.safeParse(
      kind === 'code'
        ? { kind, path, commit, startLine: start, endLine: end, canonical }
        : kind === 'delivery'
          ? { kind, executionId: id, stepId: step }
          : kind === 'task'
            ? { kind, id, version }
            : { kind, id },
    );
    if (!parsed.success) {
      setError('Completa una referencia válida, con UUID o commit y líneas según el tipo.');
      return;
    }
    onChange([...value, parsed.data]);
    setError('');
  }
  return (
    <fieldset>
      <legend>Fuentes (hasta ocho; opcionales)</legend>
      <p>
        El servidor comprueba pertenencia, acceso y versión. Una referencia no demuestra la
        afirmación.
      </p>
      <label>
        Tipo de fuente
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="code">Código</option>
          <option value="task">Tarea</option>
          <option value="job">Trabajo</option>
          <option value="delivery">Entrega verificada de equipo</option>
        </select>
      </label>
      {kind === 'code' ? (
        <>
          <label>
            Ruta de archivo
            <input value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          <label>
            Commit de la fuente
            <input value={commit} onChange={(e) => setCommit(e.target.value)} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={canonical}
              onChange={(e) => setCanonical(e.target.checked)}
            />
            Documento canónico versionado (Markdown)
          </label>
          <label>
            Línea inicial
            <input
              type="number"
              min="1"
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label>
            Línea final
            <input
              type="number"
              min="1"
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            ID de{' '}
            {kind === 'delivery' ? 'ejecución de equipo' : kind === 'task' ? 'tarea' : 'trabajo'}
            <input value={id} onChange={(e) => setId(e.target.value)} />
          </label>
          {kind === 'task' && (
            <label>
              Versión de tarea
              <input
                type="number"
                min="1"
                value={version}
                onChange={(e) => setVersion(Number(e.target.value))}
              />
            </label>
          )}
          {kind === 'delivery' && (
            <label>
              ID de etapa
              <input value={step} onChange={(e) => setStep(e.target.value)} />
            </label>
          )}
        </>
      )}
      <button type="button" disabled={value.length >= 8} onClick={add}>
        Añadir referencia
      </button>
      {error && <p role="alert">{error}</p>}
      <ul>
        {value.map((s, i) => (
          <li key={i}>
            <code>{JSON.stringify(s)}</code>{' '}
            <button type="button" onClick={() => onChange(value.filter((_, n) => n !== i))}>
              Quitar referencia {i + 1}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
function MemoryEditor({
  project,
  initial,
  onSaved,
}: {
  project: string;
  initial?: Entry;
  onSaved: (id: string) => void;
}) {
  const [draft, setDraft] = useState(() =>
    initial
      ? memoryDraft.parse(
          Object.fromEntries(Object.keys(blank()).map((k) => [k, initial[k as keyof Entry]])),
        )
      : blank(),
  );
  const [error, setError] = useState('');
  const request = useRef(crypto.randomUUID());
  const [create, creating] = memoryApi.useMemoryCreateMutation(),
    [correct, correcting] = memoryApi.useMemoryCorrectMutation();
  const busy = creating.isLoading || correcting.isLoading;
  function field<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    request.current = crypto.randomUUID();
  }
  return (
    <form
      className="job-form"
      aria-label={initial ? 'Corregir memoria' : 'Crear memoria'}
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        const parsed = memoryDraft.safeParse(draft);
        if (!parsed.success) {
          setError(
            'Revisa los campos y los límites de la memoria. Las lecciones requieren fallo y decisión.',
          );
          return;
        }
        void (
          initial
            ? correct({
                project,
                id: initial.id,
                body: { version: initial.revision, entry: parsed.data },
              })
            : create({ project, body: { requestId: request.current, entry: parsed.data } })
        )
          .unwrap()
          .then((r) => onSaved(r.selection.id))
          .catch((e) => setError(errorMessage(e)));
      }}
    >
      <fieldset disabled={busy}>
        <legend>{initial ? 'Nueva revisión de memoria' : 'Nueva memoria'}</legend>
        <label>
          Título de memoria
          <input
            required
            maxLength={160}
            value={draft.title}
            onChange={(e) => field('title', e.target.value)}
          />
        </label>
        <label>
          Clase de memoria
          <select
            value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as typeof draft.kind;
              setDraft((d) => ({
                ...d,
                kind,
                lesson: kind === 'lesson' ? { failure: '', decision: '', validation: null } : null,
              }));
              request.current = crypto.randomUUID();
            }}
          >
            {memoryDraft.shape.kind.options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contenido de memoria
          <textarea
            required
            maxLength={4000}
            value={draft.content}
            onChange={(e) => field('content', e.target.value)}
          />
        </label>
        <label>
          Fecha observada (ISO UTC)
          <input
            required
            value={draft.observedAt}
            onChange={(e) => field('observedAt', e.target.value)}
          />
        </label>
        <label>
          Estado de memoria
          <select
            value={draft.status}
            onChange={(e) => field('status', e.target.value as typeof draft.status)}
          >
            <option value="active">Activa</option>
            <option value="retired">Retirada</option>
          </select>
        </label>
        <label>
          Etiquetas, separadas por comas
          <input
            defaultValue={draft.tags.join(',')}
            onBlur={(e) =>
              field(
                'tags',
                e.target.value
                  .split(',')
                  .filter(Boolean)
                  .map((x) => x.trim()),
              )
            }
          />
        </label>
        <label>
          Destinos, separados por comas
          <input
            defaultValue={draft.targets.join(',')}
            onBlur={(e) =>
              field(
                'targets',
                e.target.value
                  .split(',')
                  .filter(Boolean)
                  .map((x) => x.trim()),
              )
            }
          />
        </label>
        <p>Etiquetas y destinos: minúsculas, números, guiones; no conceden capacidades.</p>
        {draft.lesson && (
          <>
            <label>
              Fallo observado
              <textarea
                required
                maxLength={1000}
                value={draft.lesson.failure}
                onChange={(e) => field('lesson', { ...draft.lesson!, failure: e.target.value })}
              />
            </label>
            <label>
              Decisión tomada
              <textarea
                required
                maxLength={1000}
                value={draft.lesson.decision}
                onChange={(e) => field('lesson', { ...draft.lesson!, decision: e.target.value })}
              />
            </label>
            <label>
              Validación disponible
              <textarea
                maxLength={1000}
                value={draft.lesson.validation ?? ''}
                onChange={(e) =>
                  field('lesson', { ...draft.lesson!, validation: e.target.value || null })
                }
              />
            </label>
          </>
        )}
        <SourceEditor value={draft.sources} onChange={(v) => field('sources', v)} />
        <button className="primary-button" disabled={busy}>
          {initial ? 'Guardar corrección' : 'Guardar memoria'}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function MemoryDetails({
  project,
  id,
  onClose,
  onExport,
}: {
  project: Project;
  id: string;
  onClose: () => void;
  onExport: (entry: Entry) => void;
}) {
  const q = memoryApi.useMemoryReadQuery({ project: project.id, id }, poll),
    h = memoryApi.useMemoryHistoryQuery({ project: project.id, id }, poll);
  const [editing, setEditing] = useState(false);
  const e = q.error ? undefined : q.currentData?.entry;
  return (
    <section aria-label="Detalle de memoria">
      <button onClick={onClose}>Cerrar memoria</button>
      {q.isLoading && <p role="status">Cargando memoria…</p>}
      {q.error && (
        <p role="alert">
          {errorMessage(q.error)} <button onClick={() => void q.refetch()}>Reintentar</button>
        </p>
      )}
      {e && (
        <>
          <MemoryText entry={e} />
          <button onClick={() => onExport(e)}>Incluir esta memoria en exportación</button>
          {!project.archivedAt && (
            <button onClick={() => setEditing((v) => !v)}>Corregir o retirar memoria</button>
          )}
          {editing && !project.archivedAt && (
            <MemoryEditor
              key={e.revision}
              project={project.id}
              initial={e}
              onSaved={() => setEditing(false)}
            />
          )}
        </>
      )}
      <details>
        <summary>Historial autorizado de revisiones</summary>
        {h.error ? (
          <p role="alert">{errorMessage(h.error)}</p>
        ) : (
          h.currentData && (
            <>
              <p>
                {h.currentData.complete
                  ? 'Historial completo'
                  : 'Historial incompleto: fuentes o revisiones no disponibles'}
              </p>
              {h.currentData.entries.map((entry) => (
                <MemoryText key={entry.revision} entry={entry} />
              ))}
            </>
          )
        )}
      </details>
    </section>
  );
}
export function ProjectKnowledge({ project }: { project: Project }) {
  const [query, setQuery] = useState(''),
    [target, setTarget] = useState(''),
    [asOf, setAsOf] = useState(''),
    [cursor, setCursor] = useState(0),
    [selected, setSelected] = useState(''),
    [lookup, setLookup] = useState('');
  const [exports, setExports] = useState<MemorySelection[]>([]),
    [imported, setImported] = useState<MemorySelection[]>([]),
    [message, setMessage] = useState(''),
    [file, setFile] = useState<{ name: string; content: string; format: 'json' | 'markdown' }>();
  const [exportMemory, exporting] = memoryApi.useMemoryExportMutation(),
    [importMemory, importing] = memoryApi.useMemoryImportMutation();
  const request = useRef(crypto.randomUUID());
  const q = memoryApi.useMemorySearchQuery(
    {
      project: project.id,
      body: { query, ...(target && { target }), ...(asOf && { asOf }), cursor },
    },
    poll,
  );
  const result = q.error ? undefined : q.currentData;
  const [creating, setCreating] = useState(false);
  async function download(format: 'json' | 'markdown') {
    setMessage('');
    try {
      const r = await exportMemory({
        project: project.id,
        body: { selections: exports, format },
      }).unwrap();
      const url = URL.createObjectURL(new Blob([r.content], { type: r.mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Selección exportada; las fuentes se volverán a validar al importarla.');
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }
  return (
    <section className="project-knowledge" aria-label="Conocimiento del proyecto">
      <h2>Conocimiento del proyecto</h2>
      <ProjectContextPacks project={project} />
      <p>{notice}</p>
      <p>
        La base de datos conserva las revisiones. Los archivos exportados son copias de la
        selección, no un índice completo del proyecto.
      </p>
      {project.archivedAt && <p>Proyecto archivado: solo consulta y exportación.</p>}
      <label>
        Buscar en memoria
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
        />
      </label>
      <label>
        Filtrar destino
        <input
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setCursor(0);
          }}
        />
      </label>
      <label>
        Conocido en esta fecha
        <input
          type="datetime-local"
          onChange={(e) => {
            setAsOf(e.target.value ? new Date(e.target.value).toISOString() : '');
            setCursor(0);
          }}
        />
      </label>
      {q.isLoading && <p role="status">Consultando memoria…</p>}
      {q.error && (
        <p role="alert">
          {errorMessage(q.error)} <button onClick={() => void q.refetch()}>Reintentar</button>
        </p>
      )}
      {result && (
        <>
          <p role="status">
            {result.complete
              ? result.state === 'empty'
                ? 'Consulta completa: sin resultados'
                : 'Consulta completa'
              : `Consulta ${result.state === 'unavailable' ? 'no disponible' : 'incompleta'}: puede faltar información`}
          </p>
          {result.entries.map((e) => (
            <div key={e.id}>
              <button onClick={() => setSelected(e.id)}>
                {e.title} · v{e.revision}
              </button>
              <span>
                {' '}
                · {e.evidenceState === 'none' ? 'Sin evidencia' : 'Fuentes referenciadas'} ·{' '}
                {e.validity === 'historical' ? 'Histórica' : 'Vigente'}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={exports.some((x) => x.id === e.id && x.revision === e.revision)}
                  disabled={!exports.some((x) => x.id === e.id) && exports.length >= 10}
                  onChange={(event) =>
                    setExports((old) =>
                      event.target.checked
                        ? [...old.filter((x) => x.id !== e.id), selection(e)]
                        : old.filter((x) => x.id !== e.id),
                    )
                  }
                />
                Incluir {e.title} en exportación
              </label>
              {asOf && (
                <details>
                  <summary>Ver revisión en la fecha consultada</summary>
                  <MemoryText entry={e} />
                </details>
              )}
            </div>
          ))}
          {result.nextCursor !== null && (
            <button onClick={() => setCursor(result.nextCursor!)}>
              Consultar siguiente ventana de memoria
            </button>
          )}
          {cursor > 0 && <button onClick={() => setCursor(0)}>Volver al inicio de memoria</button>}
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (z.uuid().safeParse(lookup).success) setSelected(lookup);
          else setMessage('Introduce un UUID de memoria válido.');
        }}
      >
        <label>
          Recuperar por ID
          <input value={lookup} onChange={(e) => setLookup(e.target.value)} />
        </label>
        <button>Abrir ID de memoria</button>
      </form>
      {selected && (
        <MemoryDetails
          key={selected}
          project={project}
          id={selected}
          onClose={() => setSelected('')}
          onExport={(entry) => {
            if (exports.length >= 10 && !exports.some((x) => x.id === entry.id)) {
              setMessage('Exporta hasta diez entradas por selección.');
              return;
            }
            setExports((old) => [...old.filter((x) => x.id !== entry.id), selection(entry)]);
            setMessage('Entrada incluida en la selección de exportación.');
          }}
        />
      )}
      <p>Selección exportable: {exports.length} entradas.</p>
      <button
        disabled={!exports.length || exporting.isLoading}
        onClick={() => void download('json')}
      >
        Exportar selección JSON
      </button>
      <button
        disabled={exports.length !== 1 || exporting.isLoading}
        onClick={() => void download('markdown')}
      >
        Exportar selección Markdown
      </button>
      <button disabled={!exports.length} onClick={() => setExports([])}>
        Vaciar selección
      </button>
      {!project.archivedAt && (
        <>
          <button onClick={() => setCreating((v) => !v)}>Nueva entrada de memoria</button>
          {creating && (
            <MemoryEditor
              project={project.id}
              onSaved={(id) => {
                setCreating(false);
                setSelected(id);
              }}
            />
          )}
          <section aria-label="Importar memoria">
            <h3>Importar memoria portable</h3>
            <p>
              Hasta 32 KB y diez entradas. Se valida todo antes de guardar; el contenido importado
              permanece sin revisar.
            </p>
            <label>
              Archivo de memoria
              <input
                type="file"
                accept=".json,.md,.markdown"
                onChange={(e) => {
                  setFile(undefined);
                  setMessage('');
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 32000) {
                    setMessage('El archivo supera 32 KB.');
                    return;
                  }
                  void f
                    .arrayBuffer()
                    .then((data) => {
                      setFile({
                        name: f.name,
                        content: new TextDecoder('utf-8', { fatal: true }).decode(data),
                        format: f.name.toLowerCase().endsWith('.json') ? 'json' : 'markdown',
                      });
                      request.current = crypto.randomUUID();
                    })
                    .catch(() => setMessage('Archivo UTF-8 no válido.'));
                }}
              />
            </label>
            {file && (
              <>
                <p>
                  {file.name} · {file.format}
                </p>
                <details>
                  <summary>Revisar contenido importado</summary>
                  <pre className="skill-text">{file.content}</pre>
                </details>
                <button
                  disabled={importing.isLoading}
                  onClick={() => {
                    setMessage('');
                    void importMemory({
                      project: project.id,
                      body: {
                        requestId: request.current,
                        format: file.format,
                        content: file.content,
                      },
                    })
                      .unwrap()
                      .then((r) => {
                        setMessage(`Importadas ${r.selections.length} entradas sin revisar.`);
                        setImported(r.selections);
                        setFile(undefined);
                      })
                      .catch((e) => setMessage(errorMessage(e)));
                  }}
                >
                  Importar archivo completo
                </button>
              </>
            )}
          </section>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {!!imported.length && (
        <details>
          <summary>Entradas de la última importación</summary>
          {imported.map((item) => (
            <p key={item.id}>
              <button onClick={() => setSelected(item.id)}>Ver entrada importada {item.id}</button>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
export function SaveDeliveryMemory({
  project,
  executionId,
  stepId,
  content,
}: {
  project: string;
  executionId: string;
  stepId: string;
  content: string;
}) {
  const [title, setTitle] = useState('Entrega de equipo'),
    [body, setBody] = useState(content),
    [message, setMessage] = useState('');
  const request = useRef(crypto.randomUUID());
  const [save, state] = memoryApi.useMemoryCreateMutation();
  const observedAt = useRef(new Date().toISOString()).current;
  return (
    <details>
      <summary>Guardar entrega como memoria de proyecto</summary>
      <p>Guardado explícito del propietario; quedará sin revisar y con la entrega como fuente.</p>
      <label>
        Título de la entrega
        <input
          maxLength={160}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            request.current = crypto.randomUUID();
          }}
        />
      </label>
      <label>
        Resumen para reutilizar
        <textarea
          maxLength={4000}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            request.current = crypto.randomUUID();
          }}
        />
      </label>
      <button
        disabled={state.isLoading || !title.trim() || !body.trim() || body.length > 4000}
        onClick={() => {
          void save({
            project,
            body: {
              requestId: request.current,
              entry: {
                ...blank(),
                observedAt,
                kind: 'handoff',
                title,
                content: body,
                sources: [{ kind: 'delivery', executionId, stepId }],
              },
            },
          })
            .unwrap()
            .then(() =>
              setMessage(
                'Entrega guardada. Puedes consultarla en Conocimiento y seleccionarla en otra ejecución.',
              ),
            )
            .catch((e) => setMessage(errorMessage(e)));
        }}
      >
        Guardar entrega en memoria
      </button>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
