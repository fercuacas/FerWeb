import type { RecipeDefinition } from '@ferweb/contracts';
import { eccCommit } from '../utility-packs/source.js';

type Definition = Pick<RecipeDefinition, 'key' | 'label' | 'steps' | 'output'> & {
  family: NonNullable<RecipeDefinition['utility']>['family'];
  paths: string[];
};

const plans: Definition[] = [
  {
    key: 'pack-engineering',
    family: 'engineering',
    label: 'Plan de cambio y verificación',
    paths: ['commands/plan.md', 'skills/tdd-workflow/SKILL.md'],
    steps: [
      'Identifica los puntos de entrada, contratos y consumidores de la tarea.',
      'Define una comprobación que falle antes del cambio y las regresiones que deben quedar cubiertas.',
      'Ordena el cambio mínimo, la verificación independiente y la reversión.',
    ],
    output: 'Plan incremental con cambios, pruebas y criterios de reversión.',
  },
  {
    key: 'pack-frontend',
    family: 'frontend',
    label: 'Plan de interfaz y accesibilidad',
    paths: ['skills/frontend-a11y/SKILL.md', 'skills/frontend-patterns/SKILL.md'],
    steps: [
      'Delimita las rutas, componentes y estados de carga, vacío y error.',
      'Describe el recorrido con teclado, nombres accesibles y comprobaciones de foco y contraste.',
      'Define los tamaños de pantalla y el criterio observable de cada comprobación.',
    ],
    output: 'Matriz de estados, interacción y comprobaciones de accesibilidad.',
  },
  {
    key: 'pack-backend',
    family: 'backend',
    label: 'Plan de cambio de datos y API',
    paths: ['skills/postgres-patterns/SKILL.md', 'skills/contract-first/SKILL.md'],
    steps: [
      'Identifica el contrato, sus consumidores y la autoridad de cada dato.',
      'Diseña una migración aditiva con pruebas de ámbito, concurrencia y compatibilidad.',
      'Indica cómo comprobar persistencia, errores y reversión con datos desechables.',
    ],
    output: 'Plan de contratos, migración y comprobación de persistencia.',
  },
  {
    key: 'pack-mobile',
    family: 'mobile',
    label: 'Plan de recorrido móvil',
    paths: ['skills/react-native-patterns/SKILL.md', 'skills/android-clean-architecture/SKILL.md'],
    steps: [
      'Traza la pantalla, navegación y límites con almacenamiento y red.',
      'Define comprobaciones de permisos, accesibilidad, reanudación y conexión intermitente.',
      'Anota dispositivos y versiones objetivo, casos de prueba y condiciones de entrega.',
    ],
    output: 'Matriz de recorrido y pruebas por dispositivo y estado de conexión.',
  },
  {
    key: 'pack-research',
    family: 'research',
    label: 'Plan de investigación con fuentes',
    paths: ['contexts/research.md', 'skills/iterative-retrieval/SKILL.md'],
    steps: [
      'Formula preguntas comprobables y el alcance de la investigación.',
      'Identifica fuentes primarias autorizadas y cómo citar su ruta, línea o versión.',
      'Distingue hallazgos a contrastar, lagunas y criterios para cerrar cada pregunta.',
    ],
    output: 'Protocolo de investigación y matriz de fuentes por comprobar.',
  },
  {
    key: 'pack-content',
    family: 'content',
    label: 'Brief editorial y SEO',
    paths: ['skills/seo/SKILL.md', 'skills/article-writing/SKILL.md'],
    steps: [
      'Define audiencia, intención y mensajes sustentados por fuentes.',
      'Prepara estructura, títulos candidatos y enlaces por revisar.',
      'Establece la revisión editorial y criterios para aprobar el borrador.',
    ],
    output: 'Brief editorial local con esquema, términos y verificación de afirmaciones.',
  },
  {
    key: 'pack-documents',
    family: 'documents',
    label: 'Guion de documento o multimedia',
    paths: ['skills/frontend-slides/SKILL.md', 'skills/video-editing/SKILL.md'],
    steps: [
      'Define público, canal y propósito de cada página, diapositiva o escena.',
      'Enumera materiales, licencias, textos alternativos y subtítulos necesarios.',
      'Prepara criterios de revisión de contenido, legibilidad y entrega.',
    ],
    output: 'Guion local y lista de recursos y derechos por verificar.',
  },
  {
    key: 'pack-business',
    family: 'business',
    label: 'Plan de proceso empresarial',
    paths: ['skills/enterprise-agent-ops/SKILL.md', 'skills/project-flow-ops/SKILL.md'],
    steps: [
      'Describe entradas, responsables, estados y traspasos del proceso.',
      'Enumera excepciones, datos mínimos y controles de aprobación.',
      'Prepara un borrador de acción y condiciones para revisarlo con el responsable.',
    ],
    output: 'Mapa operativo, responsables y borrador sujeto a aprobación.',
  },
  {
    key: 'pack-networks',
    family: 'networks',
    label: 'Plan de revisión de red y homelab',
    paths: [
      'skills/homelab-network-readiness/SKILL.md',
      'skills/network-config-validation/SKILL.md',
    ],
    steps: [
      'Acota la topología aportada, activos propios y dependencias.',
      'Define criterios de disponibilidad, segmentación y evidencia documental.',
      'Prepara una lista de comprobaciones para un operador autorizado y un plan de reversión.',
    ],
    output: 'Plan documental de revisión y recuperación de infraestructura propia.',
  },
  {
    key: 'pack-specialized',
    family: 'specialized',
    label: 'Plan de revisión de un dominio especializado',
    paths: [
      'skills/scientific-thinking-literature-review/SKILL.md',
      'skills/scientific-thinking-scholar-evaluation/SKILL.md',
    ],
    steps: [
      'Delimita la pregunta, la jurisdicción y la persona responsable de validarla.',
      'Registra fuentes, fecha y límites de las afirmaciones con datos anonimizados.',
      'Prepara preguntas y una lista de decisiones que requieren aprobación cualificada.',
    ],
    output: 'Ficha de revisión documental para una persona cualificada.',
  },
];

function withSource({ family, paths, ...definition }: Definition) {
  return { ...definition, utility: { family, commit: eccCommit, license: 'MIT' as const, paths } };
}

export const utilityRecipes: Omit<
  RecipeDefinition,
  'version' | 'maxRequests' | 'timeoutMs' | 'maxOutputTokens'
>[] = [
  ...plans.map((definition) => ({
    ...withSource(definition),
    mode: 'plan' as const,
    role: 'planner' as const,
  })),
  {
    ...withSource({
      key: 'pack-evidence',
      family: 'research',
      label: 'Mapa de evidencias del repositorio',
      paths: ['skills/code-tour/SKILL.md'],
      steps: [
        'Usa la pregunta de la tarea y las rutas de referencia para acotar el recorrido.',
        'Identifica en el snapshot las rutas, símbolos y líneas que sustentan cada hallazgo.',
        'Separa observaciones, preguntas abiertas y limitaciones de la evidencia.',
      ],
      output: 'Informe de solo lectura con mapa de evidencias y preguntas abiertas.',
    }),
    mode: 'read',
    role: 'explorer',
  },
];
