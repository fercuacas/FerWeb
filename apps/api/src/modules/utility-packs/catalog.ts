import {
  skillIsPortable,
  utilityCatalog,
  utilityEntry,
  utilityFamily,
  utilityMode,
  utilityRecipe,
  type UtilityEntry,
  type utilityQuery,
} from '@ferweb/contracts';
import { z } from 'zod';
import { recipes } from '../jobs/recipe-catalog.js';
import { curatedSkills, eccLicenseNotice } from '../skills/curated.js';
import inventory from './inventory.json' with { type: 'json' };
import { eccCommit, eccRepository, eccVersion } from './source.js';

const titles: Record<z.infer<typeof utilityFamily>, string> = {
  engineering: 'Ingeniería',
  frontend: 'Frontend, diseño y accesibilidad',
  backend: 'Backend y datos',
  mobile: 'Móvil',
  research: 'Investigación y documentación',
  content: 'Contenido y SEO',
  documents: 'Documentos y multimedia',
  business: 'Operaciones empresariales',
  networks: 'Redes y homelab',
  specialized: 'Dominios especializados',
};
const packages = utilityFamily.options.map((family) => {
  const definitions = recipes.filter((item) => item.utility?.family === family);
  return {
    family,
    title: titles[family],
    version: 1,
    recipes: definitions.map((item) => utilityRecipe.parse(item)),
  };
});
const recipeByPath = new Map(
  recipes.flatMap((recipe) => recipe.utility?.paths.map((path) => [path, recipe] as const) ?? []),
);
const skillByPath = new Map(
  curatedSkills.flatMap((skill) =>
    skill.origin.kind === 'ecc' && skillIsPortable(skill)
      ? [[skill.origin.path, skill] as const]
      : [],
  ),
);
const source = {
  repository: eccRepository,
  commit: eccCommit,
  version: eccVersion,
  license: 'MIT',
  notice: eccLicenseNotice,
};

function externalRequirements(slug: string, path: string) {
  if (path.startsWith('mcp-configs/'))
    return [
      'Adaptador MCP específico y versión fijada.',
      'Permisos por operación, revisión del destino y prueba con un servicio autorizado.',
    ];
  if (/ito-|nasiko|deepseek/.test(slug))
    return [
      'Cuenta o clúster admitido, modelo o servicio identificado y adaptador validado.',
      'Límite de coste y autorización para enviar datos o reservar cómputo.',
    ];
  if (/payment|x402/.test(slug))
    return [
      'Proveedor de pagos admitido y contrato probado en sandbox.',
      'Credenciales de servidor, límites y autorización expresa por transacción.',
    ];
  if (/mail|messages|workspace|jira|discord|social|x-api/.test(slug))
    return [
      'Adaptador del servicio, cuenta autorizada y permisos mínimos.',
      'Validación del destino y de los borradores antes de cada publicación o envío.',
    ];
  if (/video|media|nutrient/.test(slug))
    return [
      'Motor y formato admitidos, recursos con licencia y destino aprobado.',
      'Límites de tamaño, coste y aceptación del resultado con el proveedor elegido.',
    ];
  return [
    'Adaptador con operaciones y versiones fijadas.',
    'Cuenta autorizada, destino de datos documentado y aceptación por operación.',
  ];
}

const entries = inventory.entries.map((entry): UtilityEntry => {
  const { path, slug, restricted } = entry;
  const mode = utilityMode.parse(entry.mode);
  const family = utilityFamily.parse(entry.family);
  const recipe = recipeByPath.get(path);
  const skill = skillByPath.get(path);
  const title = skill?.name ?? slug.replaceAll('-', ' ');
  const status = recipe
    ? 'workflow'
    : skill
      ? 'reviewed'
      : mode === 'external'
        ? 'pending'
        : 'catalogued';
  const input = recipe
    ? 'Tarea del proyecto, snapshot autorizado y rutas de referencia.'
    : skill
      ? 'Versión de texto del catálogo importada en el proyecto.'
      : mode === 'external'
        ? 'Operaciones y datos admitidos por el servicio tras autorización.'
        : 'Material identificado en la revisión fijada de ECC.';
  const output =
    recipe?.output ??
    (skill
      ? 'Skill versionada para revisión y vinculación.'
      : 'Ficha de catálogo con procedencia y recursos.');
  const capabilities = recipe
    ? recipe.mode === 'read'
      ? ['text', 'tool-calls', 'repository-read']
      : ['plan-local', 'repository-reference']
    : (skill?.requiredCapabilities ??
      (mode === 'external' ? ['connector-auth', 'destination-review'] : []));
  const providers = recipe
    ? recipe.mode === 'read'
      ? ['openai-api']
      : ['none']
    : skill
      ? ['openai-api', 'local-text']
      : [];
  const requirements = [
    ...(recipe
      ? [
          'Repositorio vinculado y sincronizado, tarea vigente y alcance revisado.',
          ...(recipe.mode === 'read'
            ? ['Modelo disponible para lectura aislada y confirmación del plan.']
            : []),
        ]
      : []),
    ...(skill ? ['Importación y aprobación de la versión en la biblioteca de skills.'] : []),
    ...(restricted ? ['Referencia de inventario para revisión humana.'] : []),
    ...(mode === 'external' ? externalRequirements(slug, path) : []),
    ...(!restricted && !recipe && !skill && mode !== 'external'
      ? [
          mode === 'tool'
            ? 'Adaptador aislado y operaciones aprobadas.'
            : 'Adaptación y revisión de recursos para el motor de FerWeb.',
        ]
      : []),
  ];
  return utilityEntry.parse({
    path,
    title,
    family,
    mode,
    status,
    license: entry.license,
    input,
    output,
    capabilities,
    providers,
    destinations: providers.length
      ? [
          'project-local',
          ...(providers.includes('openai-api') ? ['configured-api'] : []),
          ...(providers.includes('local-text') ? ['configured-local'] : []),
        ]
      : [],
    requirements,
    recipe: recipe ? utilityRecipe.parse(recipe) : null,
    curated: skill?.slug ?? null,
    resources: entry.files.map(([path, gitObject]) => ({ path, gitObject })),
  });
});

if (
  inventory.commit !== eccCommit ||
  new Set(entries.map((entry) => entry.path)).size !== entries.length ||
  [...recipeByPath.keys(), ...skillByPath.keys()].some(
    (path) => !entries.some((entry) => entry.path === path),
  )
)
  throw new Error('El catálogo no coincide con la revisión autorizada de ECC.');

const normalize = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('-', ' ');
const searchIndex = entries.map((entry) =>
  normalize(
    [entry.title, entry.path, titles[entry.family], entry.output, ...entry.capabilities].join(' '),
  ),
);

export function listUtilities({ family, mode, page, q, status }: z.output<typeof utilityQuery>) {
  const terms = normalize(q).split(/\s+/).filter(Boolean);
  const matched = entries.filter(
    (entry, index) =>
      (!family || entry.family === family) &&
      (!mode || entry.mode === mode) &&
      (!status || entry.status === status) &&
      terms.every((term) => searchIndex[index]!.includes(term)),
  );
  const pageSize = 18;
  return utilityCatalog.parse({
    source,
    inventoryTotal: entries.length,
    total: matched.length,
    page,
    pageSize,
    packages,
    entries: matched.slice((page - 1) * pageSize, page * pageSize),
  });
}
