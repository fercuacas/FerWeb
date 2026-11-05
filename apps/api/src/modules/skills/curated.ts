import type { SkillContent } from '@ferweb/contracts';
import { digest } from '../jobs/review-artifacts.js';

const commit = 'b38be6a7f6350964d59328b52f0624e1d1d552d1';
// License from affaan-m/ECC at the pinned commit above.
const notice = `MIT License

Copyright (c) 2026 Affaan Mustafa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const guides: (Pick<SkillContent, 'slug' | 'name' | 'purpose' | 'technologies'> & {
  path: string;
  text: string;
  resource?: SkillContent['resources'][number];
})[] = [
  {
    slug: 'ecc-development',
    name: 'Modo desarrollo',
    purpose: 'development',
    technologies: ['ferweb'],
    path: 'contexts/dev.md',
    text: 'Implementa el cambio mínimo que cumpla los criterios. Empieza por el punto de entrada que usa FerWeb y reutiliza sus contratos. Comprueba el comportamiento con las herramientas disponibles y separa resultados observados de verificaciones pendientes.',
  },
  {
    slug: 'ecc-research',
    name: 'Modo investigación',
    purpose: 'research',
    technologies: ['ferweb'],
    path: 'contexts/research.md',
    text: 'Delimita la pregunta, inspecciona el snapshot y contrasta las hipótesis con evidencias. Mantén intactos los archivos. Devuelve primero los hallazgos con rutas y símbolos y después las dudas que queden abiertas.',
  },
  {
    slug: 'ecc-review',
    name: 'Modo revisión',
    purpose: 'review',
    technologies: ['ferweb'],
    path: 'contexts/review.md',
    text: 'Busca regresiones reproducibles en contratos, autorización, manejo de errores y pruebas. Mantén intactos los archivos. Ordena los hallazgos por impacto e indica la ruta, la condición que los activa y el resultado observable.',
  },
  {
    slug: 'ecc-typescript',
    name: 'Contratos TypeScript',
    purpose: 'rule',
    technologies: ['typescript', 'node'],
    path: 'rules/typescript/patterns.md',
    text: 'Conserva los DTO Zod y el formato de error del dominio existente. Valida las entradas en el borde, deriva propietario y proyecto de la sesión y separa la persistencia de la interfaz HTTP. Comprueba consumidores API y React cuando cambie un contrato.',
  },
  {
    slug: 'ecc-python-testing',
    name: 'Pruebas del servicio Python',
    purpose: 'rule',
    technologies: ['python'],
    path: 'rules/python/testing.md',
    text: 'Prueba el comportamiento con unittest, la herramienta que ya usa FerWeb. Usa proveedores simulados y conserva casos de error y cancelación. Declara qué comprobaciones pudiste ejecutar con el entorno disponible.',
  },
  {
    slug: 'ecc-react',
    name: 'Pantallas React con datos privados',
    purpose: 'skill',
    technologies: ['react', 'typescript'],
    path: 'skills/frontend-patterns/SKILL.md',
    text: 'Reutiliza la caché RTK Query para datos del servidor y mantén local el borrador del formulario. Comprueba carga, vacío, error, navegación con teclado y móvil. Ante un fallo de revalidación, oculta los datos privados de la caché.',
  },
  {
    slug: 'ecc-postgres',
    name: 'Cambios PostgreSQL',
    purpose: 'skill',
    technologies: ['postgresql'],
    path: 'skills/postgres-patterns/SKILL.md',
    text: 'Trata PostgreSQL como autoridad. Usa migraciones aditivas, consultas parametrizadas y transacciones cortas. Comprueba el ámbito de proyecto en cada consulta y prueba migración y concurrencia con una base desechable.',
  },
  {
    slug: 'ecc-hooks',
    name: 'Hooks de ECC',
    purpose: 'rule',
    technologies: ['ecc'],
    path: 'rules/common/hooks.md',
    text: 'Entrada de referencia para los hooks de eventos del ejecutor de ECC. Su activación requiere un mecanismo de ejecución de hooks.',
    resource: { kind: 'hook', name: 'Hooks del ejecutor ECC' },
  },
  {
    slug: 'ecc-mcp',
    name: 'Configuración MCP de ECC',
    purpose: 'skill',
    technologies: ['mcp'],
    path: 'mcp-configs/mcp-servers.json',
    text: 'Entrada de referencia para las configuraciones MCP de ECC. Los servidores necesitan conexión y autorización propias.',
    resource: { kind: 'mcp', name: 'Servidores MCP de terceros' },
  },
];

export const curatedSkills: SkillContent[] = guides.map(({ path, text, resource, ...guide }) => ({
  ...guide,
  description: resource
    ? 'Referencia con dependencias de ejecución.'
    : 'Adaptación para el flujo de FerWeb.',
  license: 'MIT',
  notice,
  origin: { kind: 'ecc', repository: 'affaan-m/ECC', commit, path },
  requiredCapabilities: ['text'],
  allowedToolProfiles: ['node-isolated-v1', 'text-only'],
  resources: resource ? [resource] : [],
  files: [{ path: `${guide.slug}.md`, text, sha256: digest(text) }],
}));
