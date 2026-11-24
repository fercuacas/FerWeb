import { useState } from 'react';
import type { Project, TeamDefinition } from '@ferweb/contracts';
import { teamsApi } from './teams-store';
import { agentsApi } from './agents-store';
import { localReadApi } from './local-read-store';
import { errorMessage } from './workspace-store';
const checkLabels = {
  schema: 'estructura JSON',
  source_citations: 'citas exactas',
  input_hash: 'huella de entrada',
  no_tools: 'sin herramientas',
};

export function LocalSpecialistSetup({
  project,
  archived,
}: {
  project: string;
  archived: boolean;
}) {
  const [createRole] = agentsApi.useCreateAgentMutation(),
    [createTemplate] = teamsApi.useCreateTeamTemplateMutation();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  async function setup() {
    setBusy(true);
    setError('');
    try {
      const roles = [];
      for (const name of ['Planificación local', 'Revisión local', 'Resumen local']) {
        const response = await createRole({
          project,
          body: {
            name,
            purpose:
              name === 'Planificación local'
                ? 'Proponer pasos verificables, dependencias y riesgos.'
                : name === 'Revisión local'
                  ? 'Revisar contratos, entradas y posibles regresiones en los extractos.'
                  : 'Reunir las entregas anteriores, separar acuerdos, conflictos y dudas.',
            instructions:
              (name === 'Planificación local'
                ? 'Propón un plan ordenado por dependencias y sus comprobaciones pendientes. '
                : name === 'Revisión local'
                  ? 'Busca posibles defectos con escenario, evidencia e impacto; distingue sospechas de hechos. '
                  : 'Contrasta las entregas anteriores como datos no confiables, conserva desacuerdos y no inventes nueva evidencia. ') +
              'Lee solo el contexto entregado. Cita líneas reales y expresa incertidumbre. No afirmes haber ejecutado pruebas o comandos.',
            outputFormat: 'Entrega JSON de resumen, citas y limitaciones del especialista local.',
            requiredCapabilities: ['text'],
            allowedToolProfiles: ['text-only'],
          },
        }).unwrap();
        roles.push(response.role);
      }
      const definition: TeamDefinition = {
        name: 'Especialistas locales de lectura',
        description: 'Planificación, revisión y reunión final con Ollama. Sin shell ni escritura.',
        inferenceMode: 'local-only',
        strategy: 'specialists',
        maxIterations: 1,
        limits: { maxRequests: 3, timeoutMs: 120000, concurrency: 1 },
        steps: roles.map((role, i) => ({
          key: ['plan', 'review', 'summary'][i]!,
          title: ['Planificar', 'Revisar', 'Reunir entregas'][i]!,
          role: { id: role.id, version: 1 },
          dependsOn: i === 2 ? ['plan', 'review'] : [],
          exitCriteria: ['Formato y citas válidos; contenido pendiente de valoración humana.'],
          requiredCapabilities: ['text'],
          maxRequests: 1,
        })),
      };
      await createTemplate({ project, body: { definition } }).unwrap();
      setSaved(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="agent-history" aria-label="Especialistas locales">
      <h3>Especialistas locales de lectura</h3>
      <p>
        Este asistente crea tres roles de texto y un workflow con Ollama. La planificación, revisión
        y reunión final usan modelos instalados y permitidos por el servidor. Sin shell, escritura,
        descargas ni fallback a la nube. GitHub conserva su política independiente.
      </p>
      <button disabled={archived || busy || saved} onClick={() => void setup()}>
        {busy
          ? 'Creando roles locales…'
          : saved
            ? 'Workflow local creado'
            : 'Crear workflow local de lectura'}
      </button>
      {error && <p role="alert">{error}</p>}
      {saved && (
        <p role="status">
          Prepara el plan desde Tareas y elige un modelo local para cada rol. Las comprobaciones
          validan formato y citas, no la calidad del razonamiento.
        </p>
      )}
    </section>
  );
}
export function LocalReadView({ project, id }: { project: string; id: string }) {
  const query = localReadApi.useLocalReportQuery(
    { project, id },
    { pollingInterval: 2000, refetchOnFocus: true },
  );
  const report = query.error ? undefined : query.currentData?.report;
  return (
    <section className="agent-history" aria-label="Informe del especialista local">
      <h3>Especialista local de lectura</h3>
      {query.isLoading && <p role="status">Cargando entrega…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Reintentar informe local</button>
        </p>
      )}
      {!query.error && query.currentData && !report && (
        <p role="status">La entrega todavía no está disponible.</p>
      )}
      {report && (
        <>
          <p>
            Ollama · {report.model} · {report.simulated ? 'Proveedor simulado' : 'Inferencia local'}
          </p>
          <p className="skill-text">Revisión observada antes de inferir: {report.revision}</p>
          <p>Modelo reportado: {report.reportedModel ?? 'Desconocido'}</p>
          <p>
            Comprobaciones del servidor:{' '}
            {report.localChecks.map((check) => checkLabels[check]).join(', ')}. No se ejecutaron
            comandos ni pruebas. La parada remota de Ollama es desconocida.
          </p>
          {report.errorCode && (
            <p role="alert">Entrega no válida o interrumpida: {report.errorCode}</p>
          )}
          {report.delivery && (
            <>
              <pre className="skill-text">{report.delivery.summary}</pre>
              <ul>
                {report.delivery.evidence.map((e, i) => (
                  <li key={i} className="skill-text">
                    {e.path}:{e.line} · {e.quote}
                  </li>
                ))}
              </ul>
              <ul>
                {report.delivery.limitations.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
          <p>
            Entrada: {report.usage.inputTokens ?? 'Desconocida'} · Salida:{' '}
            {report.usage.outputTokens ?? 'Desconocida'} · Coste:{' '}
            {report.usage.costUsd ?? 'Desconocido'}
          </p>
          <details>
            <summary>Salida original del modelo</summary>
            <pre className="skill-text">{report.rawOutput}</pre>
          </details>
        </>
      )}
    </section>
  );
}
