import { useState } from 'react';
import {
  utilityFamily,
  utilityMode,
  utilityStatus,
  type RecipeDefinition,
  type UtilityEntry,
  type UtilityQuery,
} from '@ferweb/contracts';
import { recipeApi } from './recipe-store';
import { skillsApi } from './skills-store';
import { errorMessage } from './workspace-store';

const modes = {
  content: 'Contenido',
  workflow: 'Workflow',
  tool: 'Herramienta',
  external: 'Integración externa',
};
const statuses = {
  catalogued: 'Catalogado',
  reviewed: 'Contenido revisado',
  workflow: 'Receta disponible',
  pending: 'Integración pendiente',
};
const providers = {
  none: 'Plan local sin modelo',
  'openai-api': 'Codex API',
  'local-text': 'Modelo local de texto',
};
const destinations = {
  'project-local': 'Proyecto',
  'configured-api': 'API autorizada',
  'configured-local': 'Modelo local configurado',
};

function Entry({
  entry,
  project,
  onChoose,
  archived,
  canChoose,
}: {
  entry: UtilityEntry;
  project: string;
  onChoose: (key: RecipeDefinition['key']) => void;
  archived: boolean;
  canChoose: boolean;
}) {
  const [importSkill, imported] = skillsApi.useImportSkillMutation();
  const [open, setOpen] = useState(false);
  const { recipe, curated } = entry;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {entry.title} · {statuses[entry.status]}
      </summary>
      {open && (
        <>
          <dl>
            <dt>Origen en ECC</dt>
            <dd>
              <code>{entry.path}</code>
            </dd>
            <dt>Modo</dt>
            <dd>{modes[entry.mode]}</dd>
            <dt>Licencia</dt>
            <dd>{entry.license}</dd>
            <dt>Entrada</dt>
            <dd>{entry.input}</dd>
            <dt>Salida disponible</dt>
            <dd>{entry.output}</dd>
            <dt>Capacidades</dt>
            <dd>{entry.capabilities.join(', ') || 'Sin capacidades aprobadas'}</dd>
            <dt>Proveedor admisible</dt>
            <dd>
              {entry.providers.map((provider) => providers[provider]).join(', ') ||
                'Sin proveedor admitido'}
            </dd>
            <dt>Destino de datos</dt>
            <dd>
              {entry.destinations.map((destination) => destinations[destination]).join(', ') ||
                'Sin destino autorizado'}
            </dd>
            {recipe && (
              <>
                <dt>Receta y rol</dt>
                <dd>
                  {recipe.label} · v{recipe.version} · {recipe.role}
                </dd>
              </>
            )}
          </dl>
          {!!entry.requirements.length && (
            <ul>
              {entry.requirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {recipe && (
            <button
              type="button"
              className="secondary-button"
              disabled={!canChoose}
              onClick={() => onChoose(recipe.key)}
            >
              Elegir {recipe.label}
            </button>
          )}
          {curated && (
            <button
              type="button"
              className="secondary-button"
              disabled={archived || imported.isLoading}
              onClick={() => {
                void importSkill({ project, body: { curated } })
                  .unwrap()
                  .catch(() => {});
              }}
            >
              {imported.isLoading ? 'Importando skill…' : 'Importar skill para revisión'}
            </button>
          )}
          {imported.data && (
            <p role="status">
              Skill disponible en el proyecto.{' '}
              <a href={`#/agents/${project}`}>Abrir biblioteca de skills</a>
            </p>
          )}
          {imported.error && <p role="alert">{errorMessage(imported.error)}</p>}
          {entry.status === 'pending' && (
            <button type="button" className="secondary-button" disabled>
              Conector sin habilitar
            </button>
          )}
          <details>
            <summary>Recursos de origen ({entry.resources.length})</summary>
            <ul>
              {entry.resources.map(({ path, gitObject }) => (
                <li key={path}>
                  <code>{path}</code> · <code>{gitObject}</code>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </details>
  );
}

export function UtilityPacks({
  project,
  archived,
  canChoose,
  onChoose,
}: {
  project: string;
  archived: boolean;
  canChoose: boolean;
  onChoose: (key: RecipeDefinition['key']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<UtilityQuery>({ page: 1, q: '' });
  const result = recipeApi.useUtilityPacksQuery(
    { project, filters },
    { skip: !open, refetchOnMountOrArgChange: true, refetchOnFocus: true },
  );
  const data = result.error ? undefined : result.currentData;
  const pack = data?.packages.find((item) => item.family === filters.family);
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0;
  return (
    <details
      className="utility-packs task-recipe-preview"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Paquetes de utilidades ECC</summary>
      {open && (
        <>
          <form
            className="task-recipe-form"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters((current) => ({ ...current, q: query.trim(), page: 1 }));
            }}
          >
            <label>
              Buscar utilidad
              <input
                type="search"
                maxLength={100}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="submit" className="secondary-button">
              Buscar
            </button>
            <label>
              Familia
              <select
                value={filters.family ?? ''}
                onChange={(event) => {
                  const { family: _, ...other } = filters;
                  const value = utilityFamily.safeParse(event.target.value);
                  setFilters({
                    ...other,
                    page: 1,
                    ...(value.success ? { family: value.data } : {}),
                  });
                }}
              >
                <option value="">Todas las familias</option>
                {data?.packages.map(({ family, title }) => (
                  <option key={family} value={family}>
                    {title}
                  </option>
                ))}
                {!data && filters.family && (
                  <option value={filters.family}>{filters.family}</option>
                )}
              </select>
            </label>
            <label>
              Modo de utilidad
              <select
                value={filters.mode ?? ''}
                onChange={(event) => {
                  const { mode: _, ...other } = filters;
                  const value = utilityMode.safeParse(event.target.value);
                  setFilters({ ...other, page: 1, ...(value.success ? { mode: value.data } : {}) });
                }}
              >
                <option value="">Todos los modos</option>
                {utilityMode.options.map((mode) => (
                  <option key={mode} value={mode}>
                    {modes[mode]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado de utilidad
              <select
                value={filters.status ?? ''}
                onChange={(event) => {
                  const { status: _, ...other } = filters;
                  const value = utilityStatus.safeParse(event.target.value);
                  setFilters({
                    ...other,
                    page: 1,
                    ...(value.success ? { status: value.data } : {}),
                  });
                }}
              >
                <option value="">Todos los estados</option>
                {utilityStatus.options.map((status) => (
                  <option key={status} value={status}>
                    {statuses[status]}
                  </option>
                ))}
              </select>
            </label>
          </form>
          {result.isFetching && <p role="status">Cargando catálogo de utilidades…</p>}
          {result.error && (
            <>
              <p role="alert">{errorMessage(result.error)}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void result.refetch()}
              >
                Reintentar catálogo
              </button>
            </>
          )}
          {archived && <p>Proyecto archivado. Catálogo disponible para consulta.</p>}
          {pack && (
            <section aria-label={pack.title}>
              <h3>
                {pack.title} · v{pack.version}
              </h3>
              {pack.recipes.map((recipe) => (
                <p key={recipe.key}>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!canChoose}
                    onClick={() => onChoose(recipe.key)}
                  >
                    Elegir {recipe.label}
                  </button>
                </p>
              ))}
            </section>
          )}
          {data && (
            <>
              <p role="status">
                {data.total} de {data.inventoryTotal} utilidades.{' '}
                {pages > 1 && `Página ${data.page} de ${pages}.`}
              </p>
              {data.entries.length === 0 && <p>No hay utilidades para los filtros actuales.</p>}
              <ul className="utility-entries">
                {data.entries.map((entry) => (
                  <li key={entry.path}>
                    <Entry
                      entry={entry}
                      project={project}
                      archived={archived}
                      canChoose={canChoose}
                      onChoose={onChoose}
                    />
                  </li>
                ))}
              </ul>
              {pages > 1 && (
                <div className="form-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={data.page <= 1}
                    onClick={() => setFilters({ ...filters, page: data.page - 1 })}
                  >
                    Anterior
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={data.page >= pages}
                    onClick={() => setFilters({ ...filters, page: data.page + 1 })}
                  >
                    Siguiente
                  </button>
                </div>
              )}
              <details>
                <summary>Procedencia y licencia MIT</summary>
                <p>
                  <a
                    href={`https://github.com/${data.source.repository}/tree/${data.source.commit}`}
                  >
                    ECC {data.source.version} en GitHub
                  </a>
                </p>
                <pre>{data.source.notice}</pre>
              </details>
            </>
          )}
        </>
      )}
    </details>
  );
}
