import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { skillVersion, executionOptionSchema, type SkillVersion } from '@ferweb/contracts';
import { lexicalScore, rankSources, fuseRanks } from '../src/modules/retrieval/ranking.js';
import { selectContextSkills } from '../src/modules/context-packs/selection.js';
const execution = executionOptionSchema.parse({
  id: 'codex-v1',
  provider: 'openai',
  runtime: 'codex-cli',
  destination: 'simulated',
  toolProfile: 'node-isolated-v1',
  configurationRevision: 'fixture',
  available: true,
  reason: null,
  simulated: true,
  models: [],
  capabilities: {
    text: 'supported',
    streaming: 'supported',
    toolCalls: 'supported',
    workspaceWrite: 'supported',
    structuredOutput: 'unknown',
    cancellation: 'supported',
    usage: 'unknown',
  },
});
function skill(slug: string): SkillVersion {
  return skillVersion.parse({
    id: randomUUID(),
    version: 1,
    sha256: 'a'.repeat(64),
    review: 'approved',
    slug,
    name: slug,
    description: 'Reviewed reference for ' + slug,
    purpose: 'skill',
    technologies: [slug],
    license: 'MIT',
    notice: 'Owned fixture.',
    requiredCapabilities: ['text'],
    allowedToolProfiles: ['node-isolated-v1'],
    resources: [{ kind: 'file', name: 'guide.md' }],
    origin: { kind: 'upload', source: 'fixture' },
    files: [{ path: 'guide.md', sha256: 'a'.repeat(64), text: 'Reference only.' }],
  });
}
test('ranking keeps literal symbols/paths above vector-only matches and deduplicates fused IDs', () => {
  const rows = [
    {
      id: 'exact',
      path: 'src/query.ts',
      start_line: 1,
      content: 'export function buildFindUserQuery() {}',
    },
    {
      id: 'semantic',
      path: 'docs/general.md',
      start_line: 1,
      content: 'General user query overview',
    },
  ];
  const lexical = rankSources('`buildFindUserQuery`', rows);
  assert.equal(lexical[0]!.row.id, 'exact');
  assert.ok(
    lexical[0]!.reason.includes('exact_identifier') || lexical[0]!.reason.includes('exact_text'),
  );
  const fused = fuseRanks(
    lexical.map((x) => ({ id: x.row.id, exact: x.reason.some((r) => r.startsWith('exact')) })),
    [
      { id: 'semantic', score: 0.99 },
      { id: 'exact', score: 0.8 },
    ],
  );
  assert.equal(fused[0]!.id, 'exact');
  assert.equal(fused.filter((x) => x.id === 'exact').length, 1);
  assert.ok(lexicalScore('autenticación', 'autenticacion', '').matched.includes('autenticacion'));
});
test('skills route deterministically in Spanish/English while suggested mode applies no proposals', () => {
  const pg = skill('postgresql'),
    react = skill('react');
  const base = {
    skills: [react, pg],
    rules: [],
    profile: 'lean' as const,
    explicit: [],
    excluded: [],
    mandatory: [],
    execution,
  };
  for (const query of ['postgresql consultas de datos', 'postgresql database queries']) {
    const auto = selectContextSkills({ ...base, query, mode: 'automatic' });
    assert.equal(auto.selected[0]!.skill.id, pg.id);
    assert.deepEqual(
      selectContextSkills({ ...base, skills: [pg, react], query, mode: 'automatic' }).selected,
      auto.selected,
    );
    const suggested = selectContextSkills({ ...base, query, mode: 'suggested' });
    assert.equal(suggested.selected.length, 0);
    assert.equal(suggested.suggestions[0]!.skill.id, pg.id);
  }
});
test('explicit-only, exclusions, dependency cycles, profile and capability boundaries survive matching text', () => {
  const a = skill('typescript'),
    b = skill('node');
  const rule = (id: string) => ({
    id,
    profiles: ['lean', 'full'] as ('lean' | 'full')[],
    explicitOnly: false,
    dependsOn: [] as string[],
    excludes: [] as string[],
    keywordsEs: [],
    keywordsEn: [],
  });
  const base = {
    skills: [a, b],
    query: 'use typescript node',
    profile: 'full' as const,
    mode: 'automatic' as const,
    explicit: [],
    excluded: [],
    mandatory: [],
    execution,
  };
  const manualOnly = { ...rule(a.id), explicitOnly: true };
  assert.ok(
    !selectContextSkills({ ...base, rules: [manualOnly] }).selected.some(
      (x) => x.skill.id === a.id,
    ),
  );
  assert.ok(
    selectContextSkills({
      ...base,
      mode: 'manual',
      explicit: [a.id],
      rules: [manualOnly],
    }).selected.some((x) => x.skill.id === a.id),
  );
  assert.throws(() =>
    selectContextSkills({
      ...base,
      mode: 'manual',
      explicit: [a.id],
      excluded: [b.id],
      rules: [{ ...rule(a.id), dependsOn: [b.id] }],
    }),
  );
  assert.throws(() =>
    selectContextSkills({
      ...base,
      mode: 'manual',
      explicit: [a.id],
      rules: [{ ...rule(a.id), dependsOn: [b.id], excludes: [b.id] }],
    }),
  );
  assert.throws(() =>
    selectContextSkills({
      ...base,
      mode: 'manual',
      explicit: [a.id],
      rules: [
        { ...rule(a.id), dependsOn: [b.id] },
        { ...rule(b.id), dependsOn: [a.id] },
      ],
    }),
  );
  assert.throws(() =>
    selectContextSkills({
      ...base,
      mode: 'manual',
      explicit: [a.id],
      rules: [{ ...rule(a.id), profiles: ['lean'] }],
    }),
  );
  assert.throws(() =>
    selectContextSkills({
      ...base,
      mode: 'manual',
      explicit: [a.id],
      rules: [],
      execution: { ...execution, capabilities: { ...execution.capabilities, text: 'unsupported' } },
    }),
  );
});
