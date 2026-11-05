import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadMigrations } from '../src/migrations.js';

test('migration discovery is stable and fingerprints SQL content', async () => {
  const first = await loadMigrations();
  assert.equal(first.length, 16);
  assert.equal(first[15]?.name, '016_team_specialists.sql');
  assert.equal(first[14]?.name, '015_team_executions.sql');
  assert.equal(first[13]?.name, '014_team_plans.sql');
  assert.equal(first[12]?.name, '013_execution_budgets.sql');
  assert.equal(first[11]?.name, '012_skill_library.sql');
  assert.equal(first[10]?.name, '011_agent_catalog.sql');
  assert.equal(first[9]?.name, '010_context_strategies.sql');
  assert.equal(first[8]?.name, '009_reviews.sql');
  assert.equal(first[7]?.name, '008_coding.sql');
  assert.equal(first[6]?.name, '007_jobs.sql');
  assert.equal(first[5]?.name, '006_laboratory.sql');
  assert.equal(first[4]?.name, '005_retrieval.sql');
  assert.equal(first[0]?.name, '001_installation.sql');
  assert.equal(first[1]?.name, '002_workspace.sql');
  assert.equal(first[2]?.name, '003_github.sql');
  assert.equal(first[3]?.name, '004_conversations.sql');
  assert.match(first[0]?.checksum ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(await loadMigrations(), first);
});
