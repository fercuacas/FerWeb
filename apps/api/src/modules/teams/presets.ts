import type { TeamPreset } from '@ferweb/contracts';

export const teamPresets: TeamPreset[] = [
  {
    id: 'implement-review',
    name: 'Implementar y revisar',
    description: 'Implementación acotada seguida de revisión de cambios y pruebas.',
    steps: [
      {
        key: 'implement',
        title: 'Implementar',
        specialty: 'implementer',
        dependsOn: [],
        exitCriteria: ['Cambio y verificaciones documentados.'],
        requiredCapabilities: ['text', 'toolCalls', 'workspaceWrite'],
        maxRequests: 4,
      },
      {
        key: 'review',
        title: 'Revisar',
        specialty: 'reviewer',
        dependsOn: ['implement'],
        exitCriteria: ['Hallazgos y criterios de aceptación revisados.'],
        requiredCapabilities: ['text', 'toolCalls'],
        maxRequests: 2,
      },
    ],
  },
  {
    id: 'research-answer',
    name: 'Investigar y responder',
    description: 'Exploración del snapshot y respuesta apoyada en los hallazgos.',
    steps: [
      {
        key: 'research',
        title: 'Investigar',
        specialty: 'explorer',
        dependsOn: [],
        exitCriteria: ['Evidencias y dudas identificadas.'],
        requiredCapabilities: ['text', 'toolCalls'],
        maxRequests: 2,
      },
      {
        key: 'answer',
        title: 'Responder',
        specialty: 'planner',
        dependsOn: ['research'],
        exitCriteria: ['Respuesta trazable a las evidencias.'],
        requiredCapabilities: ['text'],
        maxRequests: 2,
      },
    ],
  },
  {
    id: 'review-diff',
    name: 'Revisar un diff',
    description: 'Un agente revisa el cambio descrito en la tarea.',
    steps: [
      {
        key: 'review',
        title: 'Revisar diff',
        specialty: 'reviewer',
        dependsOn: [],
        exitCriteria: ['Hallazgos con evidencia, impacto y comprobaciones pendientes.'],
        requiredCapabilities: ['text', 'toolCalls'],
        maxRequests: 2,
      },
    ],
  },
];
