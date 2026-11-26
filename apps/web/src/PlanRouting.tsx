import type { RoutingDecision } from '@ferweb/contracts';

const destinationLabel = { 'codex-v1': 'API de OpenAI', 'codex-local-v1': 'Ollama local' };
const transferLabel = {
  task: 'tarea y criterios',
  workspace: 'archivos del workspace',
  'role-materials': 'rol y skills',
  context: 'recibo de contexto',
  memory: 'memoria seleccionada',
  'current-run-deliveries': 'entregas de esta ejecución',
  'tool-results': 'resultados de herramientas',
};
const routingModeLabel = { api: 'API', local: 'Local', mixed: 'Mixto' };

export function PlanRouting({ decision }: { decision: RoutingDecision }) {
  return (
    <section aria-label="Decisión de inferencia" className="agent-history">
      <h4>Decisión de inferencia</h4>
      <p>
        {routingModeLabel[decision.mode]} · {decision.policy} · {decision.reservedApiRequests} de{' '}
        {decision.maxApiRequests} peticiones externas reservadas en el plan.
      </p>
      <ul>
        {decision.stages.map((stage) => (
          <li key={stage.step} className="skill-text">
            <strong>
              {stage.step} · {destinationLabel[stage.execution.id]} · {stage.model}
            </strong>
            <p>
              {stage.reason === 'requested_model'
                ? 'Modelo solicitado'
                : 'Primer modelo permitido por orden de identificador'}{' '}
              · Revisión observada {stage.modelRevision ?? 'desconocida'}.
            </p>
            <p>
              Descartado por política:{' '}
              {stage.candidates
                .filter((candidate) => candidate.reason === 'destination_denied')
                .map((candidate) => destinationLabel[candidate.destination])
                .join(', ')}
              .
            </p>
            <p>
              {stage.transfers.length
                ? `Se envía a la API: ${stage.transfers.map((item) => transferLabel[item]).join(', ')}.`
                : 'Inferencia y resultados de herramientas en local.'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
