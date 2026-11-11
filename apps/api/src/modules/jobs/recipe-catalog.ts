import { recipeDefinition, type RecipeDefinition } from '@ferweb/contracts';

const firstVersion = (
  definition: Omit<RecipeDefinition, 'version' | 'maxRequests' | 'timeoutMs' | 'maxOutputTokens'>,
): RecipeDefinition =>
  recipeDefinition.parse({
    ...definition,
    version: 1,
    maxRequests: definition.mode === 'write' ? 8 : 4,
    timeoutMs: definition.mode === 'write' ? 120000 : 60000,
    maxOutputTokens: definition.mode === 'write' ? 4096 : 2048,
  });

export const recipes = [
  firstVersion({
    key: 'investigate',
    label: 'Investigar',
    mode: 'read',
    role: 'explorer',
    steps: [
      'Localiza los puntos de entrada en las rutas seleccionadas.',
      'Sigue dependencias directas y cita evidencia concreta.',
    ],
    output: 'Mapa de archivos, símbolos, contratos y preguntas abiertas.',
  }),
  firstVersion({
    key: 'plan',
    label: 'Planificar',
    mode: 'plan',
    role: 'planner',
    steps: [
      'Acota objetivo, dependencias y rutas.',
      'Ordena cambios y define una comprobación por paso.',
    ],
    output: 'Plan de trabajo, ADR o plantilla de análisis de impacto.',
  }),
  firstVersion({
    key: 'feature',
    label: 'Añadir o cambiar funcionalidad',
    mode: 'write',
    role: 'implementer',
    steps: [
      'Contrasta los criterios con los contratos y dependencias.',
      'Aplica el cambio en las rutas permitidas y verifica el comportamiento.',
    ],
    output: 'Diff acotado, evidencia de verificación y criterios pendientes.',
  }),
  firstVersion({
    key: 'fix',
    label: 'Corregir defecto',
    mode: 'write',
    role: 'implementer',
    steps: [
      'Identifica cómo se manifiesta el defecto con la evidencia disponible.',
      'Aplica la corrección mínima y comprueba el caso corregido y sus regresiones.',
    ],
    output: 'Causa, diff acotado y comprobación de la corrección.',
  }),
  firstVersion({
    key: 'review',
    label: 'Revisar diff',
    mode: 'read',
    role: 'reviewer',
    steps: [
      'Inspecciona el diff y los archivos finales del trabajo de origen.',
      'Contrasta los cambios con los criterios y registra hallazgos.',
    ],
    output: 'Hallazgos por ruta, línea, escenario e impacto.',
  }),
  firstVersion({
    key: 'tests',
    label: 'Analizar pruebas',
    mode: 'read',
    role: 'tester',
    steps: [
      'Localiza las pruebas relevantes y ejecuta las comprobaciones disponibles en el perfil.',
      'Distingue resultados observados de huecos de cobertura.',
    ],
    output: 'Casos cubiertos, fallos, evidencia y cobertura pendiente.',
  }),
  firstVersion({
    key: 'build',
    label: 'Resolver fallo de build',
    mode: 'write',
    role: 'implementer',
    steps: [
      'Contrasta el fallo con la configuración y las entradas del perfil.',
      'Corrige la causa en las rutas permitidas y verifica con el perfil congelado.',
    ],
    output: 'Diagnóstico del build, diff acotado y resultado de verificación.',
  }),
  firstVersion({
    key: 'docs',
    label: 'Actualizar documentación',
    mode: 'write',
    role: 'implementer',
    steps: [
      'Contrasta la documentación existente con los contratos y puntos de entrada.',
      'Actualiza Markdown en las rutas permitidas y comprueba referencias.',
    ],
    output: 'Diff documental, referencias revisadas y verificaciones pendientes.',
  }),
  firstVersion({
    key: 'pr-draft',
    label: 'Preparar borrador de PR',
    mode: 'draft',
    role: 'reviewer',
    steps: [
      'Conserva las referencias a la tarea y al informe con el diff.',
      'Prepara el título, el resumen y una sección de verificación para E9.',
    ],
    output: 'Texto local para el borrador de E9.',
  }),
];
