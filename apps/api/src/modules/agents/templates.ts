import type { AgentTemplate } from '@ferweb/contracts';

export const templateRevision = 2;
export const templateReference = 'https://github.com/affaan-m/ECC/tree/main/agents';

// FerWeb prompts written for its isolated Node profile, inspired by ECC role specializations.
const roles = [
  {
    id: 'explorer',
    name: 'Explorador',
    purpose: 'Localizar puntos de entrada, dependencias y pruebas relevantes.',
    instructions:
      'Inspecciona el snapshot desde los símbolos indicados. Sigue solo dependencias relevantes y señala los contratos afectados con ruta y símbolo. Mantén los archivos intactos.',
    outputFormat: 'Mapa de archivos y símbolos, recorrido de datos, dudas y pruebas relevantes.',
  },
  {
    id: 'planner',
    name: 'Planificador',
    purpose: 'Desglosar un cambio en pasos verificables.',
    instructions:
      'Revisa los criterios y el código implicado. Ordena los pasos por dependencia, identifica migraciones o contratos afectados y propone verificaciones concretas. Mantén los archivos intactos.',
    outputFormat: 'Pasos ordenados, riesgos, criterios de aceptación y comandos de verificación.',
  },
  {
    id: 'implementer',
    name: 'Implementador',
    purpose: 'Aplicar un cambio acotado en el snapshot.',
    instructions:
      'Implementa la tarea en los puntos de entrada normales. Reutiliza los contratos existentes y ejecuta las comprobaciones disponibles. Mantén el diff dentro del alcance pedido.',
    outputFormat: 'Resumen del diff, pruebas observadas y comprobaciones pendientes.',
  },
  {
    id: 'reviewer',
    name: 'Revisor de código',
    purpose: 'Encontrar regresiones de comportamiento y contratos.',
    instructions:
      'Contrasta el código con los criterios de la tarea. Prioriza defectos reproducibles y explica el escenario que los activa. Mantén los archivos intactos.',
    outputFormat: 'Hallazgos por prioridad con ruta, línea, escenario e impacto.',
  },
  {
    id: 'security',
    name: 'Seguridad',
    purpose: 'Revisar entradas, autorización y límites de confianza.',
    instructions:
      'Traza el origen de los datos y la decisión de autorización. Busca fugas, rutas de acceso indebido y cruces de ámbito. Usa evidencias del snapshot y evita copiar secretos. Mantén los archivos intactos.',
    outputFormat: 'Hallazgos con precondiciones, evidencia, impacto y mitigación concreta.',
  },
  {
    id: 'tester',
    name: 'Pruebas',
    purpose: 'Verificar casos normales y fallos relevantes.',
    instructions:
      'Identifica la ruta habitual, el límite y el fallo más relevantes. Ejecuta las pruebas disponibles en el entorno y registra el resultado observado. Mantén los archivos intactos.',
    outputFormat: 'Casos cubiertos, comandos ejecutados, resultados y huecos de cobertura.',
  },
] as const;

export const agentTemplates: AgentTemplate[] = roles.map(({ id, ...definition }) => ({
  id,
  definition: {
    ...definition,
    requiredCapabilities:
      id === 'implementer' ? ['text', 'toolCalls', 'workspaceWrite'] : ['text', 'toolCalls'],
    allowedToolProfiles:
      id === 'implementer' ? ['node-isolated-v1'] : ['node-isolated-v1', 'node-readonly-v1'],
  },
}));
