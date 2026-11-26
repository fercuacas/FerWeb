import { useState } from 'react';
import { portableSelection, type Project } from '@ferweb/contracts';
import { agentsApi } from './agents-store';
import { skillsApi } from './skills-store';
import { teamsApi } from './teams-store';
import { extensionsApi } from './extensions-store';
import { errorMessage } from './workspace-store';

export function PortableCatalog({ project }: { project: Project }) {
  const roles = agentsApi.useAgentsQuery(project.id, { refetchOnFocus: true });
  const skills = skillsApi.useSkillsQuery(project.id, { refetchOnFocus: true });
  const teams = teamsApi.useTeamTemplatesQuery(project.id, { refetchOnFocus: true });
  const [role, setRole] = useState('');
  const [skillId, setSkill] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [preview, pending] = extensionsApi.usePreviewPortableMutation();
  const [download, downloading] = extensionsApi.useDownloadPortableMutation();
  const roleOptions = roles.currentData?.roles.filter(({ archivedAt }) => !archivedAt) ?? [];
  const skillOptions =
    skills.currentData?.versions.filter(({ review }) => review === 'approved') ?? [];
  const workflowOptions =
    teams.currentData?.templates.filter(({ archivedAt }) => !archivedAt) ?? [];
  const chosenRole = roleOptions.find(({ id, latest }) => role === `${id}:${latest.version}`);
  const chosenWorkflow = workflowOptions.find(
    ({ id, latest }) => workflow === `${id}:${latest.version}`,
  );
  const selection = portableSelection.safeParse({
    ...(chosenRole && { role: { id: chosenRole.id, version: chosenRole.latest.version } }),
    ...(skillOptions.some(({ id }) => id === skillId) && { skillId }),
    ...(chosenWorkflow && {
      workflow: { id: chosenWorkflow.id, version: chosenWorkflow.latest.version },
    }),
  });
  const loading = roles.isLoading || skills.isLoading || teams.isLoading;
  const error = roles.error ?? skills.error ?? teams.error;
  const matches =
    selection.success &&
    JSON.stringify(selection.data) === JSON.stringify(pending.originalArgs?.body);
  const summary = !error && matches ? pending.data : undefined;
  return (
    <section aria-label="Exportar catálogo portable">
      <p>
        Elige roles, skills de texto aprobadas o una plantilla. La exportación de una plantilla
        incluye sus roles y skills vinculados.
      </p>
      {loading && <p role="status">Cargando catálogo…</p>}
      {error && (
        <p role="alert">
          {errorMessage(error)}{' '}
          <button
            type="button"
            onClick={() => {
              void roles.refetch();
              void skills.refetch();
              void teams.refetch();
            }}
          >
            Reintentar
          </button>
        </p>
      )}
      {!loading &&
        !error &&
        !roleOptions.length &&
        !skillOptions.length &&
        !workflowOptions.length && <p>No hay material disponible para exportar.</p>}
      {!loading &&
        !error &&
        !!(roleOptions.length || skillOptions.length || workflowOptions.length) && (
          <form
            className="lab-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (selection.success)
                void preview({ project: project.id, body: selection.data })
                  .unwrap()
                  .catch(() => {});
            }}
          >
            <fieldset disabled={pending.isLoading || downloading.isLoading} className="lab-form">
              <legend>Contenido de la exportación</legend>
              <label>
                Rol para exportar
                <select value={role} onChange={({ target }) => setRole(target.value)}>
                  <option value="">Ninguno adicional</option>
                  {roleOptions.map(({ id, latest }) => (
                    <option key={id} value={`${id}:${latest.version}`}>
                      {latest.name} · v{latest.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Skill para exportar
                <select value={skillId} onChange={({ target }) => setSkill(target.value)}>
                  <option value="">Ninguna adicional</option>
                  {skillOptions.map(({ id, version, name }) => (
                    <option key={id} value={id}>
                      {name} · v{version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Workflow para exportar
                <select value={workflow} onChange={({ target }) => setWorkflow(target.value)}>
                  <option value="">Sin workflow</option>
                  {workflowOptions.map(({ id, latest }) => (
                    <option key={id} value={`${id}:${latest.version}`}>
                      {latest.definition.name} · v{latest.version}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={!selection.success}>Previsualizar exportación</button>
            </fieldset>
          </form>
        )}
      {(pending.error || downloading.error) && (
        <p role="alert">{errorMessage(pending.error ?? downloading.error)}</p>
      )}
      {summary && selection.success && (
        <section aria-label="Archivos de exportación" className="agent-history">
          <h4>Archivos de exportación</h4>
          <p>
            {summary.roles} roles · {summary.skills} skills ·{' '}
            {summary.workflow ? 'Con workflow' : 'Sin workflow'}
          </p>
          <p>
            Revisa el contenido antes de copiarlo a otro proyecto. El workflow es una descripción
            portable y conserva sus requisitos.
          </p>
          <ul>
            {summary.files.map(({ path, sha256 }) => (
              <li className="skill-text" key={path}>
                {path} · {sha256.slice(0, 12)}
              </li>
            ))}
          </ul>
          <div className="project-actions">
            <button
              type="button"
              disabled={downloading.isLoading}
              onClick={() =>
                void download({
                  project: project.id,
                  body: { selection: selection.data, sha256: summary.sha256 },
                  format: 'json',
                })
                  .unwrap()
                  .catch(() => {})
              }
            >
              Descargar catálogo JSON
            </button>
            <button
              type="button"
              disabled={downloading.isLoading}
              onClick={() =>
                void download({
                  project: project.id,
                  body: { selection: selection.data, sha256: summary.sha256 },
                  format: 'codex',
                })
                  .unwrap()
                  .catch(() => {})
              }
            >
              Descargar archivos para Codex
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
