import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const sourceFile = new URL('../apps/api/src/modules/utility-packs/source.ts', import.meta.url);
const target = new URL('../apps/api/src/modules/utility-packs/inventory.json', import.meta.url);
const commit = readFileSync(sourceFile, 'utf8').match(/eccCommit = '([a-f0-9]{40})'/)[1];
const [repository, option] = process.argv.slice(2);
if (!repository || (option && option !== '--verify'))
  throw Error('node scripts/ecc-inventory.mjs <repositorio ECC> [--verify]');

const git = (...args) =>
  execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', maxBuffer: 12_000_000 });
const tree = git('ls-tree', '-rz', commit)
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf('\t');
    const [, , sha] = line.slice(0, tab).split(' ');
    return [line.slice(tab + 1), sha];
  });
const declaredLicenses = new Map(
  git('grep', '-n', '-E', '^license:', commit, '--', 'skills/*/SKILL.md', 'agents/*.md')
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^\w{40}:([^:]+):([0-9]+):license:\s*([A-Za-z0-9.+-]+)\s*$/.exec(line);
      return match && Number(match[2]) <= 15 ? [[match[1], match[3]]] : [];
    }),
);
const assignment = new Set();
const rows = [];
const direct = (root, pattern) =>
  tree.filter(([path]) => pattern.test(path)).map(([path]) => path.slice(root.length));
const grouped = (root) => [
  ...new Set(
    tree
      .filter(([path]) => path.startsWith(root))
      .map(([path]) => path.slice(root.length).split('/')[0]),
  ),
];

const families = [
  ['networks', /homelab|(^|[/\-])(cisco|network|netmiko|wireguard|pihole|vlan|bgp)([/\-.]|$)/],
  [
    'mobile',
    /android|flutter|swift|react-native|kotlin(?!-ktor|-exposed)|dart|harmonyos|arkts|ios-icon|on-device|compose-multiplatform|liquid-glass|gradle/,
  ],
  [
    'documents',
    /video|media|slides|manim|blender|document-processing|esign|visa-doc|investor-materials/,
  ],
  [
    'content',
    /seo|marketing|brand-|article-writing|content-engine|social-|crosspost|growth-log|x-api|investor-outreach/,
  ],
  [
    'business',
    /business|enterprise|billing|jira|workspace-ops|messages-ops|email|lead-intelligence|master-agreement|project-flow|counterparty|chief-of-staff|notification|customer|confluence|discord/,
  ],
  [
    'specialized',
    /healthcare|hipaa|prediction-market|trading|defi|evm-|scientific-|energy-procurement|carrier-|logistics|customs|inventory-demand|production-scheduling|quality-nonconformance|bengali|security-bounty|osint-investigation/,
  ],
  [
    'frontend',
    /react|frontend|a11y|accessibility|angular|vue|nuxt|nextjs|vite|design-system|interfaces-feel|taste|motion-|browser-|click-path|ui-|dashboard-builder|playwright|browserbase|browser-use|magic/,
  ],
  [
    'backend',
    /backend|database|contract-first|api-design|django|fastapi|postgres|prisma|mysql|redis|clickhouse|supabase|springboot|quarkus|rails|laravel|nestjs|mybatis|jpa|ktor|exposed|data-throughput|recsys|pytorch|mle-|rag-pipeline|celery|dotnet/,
  ],
  [
    'research',
    /research|docs-|documentation|doc-updater|codemap|retrieval|search|literature|scholar|code-tour|spec-miner|context-and-decisions|(^|[/\-])docs([/\-.]|$)/,
  ],
];
const external =
  /payment|x402|ito-|nasiko|fal-ai|videodb|nutrient-|mailtrap|social-publisher|google-workspace|codehealth-mcp|data-scraper|deepseek-harness|exa-search|lead-intelligence|email-ops|messages-ops|x-api|platform-search|jira|infra-aura/;
const restricted = /security-bounty|osint-investigation|security-scan/;
const familyOf = (path) => families.find(([, pattern]) => pattern.test(path))?.[0] ?? 'engineering';
const entry = (path, kind, { root = path, family = familyOf(path), name, shared = false } = {}) => {
  const files = tree.filter(([file]) => file === root || file.startsWith(root + '/'));
  if (!files.length) throw Error('Origen sin recursos: ' + path);
  if (!shared)
    for (const [file] of files) {
      if (assignment.has(file)) throw Error('Recurso repetido: ' + file);
      assignment.add(file);
    }
  const slug =
    name ??
    path
      .split('/')
      .at(-1)
      .replace(/\.[a-z0-9]+$/, '');
  const mode = restricted.test(path) ? kind : external.test(path) ? 'external' : kind;
  rows.push({
    path,
    slug,
    family,
    mode,
    license: declaredLicenses.get(path) ?? 'MIT',
    restricted: restricted.test(path),
    files,
  });
};

for (const name of direct('skills/', /^skills\/[^/]+\/SKILL\.md$/))
  entry('skills/' + name, 'content', {
    root: 'skills/' + name.split('/')[0],
    name: name.split('/')[0],
  });
for (const folder of ['agents', 'commands', 'contexts']) {
  const mode = folder === 'commands' ? 'workflow' : 'content';
  for (const path of direct('', new RegExp('^' + folder + '/[^/]+\\.md$'))) entry(path, mode);
}
for (const path of direct('', /^rules\/[^/]+\/[^/]+\.md$/)) entry(path, 'content');
for (const path of direct('', /^workflows\/[^/]+\.js$/)) entry(path, 'workflow');
for (const path of direct('', /^manifests\/.+\.json$/)) entry(path, 'content');
for (const path of direct('', /^docs\/(?:design|control-plane|gateguard)\/[^/]+\.md$/))
  entry(path, 'content');
for (const path of direct('', /^scripts\/[^/]+\.(?:js|mjs|sh)$/)) entry(path, 'tool');
for (const folder of ['hooks/', 'ecc2/src/', 'docker/', 'src/', 'pi/']) {
  for (const name of grouped(folder).filter((value) => !value.endsWith('.md'))) {
    entry(folder + name, 'tool');
  }
}
entry('integrations/aura', 'external', { name: 'aura', family: 'specialized' });
entry('plugins/ecc', 'tool');
entry('install.sh', 'tool');
entry('install.ps1', 'tool');
entry('ecc_dashboard.py', 'tool');
for (const name of ['discord', 'codex', 'codex-git-hooks', 'hooks'])
  entry('scripts/' + name, name === 'discord' ? 'external' : 'tool');

const mcp = 'mcp-configs/mcp-servers.json';
const servers = Object.keys(JSON.parse(git('show', commit + ':' + mcp)).mcpServers);
entry(mcp, 'external', { name: 'mcp-servers' });
for (const name of servers) {
  const path = mcp + '#mcpServers.' + name;
  entry(path, 'external', { name, root: mcp, family: familyOf(name), shared: true });
}

const complementary = { copies: 0, supporting: 0 };
for (const [path] of tree) {
  if (assignment.has(path)) continue;
  const mirror =
    /^(?:\.agents\/skills\/|\.codex\/agents\/|legacy-command-shims\/|docs\/(?:ar|bn|de-DE|es|ja-JP|ko-KR|pl|pt-BR|ru|th|tr|uk-UA|ur|vi-VN|zh-CN|zh-TW)\/|README\.zh-CN\.md$)/;
  complementary[mirror.test(path) ? 'copies' : 'supporting']++;
}
const expectedCounts = { 'skills/': 314, 'agents/': 71, 'commands/': 98 };
for (const [prefix, expected] of Object.entries(expectedCounts)) {
  if (rows.filter(({ path }) => path.startsWith(prefix)).length !== expected)
    throw Error('Recuento inesperado en ' + prefix);
}
if (new Set(rows.map(({ path }) => path)).size !== rows.length || tree.length !== 4701)
  throw Error('El inventario no corresponde al commit fijado.');
const inventory = {
  commit,
  treeFiles: tree.length,
  canonicalFiles: assignment.size,
  ...complementary,
  entries: rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
};
const output = JSON.stringify(inventory, null, 2) + '\n';
if (option === '--verify') {
  // Check semantic equality even when the repository formatter wraps an array differently.
  const current = JSON.parse(readFileSync(target, 'utf8'));
  if (JSON.stringify(current) !== JSON.stringify(inventory))
    throw Error('Inventario distinto al árbol fijado.');
} else {
  writeFileSync(target, output);
}
console.log(
  `${rows.length} entradas · ${assignment.size} archivos canónicos · ${tree.length} en el árbol`,
);
