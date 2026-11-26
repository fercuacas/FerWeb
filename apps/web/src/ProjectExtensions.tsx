import { useState, type FormEvent } from 'react';
import { skipToken } from '@reduxjs/toolkit/query';
import {
  extensionManifest,
  type ExtensionDetail,
  type Project,
  type extensionAction,
  type extensionImport,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { extensionsApi } from './extensions-store';
import { errorMessage } from './workspace-store';

const states = {
  imported: 'Importada',
  configured: 'Configurada',
  reviewed: 'Revisada',
  enabled: 'Habilitada',
  withdrawn: 'Retirada',
};
const changes = {
  add: 'Incorporar',
  update: 'Actualizar',
  hide: 'Ocultar',
  preserve: 'Conservar edición del proyecto',
  keep: 'Sin cambios',
};
const events = {
  import: 'Importación',
  configure: 'Configuración',
  review: 'Revisión',
  enable: 'Habilitación',
  withdraw: 'Retirada',
  select: 'Selección de versión',
  edit: 'Edición del proyecto',
  run: 'Lectura local',
};

function ExtensionPreview({ preview }: { preview: ExtensionDetail['enablePreview'] }) {
  return (
    <>
      {preview.changes.length ? (
        <ul>
          {preview.changes.map((change) => (
            <li key={change.path} className="skill-text">
              {changes[change.action]} · {change.path}
              {change.before !== change.after && (
                <small>
                  {' '}
                  · {change.before?.slice(0, 12) ?? 'sin copia'} →{' '}
                  {change.after?.slice(0, 12) ?? 'oculto'}
                </small>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>Sin cambios en los recursos.</p>
      )}
    </>
  );
}

function Details({ project, detail }: { project: Project; detail: ExtensionDetail }) {
  const [change, mutation] = extensionsApi.useChangeExtensionMutation();
  const [run, execution] = extensionsApi.useRunExtensionMutation();
  const [confirmed, setConfirmed] = useState(false);
  const [resource, setResource] = useState(detail.config?.path ?? '');
  const [version, setVersion] = useState(detail.version);
  const [edit, setEdit] = useState<{ path: string; text: string } | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const scope = { project: project.id, id: detail.id };
  const busy = mutation.isLoading || execution.isLoading;
  const save = (body: z.infer<typeof extensionAction>) =>
    void change({ ...scope, body })
      .unwrap()
      .catch(() => {});
  const options = detail.manifest.resources.filter(
    ({ path }) => !detail.resources.some((item) => item.path === path && item.owner === 'project'),
  );
  const result = execution.error ? undefined : execution.data;
  return (
    <section aria-label="Detalle de extensión" className="agent-history">
      <h3>{detail.name}</h3>
      <p>
        Estado {states[detail.state]} · Versión {detail.version} · Revisión {detail.revision}
      </p>
      <p>{detail.manifest.license} · Lectura de un recurso · Destino dentro de este proyecto</p>
      {detail.config && (
        <p>
          Recurso configurado <strong>{detail.config.path}</strong>
        </p>
      )}
      <details>
        <summary>Manifiesto y recursos declarados</summary>
        <p className="skill-text">Huella {detail.sha256}</p>
        <p className="skill-text">
          {detail.manifest.origin.kind === 'github'
            ? `${detail.manifest.origin.repository} · ${detail.manifest.origin.commit} · ${detail.manifest.origin.path}`
            : detail.manifest.origin.label}
        </p>
        <p className="skill-text">{detail.manifest.notice}</p>
        <p>Dependencia fija fixture-reader 1.0.0</p>
        {detail.manifest.resources.map((file) => (
          <details key={file.path}>
            <summary>{file.path}</summary>
            <pre className="skill-text">{file.text}</pre>
          </details>
        ))}
      </details>
      {!project.archivedAt && (
        <fieldset disabled={busy} className="lab-form">
          <legend>Configurar y aprobar</legend>
          {detail.releases.length > 1 && (
            <label>
              Versión para preparar
              <select value={version} onChange={(event) => setVersion(event.target.value)}>
                {detail.releases.map((item) => (
                  <option key={item.version} value={item.version}>
                    {item.version} · {item.sha256.slice(0, 12)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {detail.releases.length > 1 && (
            <button
              type="button"
              disabled={version === detail.version}
              onClick={() => save({ action: 'select', version, revision: detail.revision })}
            >
              Preparar versión conservada
            </button>
          )}
          <label>
            Recurso de lectura
            <select value={resource} onChange={(event) => setResource(event.target.value)}>
              <option value="">Elige un recurso</option>
              {options.map(({ path }) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!resource || detail.config?.path === resource}
            onClick={() =>
              save({ action: 'configure', revision: detail.revision, config: { path: resource } })
            }
          >
            Guardar configuración
          </button>
          {detail.state === 'configured' && (
            <>
              <h4>Cambios propuestos</h4>
              <ExtensionPreview preview={detail.enablePreview} />
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />{' '}
                He revisado el origen, los recursos y el destino local
              </label>
              <button
                type="button"
                disabled={!confirmed}
                onClick={() =>
                  save({
                    action: 'review',
                    revision: detail.revision,
                    previewHash: detail.enablePreview.sha256,
                  })
                }
              >
                Aprobar configuración
              </button>
            </>
          )}
          {detail.state === 'reviewed' && (
            <>
              <ExtensionPreview preview={detail.enablePreview} />
              <button
                type="button"
                onClick={() =>
                  save({
                    action: 'enable',
                    revision: detail.revision,
                    previewHash: detail.enablePreview.sha256,
                  })
                }
              >
                Habilitar extensión
              </button>
            </>
          )}
          {detail.state === 'enabled' && (
            <button
              type="button"
              onClick={() =>
                void run({
                  ...scope,
                  body: { revision: detail.revision, requestId, operation: 'read-resource' },
                })
                  .unwrap()
                  .then(() => setRequestId(crypto.randomUUID()))
                  .catch(() => {})
              }
            >
              Ejecutar lectura local
            </button>
          )}
          {detail.state !== 'withdrawn' && (
            <details>
              <summary>Previsualizar retirada</summary>
              <ExtensionPreview preview={detail.withdrawPreview} />
              <button
                type="button"
                onClick={() =>
                  save({
                    action: 'withdraw',
                    revision: detail.revision,
                    previewHash: detail.withdrawPreview.sha256,
                  })
                }
              >
                Retirar extensión
              </button>
            </details>
          )}
        </fieldset>
      )}
      {result && (
        <section aria-label="Resultado de la lectura">
          <p>Recurso {result.path} · Destino local</p>
          <pre className="skill-text">{result.text}</pre>
        </section>
      )}
      {(mutation.error || execution.error) && (
        <p role="alert">{errorMessage(mutation.error ?? execution.error)}</p>
      )}
      <h4>Recursos del proyecto</h4>
      {!detail.resources.some((file) => file.visible) && <p>Sin recursos visibles.</p>}
      {detail.resources
        .filter((file) => file.visible)
        .map((file) => (
          <details key={file.path}>
            <summary>
              {file.path} ·{' '}
              {file.owner === 'project' ? 'Propiedad del proyecto' : 'Gestionado por la extensión'}
            </summary>
            <pre className="skill-text">{file.text}</pre>
            {!project.archivedAt && (
              <button type="button" onClick={() => setEdit({ path: file.path, text: file.text })}>
                Editar copia del proyecto
              </button>
            )}
          </details>
        ))}
      {edit && !project.archivedAt && (
        <form
          className="lab-form"
          onSubmit={(event) => {
            event.preventDefault();
            save({ action: 'edit', revision: detail.revision, ...edit });
          }}
        >
          <label>
            Contenido de {edit.path}
            <textarea
              required
              maxLength={8192}
              value={edit.text}
              onChange={(event) => setEdit({ ...edit, text: event.target.value })}
            />
          </label>
          <button disabled={busy}>Guardar edición del proyecto</button>
          <button type="button" onClick={() => setEdit(null)}>
            Cancelar edición
          </button>
        </form>
      )}
      <details>
        <summary>Historial de la extensión</summary>
        <ul>
          {detail.events.map((item) => (
            <li key={item.id} className="skill-text">
              {events[item.action]} · {item.version} · revisión {item.revision}
              {item.path && ` · ${item.path}`} · {new Date(item.recordedAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function ProjectExtensions({ project }: { project: Project }) {
  const query = extensionsApi.useExtensionsQuery(project.id, { refetchOnFocus: true });
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [upload, result] = extensionsApi.useImportExtensionMutation();
  const detail = extensionsApi.useExtensionQuery(
    selected ? { project: project.id, id: selected } : skipToken,
    { refetchOnFocus: true },
  );
  async function importExtension(event?: FormEvent) {
    event?.preventDefault();
    setError('');
    let body: z.infer<typeof extensionImport> = { fixture: 'fixture-reader' };
    if (event) {
      try {
        if (!file || file.size > 90 * 1024) throw Error('size');
        body = { manifest: extensionManifest.parse(JSON.parse(await file.text())) };
      } catch {
        setError('Elige un manifiesto JSON válido de hasta 90 KiB.');
        return;
      }
    }
    try {
      setSelected((await upload({ project: project.id, body }).unwrap()).id);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  const data = query.error ? undefined : query.currentData;
  return (
    <section aria-label="Extensiones del proyecto">
      <p>Importa un manifiesto local o prueba el conector de lectura incluido.</p>
      {!project.archivedAt && (
        <>
          <button type="button" disabled={result.isLoading} onClick={() => void importExtension()}>
            Importar lector de ejemplo
          </button>
          <form className="lab-form" onSubmit={(event) => void importExtension(event)}>
            <label>
              Manifiesto de extensión JSON
              <input
                required
                type="file"
                accept=".json,application/json"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button disabled={!file || result.isLoading}>Importar extensión</button>
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {query.isLoading && <p role="status">Cargando extensiones…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button type="button" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        </p>
      )}
      {data?.extensions.length === 0 && <p>Aún no hay extensiones.</p>}
      {!!data?.extensions.length && (
        <label>
          Extensión del proyecto
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Elige una extensión</option>
            {data.extensions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {states[item.state]}
              </option>
            ))}
          </select>
        </label>
      )}
      {detail.isLoading && <p role="status">Cargando extensión…</p>}
      {detail.error && (
        <p role="alert">
          {errorMessage(detail.error)}{' '}
          <button type="button" onClick={() => void detail.refetch()}>
            Reintentar detalle
          </button>
        </p>
      )}
      {!detail.error && detail.currentData && (
        <Details
          key={`${detail.currentData.id}:${detail.currentData.revision}`}
          project={project}
          detail={detail.currentData}
        />
      )}
    </section>
  );
}
