import { useRef, useState } from 'react';
import type { z } from 'zod';
import type { Project, executionBudgetSchema } from '@ferweb/contracts';
import { budgetsApi } from './budgets-store';
import { errorMessage } from './workspace-store';

export const attributionNames = {
  agent: 'Agente',
  coordinator: 'Coordinador',
  selection: 'Selección',
  summary: 'Resumen',
  reviewer: 'Revisor',
};

export function BudgetUsage({ budget }: { budget: z.infer<typeof executionBudgetSchema> }) {
  return (
    <section className="agent-history" aria-label="Contabilidad del presupuesto">
      <h4>{budget.name}</h4>
      <p>
        Cupo ocupado {budget.reservedRequests} / {budget.limits.maxRequests} · Peticiones admitidas{' '}
        {budget.admittedRequests} · Disponibles {budget.availableRequests}
      </p>
      <p>
        Consumo conocido de entrada {budget.knownInputTokens ?? 'Desconocido'} · Salida{' '}
        {budget.knownOutputTokens ?? 'Desconocida'}
      </p>
      <p>
        Cobertura del proveedor {budget.reportedRequests} / {budget.admittedRequests} peticiones con
        uso reportado. Los tokens conocidos pueden ser parciales.
      </p>
      <p>
        Coste final desconocido. Los eventos de la CLI se muestran aparte del uso del proveedor.
      </p>
      <p>
        Plazo compartido {budget.limits.timeoutMs / 1000} s · Concurrencia del presupuesto{' '}
        {budget.limits.concurrency}.
      </p>
      <p>
        Vencimiento{' '}
        {budget.deadlineAt
          ? new Date(budget.deadlineAt).toLocaleString('es-ES')
          : 'Empieza con el primer paso'}
        .
      </p>
      {budget.stopReason && (
        <p role="status">
          Presupuesto detenido por{' '}
          {budget.stopReason === 'cancelled' ? 'cancelación' : 'plazo agotado'}.
        </p>
      )}
      {budget.steps.length > 0 && (
        <ul>
          {budget.steps.map((step) => (
            <li key={step.jobId}>
              {attributionNames[step.attribution]} · Reserva inicial {step.requestLimit} ·
              Admisiones {step.admittedRequests}
              {step.released ? ' · Reserva sobrante liberada' : ' · Reserva vigente'}
              {step.stopReason ? ` · Parada ${step.stopReason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProjectBudgets({ project }: { project: Project }) {
  const query = budgetsApi.useBudgetsQuery(project.id, {
    refetchOnFocus: true,
    pollingInterval: 2500,
    skipPollingIfUnfocused: true,
  });
  const [create, state] = budgetsApi.useCreateBudgetMutation();
  const [cancel, cancelling] = budgetsApi.useCancelBudgetMutation();
  const [name, setName] = useState('');
  const [requests, setRequests] = useState(8);
  const [seconds, setSeconds] = useState(120);
  const [selected, setSelected] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const visible = query.error ? undefined : query.currentData;
  const budget = visible?.budgets.find((item) => item.id === selected);
  return (
    <details>
      <summary>Presupuestos compartidos de Codex</summary>
      {!project.archivedAt && (
        <form
          className="job-form"
          onChange={() => {
            requestId.current = crypto.randomUUID();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void create({
              project: project.id,
              body: {
                requestId: requestId.current,
                name,
                limits: { maxRequests: requests, timeoutMs: seconds * 1000, concurrency: 1 },
              },
            })
              .unwrap()
              .then(({ budget }) => {
                setSelected(budget.id);
                setName('');
                requestId.current = crypto.randomUUID();
              })
              .catch(() => {});
          }}
        >
          <fieldset disabled={state.isLoading}>
            <legend>Nuevo presupuesto padre</legend>
            <label>
              Nombre del presupuesto
              <input
                required
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="job-grid">
              <label>
                Peticiones compartidas
                <input
                  required
                  type="number"
                  min={1}
                  max={20}
                  value={requests}
                  onChange={(e) => setRequests(Number(e.target.value))}
                />
              </label>
              <label>
                Plazo compartido en segundos
                <input
                  required
                  type="number"
                  min={10}
                  max={1200}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                />
              </label>
            </div>
            <p>
              El plazo empieza con el primer paso y abarca los siguientes. Cada paso reserva su cupo
              al encolarse.
            </p>
            <button type="submit">Crear presupuesto</button>
          </fieldset>
        </form>
      )}
      {(state.error || cancelling.error || query.error) && (
        <p className="form-error" role="alert">
          {errorMessage(state.error || cancelling.error || query.error)}
        </p>
      )}
      {query.isLoading && <p role="status">Cargando presupuestos…</p>}
      {visible && !visible.budgets.length && (
        <p>Cada ejecución nueva crea un presupuesto propio o utiliza uno compartido.</p>
      )}
      {!!visible?.budgets.length && (
        <label>
          Presupuesto para consultar
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Seleccionar presupuesto</option>
            {visible.budgets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {budget && (
        <>
          <BudgetUsage budget={budget} />
          {!budget.cancelledAt && (
            <button
              type="button"
              disabled={cancelling.isLoading}
              onClick={() => {
                void cancel({ project: project.id, id: budget.id })
                  .unwrap()
                  .catch(() => {});
              }}
            >
              Cancelar presupuesto y sus pasos
            </button>
          )}
        </>
      )}
    </details>
  );
}
