import type { ExecutionOption, ExecutionUnavailableReason } from '@ferweb/contracts';

export const executionLabels: Record<ExecutionOption['id'], string> = {
  'codex-v1': 'Codex · ejecución de código',
  'openai-chat': 'OpenAI · conversación',
  'ollama-chat': 'Ollama · conversación local',
};

const destinationLabels: Record<ExecutionOption['destination'], string> = {
  'openai-api': 'API de OpenAI',
  'local-ollama': 'Ollama local',
  simulated: 'Proveedor simulado',
  unknown: 'Sin confirmar',
};

const reasonLabels: Record<ExecutionUnavailableReason, string> = {
  runner_unconfigured: 'Configura la conexión con el ejecutor en el servidor.',
  runner_unavailable: 'El ejecutor no responde o no confirma su entorno.',
  ai_unconfigured: 'Configura la conexión con el servicio de IA en el servidor.',
  provider_unconfigured: 'Configura el proveedor en el servidor.',
  provider_unavailable: 'El catálogo del proveedor no está disponible.',
  no_allowed_models: 'El catálogo no tiene modelos admitidos para esta opción.',
};

export const capabilityLabels: Record<keyof ExecutionOption['capabilities'], string> = {
  text: 'Texto',
  streaming: 'Streaming',
  toolCalls: 'Llamadas a herramientas',
  workspaceWrite: 'Escritura en el espacio de trabajo',
  structuredOutput: 'Salida estructurada',
  cancellation: 'Solicitud de cancelación',
  usage: 'Uso informado',
};
const supportLabels = {
  supported: 'Admitido',
  unsupported: 'Sin soporte',
  unknown: 'Por confirmar',
};

export function ExecutionDetails({ option }: { option: ExecutionOption }) {
  return (
    <>
      <p>
        {option.available ? 'Disponible según configuración' : 'No disponible'} ·{' '}
        {destinationLabels[option.destination]} ·{' '}
        {option.runtime === 'codex-cli' ? 'Codex CLI' : 'Chat de FerWeb'} ·{' '}
        {option.toolProfile === 'node-isolated-v1'
          ? 'Herramientas Node aisladas'
          : option.toolProfile === 'node-readonly-v1'
            ? 'Node · fuentes de solo lectura'
            : 'Solo texto'}
      </p>
      {option.reason && <p>{reasonLabels[option.reason]}</p>}
      <details>
        <summary>Ver capacidades de esta opción</summary>
        <ul>
          {Object.entries(capabilityLabels).map(([key, label]) => (
            <li key={key}>
              {label} · {supportLabels[option.capabilities[key as keyof typeof capabilityLabels]]}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
