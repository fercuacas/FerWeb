import { useState } from 'react';
import { z } from 'zod';
import type { LearningHealth, LearningInput, Project } from '@ferweb/contracts';
import { learningApi } from './learning-store';
import { memoryApi } from './memory-store';
import { errorMessage } from './workspace-store';

const states = {
  proposed: 'Pendiente de revisión',
  approved: 'Revisada',
  rejected: 'Rechazada',
  adopted: 'Adoptada',
  reverted: 'Revertida',
};
const labels = { supportive: 'Favorable', neutral: 'Neutral', competing: 'En tensión' };
const observed = {
  passed: 'Observada con éxito',
  failed: 'Fallida',
  unobserved: 'Datos insuficientes',
};
const grade = {
  passed: 'Aprobado',
  failed: 'Fallido',
  unverifiable: 'Sin verificar',
  not_run: 'Sin ejecutar',
};
const origin = { real: 'Real', simulated: 'Simulada', unknown: 'Desconocida', mixed: 'Mixta' };
const failures = {
  configuration: 'Configuración',
  verification: 'Verificación',
  artifact: 'Entrega',
  timeout: 'Plazo',
  agent: 'Agente',
  other: 'Otro',
  unknown: 'Desconocido',
};

export function ProposeLesson({
  project,
  evaluationId,
}: {
  project: string;
  evaluationId: string;
}) {
  const [title, setTitle] = useState('');
  const [failure, setFailure] = useState('');
  const [correction, setCorrection] = useState('');
  const [arm, setArm] = useState<LearningInput['arm']>('solo');
  const [memoryId, setMemoryId] = useState('');
  const [lookup, setLookup] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [saved, setSaved] = useState(false);
  const memory = memoryApi.useMemoryReadQuery(
    { project, id: lookup },
    { skip: !lookup || lookup !== memoryId.trim(), refetchOnFocus: true },
  );
  const entry = memory.error ? null : memory.currentData?.entry;
  const replaces =
    entry?.kind === 'lesson' && entry.status === 'active' && entry.current
      ? { id: entry.id, hash: entry.hash, revision: entry.revision }
      : undefined;
  const [propose, result] = learningApi.useProposeLessonMutation();
  return (
    <details>
      <summary>Proponer lección de la corrección</summary>
      <form
        className="lab-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          void propose({
            project,
            body: {
              requestId,
              evaluationId,
              arm,
              title,
              failure,
              correction,
              ...(replaces && { replaces }),
            },
          })
            .unwrap()
            .then(() => {
              setTitle('');
              setFailure('');
              setCorrection('');
              setMemoryId('');
              setLookup('');
              setRequestId(crypto.randomUUID());
              setSaved(true);
            })
            .catch(() => {});
        }}
      >
        <label>
          Ejecución de la corrección
          <select value={arm} onChange={(e) => setArm(e.target.value as LearningInput['arm'])}>
            <option value="solo">Agente único</option>
            <option value="team">Equipo</option>
          </select>
        </label>
        <label>
          Título de la lección
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Fallo observado
          <textarea
            required
            maxLength={1000}
            value={failure}
            onChange={(e) => setFailure(e.target.value)}
          />
        </label>
        <label>
          Corrección propuesta
          <textarea
            required
            maxLength={1000}
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
          />
        </label>
        <label>
          ID de lección previa (opcional)
          <input value={memoryId} onChange={(e) => setMemoryId(e.target.value)} />
        </label>
        {memoryId && (
          <button
            type="button"
            className="secondary-button"
            disabled={!z.uuid().safeParse(memoryId.trim()).success || memory.isFetching}
            onClick={() => setLookup(memoryId.trim())}
          >
            Consultar lección previa
          </button>
        )}
        {replaces && (
          <p>
            Se propone revisar {entry!.title} · v{replaces.revision}.
          </p>
        )}
        {entry && !replaces && <p>Elige una lección vigente.</p>}
        {(memory.error || result.error) && (
          <p role="alert">{errorMessage(memory.error ?? result.error)}</p>
        )}
        <button
          className="primary-button"
          disabled={result.isLoading || (!!memoryId.trim() && !replaces)}
        >
          Guardar propuesta
        </button>
        {saved && <p role="status">Propuesta guardada. Revísala en Lecciones y cumplimiento.</p>}
      </form>
    </details>
  );
}

function Proposal({ project, id }: { project: Project; id: string }) {
  const result = learningApi.useLearningProposalQuery(
    { project: project.id, id },
    { refetchOnMountOrArgChange: true, refetchOnFocus: true },
  );
  const [act, mutation] = learningApi.useActOnLessonMutation();
  if (result.error) return <p role="alert">{errorMessage(result.error)}</p>;
  const detail = result.currentData;
  if (!detail) return <p role="status">Cargando propuesta…</p>;
  const { evidence, state, eligible, version } = detail;
  const submit = (action: 'review' | 'adopt' | 'revert', decision?: 'approve' | 'reject') =>
    void act({
      project: project.id,
      id,
      action,
      body: decision ? { version, decision } : { version },
    })
      .unwrap()
      .catch(() => {});
  return (
    <article className="lab-run learning-proposal">
      <h4>{detail.title}</h4>
      <p>
        {states[state]} · {detail.arm === 'solo' ? 'Agente único' : 'Equipo'}
      </p>
      <p>Fallo observado · {detail.failure}</p>
      <p>Corrección · {detail.correction}</p>
      <p>
        Evidencia {origin[evidence.origin].toLowerCase()} · Base{' '}
        {grade[evidence.baseline].toLowerCase()} · Verificador{' '}
        {grade[evidence.verifier].toLowerCase()}
      </p>
      <p>
        Valoración humana previa ·{' '}
        {evidence.feedback
          ? { solo: 'Agente único', team: 'Equipo', tie: 'Empate', inconclusive: 'Inconclusa' }[
              evidence.feedback
            ]
          : 'Sin valoración'}
      </p>
      {detail.replaces && <p>Revisión de lección previa v{detail.replaces.revision}</p>}
      {detail.memory && (
        <small>
          Memoria {detail.memory.id} · v{detail.memory.revision}
        </small>
      )}
      <ol>
        {detail.history.map((event) => (
          <li key={event.action}>
            {
              {
                propose: 'Propuesta',
                approve: 'Aprobación',
                reject: 'Rechazo',
                adopt: 'Adopción',
                revert: 'Reversión',
              }[event.action]
            }{' '}
            · {new Date(event.at).toLocaleString()}
            {event.memory && ` · v${event.memory.revision}`}
          </li>
        ))}
      </ol>
      {!project.archivedAt && (
        <div className="lab-actions">
          {state === 'proposed' && (
            <>
              <button
                type="button"
                className="secondary-button"
                disabled={mutation.isLoading}
                onClick={() => submit('review', 'approve')}
              >
                Aprobar revisión
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={mutation.isLoading}
                onClick={() => submit('review', 'reject')}
              >
                Rechazar propuesta
              </button>
            </>
          )}
          {state === 'approved' && (
            <button
              type="button"
              className="primary-button"
              disabled={!eligible || mutation.isLoading}
              onClick={() => submit('adopt')}
            >
              Adoptar en memoria
            </button>
          )}
          {state === 'adopted' && (
            <button
              type="button"
              className="secondary-button"
              disabled={mutation.isLoading}
              onClick={() => submit('revert')}
            >
              Revertir adopción
            </button>
          )}
        </div>
      )}
      {!eligible && (
        <p>
          Adopción bloqueada por evidencia insuficiente. Se requiere una corrección verificada con
          evidencia real comparable.
        </p>
      )}
      {mutation.error && <p role="alert">{errorMessage(mutation.error)}</p>}
    </article>
  );
}

function Compliance({
  project,
  observations,
}: {
  project: string;
  observations: LearningHealth['observations'];
}) {
  const [selections, setSelections] = useState({ supportive: '', neutral: '', competing: '' });
  const [check, result] = learningApi.useCheckComplianceMutation();
  return (
    <details>
      <summary>Cumplimiento por escenario</summary>
      <form
        className="lab-form"
        onSubmit={(event) => {
          event.preventDefault();
          void check({ project, body: selections })
            .unwrap()
            .catch(() => {});
        }}
      >
        <p>
          Selecciona tres trabajos individuales con la misma configuración y tareas que representen
          los tres tipos de indicación.
        </p>
        {Object.entries(labels).map(([key, label]) => {
          const scenario = key as keyof typeof labels;
          return (
            <label key={key}>
              {label}
              <select
                required
                value={selections[scenario]}
                onChange={(e) => {
                  result.reset();
                  setSelections({ ...selections, [scenario]: e.target.value });
                }}
              >
                <option value="">Selecciona una ejecución</option>
                {observations.map((item) => (
                  <option key={item.jobId} value={item.jobId}>
                    {new Date(item.recordedAt).toLocaleString()} · {item.jobId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <button
          className="secondary-button"
          disabled={
            result.isLoading ||
            Object.values(selections).includes('') ||
            new Set(Object.values(selections)).size !== 3
          }
        >
          Comprobar procedimiento
        </button>
      </form>
      {result.error && <p role="alert">{errorMessage(result.error)}</p>}
      {result.data && !result.error && (
        <div>
          <p>
            {result.data.comparable
              ? 'Condiciones registradas equivalentes'
              : 'Condiciones no comparables'}
          </p>
          <ul>
            {result.data.scenarios.map(({ label, observation }) => (
              <li key={label}>
                {labels[label]} · {origin[observation.origin]} · CLI{' '}
                {observed[observation.agentTest].toLowerCase()} · Controlador{' '}
                {observed[observation.controllerTest].toLowerCase()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

export function ProjectLearning({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const opts = { skip: !open, refetchOnFocus: true, refetchOnMountOrArgChange: true };
  const list = learningApi.useLearningListQuery(project.id, opts);
  const health = learningApi.useLearningHealthQuery(project.id, opts);
  const observations = health.error ? null : health.currentData?.observations;
  const proposals = list.error ? null : list.currentData?.proposals;
  const repeats = new Map<string, number>();
  for (const item of observations ?? []) {
    if (!item.failure) continue;
    const key = `${origin[item.origin]} · ${failures[item.failure]}`;
    repeats.set(key, (repeats.get(key) ?? 0) + 1);
  }
  return (
    <div className="lab-editors">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Lecciones y cumplimiento</summary>
        {open && (
          <>
            <p>
              Abre una evaluación guardada para proponer una lección. La revisión y la adopción son
              acciones separadas.
            </p>
            {(list.error || health.error) && (
              <p role="alert">{errorMessage(list.error ?? health.error)}</p>
            )}
            {(list.isLoading || health.isLoading) && (
              <p role="status">Cargando aprendizaje del proyecto…</p>
            )}
            {proposals?.length === 0 && <p>Todavía no hay propuestas.</p>}
            {!!proposals?.length && (
              <label className="lab-form">
                Propuesta de lección
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="">Selecciona una propuesta</option>
                  {proposals.map((item) => (
                    <option key={item.id} value={item.id}>
                      {states[item.state]} · {new Date(item.createdAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {proposals && selected && <Proposal key={selected} project={project} id={selected} />}
            {observations && (
              <details>
                <summary>Salud de ejecuciones · últimos 30 días</summary>
                <p>
                  {observations.length} observaciones recientes.{' '}
                  {health.currentData?.truncated && 'Ventana limitada a 60 trabajos.'}
                </p>
                {observations.length < 3 && <p>Datos insuficientes para interpretar un patrón.</p>}
                {health.currentData?.available === false && (
                  <p>Sin acceso al origen de los trabajos.</p>
                )}
                <ul>
                  {[...repeats].map(([label, count]) => (
                    <li key={label}>
                      {label} · {count}
                    </li>
                  ))}
                </ul>
                {observations.map((item) => (
                  <details key={item.jobId}>
                    <summary>
                      {item.jobId.slice(0, 8)} · {origin[item.origin]} · {item.state}
                    </summary>
                    <p>
                      Prueba CLI {observed[item.agentTest].toLowerCase()} · Controlador{' '}
                      {observed[item.controllerTest].toLowerCase()}
                    </p>
                    {item.role && (
                      <small>
                        Rol {item.role.id} · v{item.role.version}
                      </small>
                    )}
                    {item.skills.map((skill) => (
                      <small key={skill.id}>
                        Skill {skill.id} · v{skill.version}
                      </small>
                    ))}
                    {item.reportHash && <small>Huella de informe {item.reportHash}</small>}
                  </details>
                ))}
              </details>
            )}
            {observations && observations.length >= 3 && (
              <Compliance project={project.id} observations={observations} />
            )}
          </>
        )}
      </details>
    </div>
  );
}
