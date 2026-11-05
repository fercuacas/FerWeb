import { useState, type FormEvent } from 'react';
import {
  skillIsPortable,
  skillManifest,
  skillPromptMaterial,
  type Project,
  type SkillContent,
  type SkillVersion,
} from '@ferweb/contracts';
import { skillsApi } from './skills-store';
import { errorMessage } from './workspace-store';

const purposes = {
  skill: 'Skill',
  rule: 'Regla',
  development: 'Desarrollo',
  research: 'Investigación',
  review: 'Revisión de código',
};
const reviews = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' };
const dependencies = {
  script: 'Script',
  hook: 'Hook',
  mcp: 'MCP',
  external: 'Servicio externo',
  runtime: 'Ejecutor específico',
  file: 'Archivo incluido',
};

export function SkillText({ skill }: { skill: SkillVersion }) {
  const material = skillPromptMaterial(skill);
  return (
    <div className="agent-history">
      <strong>
        {material.name} · versión {skill.version}
      </strong>
      <p>Licencia {material.license}</p>
      <details>
        <summary>Aviso de licencia</summary>
        <pre className="skill-text">{material.notice}</pre>
      </details>
      {material.files.map(({ path, text }) => (
        <div key={path}>
          <p>{path}</p>
          <pre className="skill-text">{text}</pre>
        </div>
      ))}
    </div>
  );
}

function SkillDetail({ project, id }: { project: Project; id: string }) {
  const query = skillsApi.useSkillQuery({ project: project.id, id }, { refetchOnFocus: true });
  const [review, state] = skillsApi.useReviewSkillMutation();
  const [confirmed, setConfirmed] = useState(false);
  if (query.error)
    return (
      <p role="alert">
        {errorMessage(query.error)} <button onClick={() => void query.refetch()}>Reintentar</button>
      </p>
    );
  const skill = query.currentData?.skill;
  if (!skill) return <p role="status">Cargando material…</p>;
  const portable = skillIsPortable(skill);
  function decide(value: 'approved' | 'rejected') {
    if (!skill) return;
    void review({
      project: project.id,
      id,
      body: { sha256: skill.sha256, state: value },
    })
      .unwrap()
      .catch(() => {});
  }
  return (
    <section className="agent-history" aria-label="Detalle del material">
      <h3>
        {skill.name} · versión {skill.version}
      </h3>
      <p>
        {reviews[skill.review]} · {skill.license}
      </p>
      <p>
        SHA-256 del paquete <code>{skill.sha256}</code>
      </p>
      <p>
        Capacidades requeridas: {skill.requiredCapabilities.join(', ')}. Perfiles:{' '}
        {skill.allowedToolProfiles.join(', ')}.
      </p>
      {skill.origin.kind === 'ecc' ? (
        <p>
          Adaptación de ECC.{' '}
          <a
            href={`https://github.com/affaan-m/ECC/blob/${skill.origin.commit}/${skill.origin.path}`}
            target="_blank"
            rel="noreferrer"
          >
            {skill.origin.path} · {skill.origin.commit.slice(0, 7)}
          </a>
        </p>
      ) : (
        <p>Origen declarado: {skill.origin.source}</p>
      )}
      {!!skill.resources.length && (
        <ul>
          {skill.resources.map((item, index) => (
            <li key={index}>
              {dependencies[item.kind]} · {item.name}
            </li>
          ))}
        </ul>
      )}
      {!portable && (
        <p className="read-only-note">Material bloqueado por dependencias de ejecución.</p>
      )}
      <h4>{portable ? 'Texto que recibirá el modelo si se vincula' : 'Texto de referencia'}</h4>
      <SkillText skill={skill} />
      {!project.archivedAt && skill.review === 'pending' && (
        <div className="skill-review">
          {portable && (
            <label className="agent-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              He revisado el contenido, la licencia y los recursos declarados
            </label>
          )}
          <div className="project-actions">
            {portable && (
              <button
                className="primary-button"
                disabled={!confirmed || state.isLoading}
                onClick={() => decide('approved')}
              >
                Aprobar versión
              </button>
            )}
            <button
              className="secondary-button"
              disabled={state.isLoading}
              onClick={() => decide('rejected')}
            >
              Rechazar versión
            </button>
          </div>
        </div>
      )}
      {state.error && (
        <p className="form-error" role="alert">
          {errorMessage(state.error)}
        </p>
      )}
    </section>
  );
}

export function SkillsLibrary({ project }: { project: Project }) {
  const query = skillsApi.useSkillsQuery(project.id, { refetchOnFocus: true });
  const [importSkill, mutation] = skillsApi.useImportSkillMutation();
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [technology, setTechnology] = useState('');
  const [purpose, setPurpose] = useState('');
  const [dependency, setDependency] = useState('');
  const [review, setReview] = useState('');
  const data = query.error ? undefined : query.currentData;
  const entries = [...(data?.versions ?? []), ...(data?.curated ?? [])];
  const technologies = [...new Set(entries.flatMap((entry) => entry.technologies))].sort();
  const matches = (entry: Pick<SkillContent, 'purpose' | 'technologies' | 'resources'>) =>
    (!technology || entry.technologies.includes(technology)) &&
    (!purpose || entry.purpose === purpose) &&
    (!dependency || (dependency === 'text' ? skillIsPortable(entry) : !skillIsPortable(entry)));
  const versions =
    data?.versions.filter((entry) => matches(entry) && (!review || entry.review === review)) ?? [];
  const curated = !review || review === 'catalog' ? (data?.curated.filter(matches) ?? []) : [];
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    if (!file || file.size > 90 * 1024) {
      setFormError('Elige un manifiesto JSON de hasta 90 KiB.');
      return;
    }
    const form = event.currentTarget;
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
      );
    } catch {
      setFormError('El manifiesto debe ser JSON válido en UTF-8.');
      return;
    }
    const manifest = skillManifest.safeParse(input);
    if (!manifest.success) {
      setFormError(
        `Manifiesto inválido. Revisa ${manifest.error.issues[0]?.path.join('.') || 'los campos requeridos'}.`,
      );
      return;
    }
    try {
      const { skill } = await importSkill({
        project: project.id,
        body: { manifest: manifest.data },
      }).unwrap();
      setSelected(skill.id);
      setFile(null);
      form.reset();
    } catch {}
  }
  return (
    <section aria-label="Biblioteca de skills">
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar</button>
        </p>
      )}
      {query.isLoading && <p role="status">Cargando biblioteca…</p>}
      {project.archivedAt && (
        <p className="read-only-note">Proyecto archivado. Biblioteca de solo lectura.</p>
      )}
      {data && (
        <>
          {!project.archivedAt && (
            <form className="job-form" onSubmit={(e) => void upload(e)}>
              <fieldset disabled={mutation.isLoading}>
                <legend>Importar material estático</legend>
                <p>
                  El manifiesto JSON v1 describe archivos de texto en Base64 con SHA-256. Revisa
                  cada versión antes de vincularla.
                </p>
                <label>
                  Manifiesto JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    required
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button className="primary-button" type="submit">
                  Importar manifiesto
                </button>
              </fieldset>
            </form>
          )}
          {(formError || mutation.error) && (
            <p className="form-error" role="alert">
              {formError || errorMessage(mutation.error)}
            </p>
          )}
          <div className="job-grid skill-filters" aria-label="Filtros de biblioteca">
            <label>
              Tecnología
              <select value={technology} onChange={(e) => setTechnology(e.target.value)}>
                <option value="">Todas</option>
                {technologies.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Finalidad
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="">Todas</option>
                {Object.entries(purposes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dependencias
              <select value={dependency} onChange={(e) => setDependency(e.target.value)}>
                <option value="">Todas</option>
                <option value="text">Material de texto</option>
                <option value="blocked">Dependencias de ejecución</option>
              </select>
            </label>
            <label>
              Estado de revisión
              <select value={review} onChange={(e) => setReview(e.target.value)}>
                <option value="">Todos</option>
                <option value="catalog">Catálogo de referencia</option>
                {Object.entries(reviews).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!versions.length && !curated.length && (
            <p>No hay materiales que coincidan con los filtros.</p>
          )}
          <ul className="agent-list">
            {versions.map((item) => (
              <li key={item.id}>
                <strong>
                  {item.name} · versión {item.version}
                </strong>
                <p>
                  {reviews[item.review]} · {purposes[item.purpose]} · {item.technologies.join(', ')}
                </p>
                {!skillIsPortable(item) && <p>Bloqueada por dependencias de ejecución</p>}
                <button
                  className="secondary-button"
                  aria-pressed={selected === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  Ver {item.name} v{item.version}
                </button>
              </li>
            ))}
          </ul>
          {selected && <SkillDetail key={selected} project={project} id={selected} />}
          {!!curated.length && <h3>Selección de ECC para FerWeb</h3>}
          <ul className="agent-list">
            {curated.map((item) => (
              <li key={item.slug}>
                <strong>{item.name}</strong>
                <p>
                  {item.description} · {purposes[item.purpose]} · {item.technologies.join(', ')}
                </p>
                <p>
                  {skillIsPortable(item)
                    ? 'Disponible para importar y revisar'
                    : 'Referencia bloqueada por dependencias'}
                </p>
                {!project.archivedAt && (
                  <button
                    className="secondary-button"
                    disabled={mutation.isLoading}
                    onClick={() => {
                      setFormError('');
                      void importSkill({ project: project.id, body: { curated: item.slug } })
                        .unwrap()
                        .then(({ skill }) => setSelected(skill.id))
                        .catch(() => {});
                    }}
                  >
                    Importar {item.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function LinkedSkillPreview({ project, id }: { project: string; id: string }) {
  const query = skillsApi.useSkillQuery({ project, id }, { refetchOnFocus: true });
  if (query.error) return <p role="alert">{errorMessage(query.error)}</p>;
  return query.currentData ? (
    <SkillText skill={query.currentData.skill} />
  ) : (
    <p role="status">Cargando texto…</p>
  );
}

export function SkillPreview({ project, ids }: { project: string; ids: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Ver texto que recibirá el modelo</summary>
      {open && ids.map((id) => <LinkedSkillPreview key={id} project={project} id={id} />)}
    </details>
  );
}

export function SkillLinks({
  project,
  ids,
  onChange,
}: {
  project: string;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const query = skillsApi.useSkillsQuery(project, { refetchOnFocus: true });
  const options = query.error
    ? []
    : query.currentData?.versions.filter(
        (item) => item.review === 'approved' && skillIsPortable(item),
      );
  return (
    <fieldset>
      <legend>Material vinculado al rol</legend>
      <p>
        Elige hasta tres versiones aprobadas. El texto se enviará al modelo en las ejecuciones que
        usen esta versión del rol.
      </p>
      {query.isLoading && <p role="status">Cargando versiones aprobadas…</p>}
      {query.error && <p role="alert">{errorMessage(query.error)}</p>}
      {options?.length === 0 && !query.error && (
        <p>La biblioteca aún no tiene versiones aprobadas.</p>
      )}
      {options?.map((item) => (
        <label className="agent-check" key={item.id}>
          <input
            type="checkbox"
            checked={ids.includes(item.id)}
            disabled={ids.length >= 3 && !ids.includes(item.id)}
            onChange={(event) =>
              onChange(
                event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
              )
            }
          />
          {item.name} · versión {item.version}
        </label>
      ))}
      {!!ids.length && !query.error && <SkillPreview project={project} ids={ids} />}
    </fieldset>
  );
}
