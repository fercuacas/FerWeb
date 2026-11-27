// Loaded through stdin by verify-release inside its disposable compiled API only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  automationSnapshot,
  classifyPlanTask,
  codingConfiguration,
  codingReport,
  contextPackSnapshot,
  teamDelivery,
  teamPlanSnapshot,
  teamTemplateVersion,
} from '@ferweb/contracts';
import { createPool } from './dist/database.js';
import { readConfig } from './dist/config.js';
import { canonical, digest } from './dist/modules/jobs/review-artifacts.js';
import { AgentCatalog } from './dist/modules/agents/catalog.js';
import { agentTemplates } from './dist/modules/agents/templates.js';
import { SkillLibrary } from './dist/modules/skills/library.js';
import { MemoryService } from './dist/modules/memory/service.js';
import { GitHubService } from './dist/modules/github/service.js';
import { ProjectExtensions } from './dist/modules/extensions/service.js';
import { eccCommit } from './dist/modules/utility-packs/source.js';

const config = readConfig();
assert.equal(config.POSTGRES_DB, 'ferweb_release_check');
assert.equal(process.env.POSTGRES_USER, 'ferweb_check');
const pool = createPool(config);
const privateMarker = 'P25_PRIVATE_FIXTURE_TEXT';
const fixtureCommit = 'a'.repeat(40);
const hash = (value) => digest(canonical(value));
const encode = JSON.stringify;
const one = async (query, args) => (await pool.query(query, args)).rows[0];

async function seed(owner, project, task) {
  const skills = new SkillLibrary(pool);
  const imported = await skills.import(owner, project, { curated: 'ecc-review' });
  const skill = await skills.review(owner, project, imported.id, {
    sha256: imported.sha256,
    state: 'approved',
  });
  const agents = new AgentCatalog(pool);
  const role = await agents.create(owner, project, { template: 'reviewer' });
  const { latest: agent } = await agents.update(owner, project, role.id, {
    version: 1,
    definition: agentTemplates.find(({ id }) => id === 'reviewer').definition,
    skillIds: [skill.id],
  });
  const memory = new MemoryService(pool, new GitHubService(pool, null));
  const draft = {
    kind: 'note',
    title: 'Synthetic recovery note',
    content: privateMarker,
    observedAt: new Date().toISOString(),
    status: 'active',
    tags: ['release'],
    targets: [],
    lesson: null,
    sources: [{ kind: 'task', id: task.id, version: task.version }],
  };
  const first = await memory.create(owner, project, randomUUID(), draft);
  const corrected = await memory.correct(owner, project, first.selection.id, 1, {
    ...draft,
    content: privateMarker + ' version 2',
  });
  const note = (await memory.read(owner, project, corrected.selection.id, 2)).entry;
  const extensions = new ProjectExtensions(pool);
  let extension = await extensions.import(owner, project, { fixture: 'fixture-reader' });
  extension = await extensions.change(owner, project, extension.id, {
    action: 'configure',
    revision: extension.revision,
    config: { path: 'ficha.md' },
  });
  for (const action of ['review', 'enable']) {
    extension = await extensions.change(owner, project, extension.id, {
      action,
      revision: extension.revision,
      previewHash: extension.enablePreview.sha256,
    });
  }
  await extensions.run(owner, project, extension.id, {
    revision: extension.revision,
    requestId: randomUUID(),
    operation: 'read-resource',
  });

  const templateId = randomUUID(),
    jobId = randomUUID(),
    receiptId = randomUUID();
  const planId = randomUUID(),
    executionId = randomUUID(),
    fence = randomUUID();
  const scheduleId = randomUUID(),
    occurrenceId = randomUUID(),
    executorId = randomUUID();
  const stepId = randomUUID(),
    budgetId = randomUUID();
  const time = new Date().toISOString();
  const model = 'synthetic-release-model';
  const limits = { maxRequests: 2, timeoutMs: 60000, concurrency: 1 };
  const option = {
    id: 'codex-local-v1',
    provider: 'ollama',
    runtime: 'codex-cli',
    destination: 'simulated',
    toolProfile: 'node-isolated-v1',
    configurationRevision: 'release-fixture',
    available: true,
    reason: null,
    simulated: true,
    models: [{ id: model, revision: 'fixture-revision' }],
    capabilities: {
      text: 'supported',
      streaming: 'supported',
      toolCalls: 'supported',
      workspaceWrite: 'supported',
      structuredOutput: 'supported',
      cancellation: 'supported',
      usage: 'supported',
    },
  };
  const step = {
    key: 'review',
    title: 'Review',
    role: { id: agent.id, version: agent.version },
    dependsOn: [],
    exitCriteria: ['Retain synthetic evidence.'],
    requiredCapabilities: ['text'],
    maxRequests: 2,
  };
  const template = teamTemplateVersion.parse({
    id: templateId,
    version: 1,
    origin: { preset: null, revision: 1 },
    definition: {
      name: 'Recovery team',
      description: 'Synthetic historical fixture.',
      maxIterations: 1,
      inferenceMode: 'local-coding-only',
      limits,
      steps: [step],
    },
  });
  const map = { version: 1, markdown: '# ' + privateMarker, sources: [], recordedAt: time };
  const context = contextPackSnapshot.parse({
    sourceHashes: {},
    model,
    protocol: 'ferweb-context-pack-v1',
    implementation: hash('fixture implementation'),
    task: { id: task.id, version: task.version, hash: hash(task) },
    agent: step.role,
    agentHash: hash(agent),
    phase: 'team:review',
    query: privateMarker,
    profile: 'lean',
    mode: 'manual',
    policy: { version: 1, hash: hash([]), rules: [] },
    catalogHash: hash([skill.sha256]),
    sourceFingerprint: hash(fixtureCommit),
    execution: option,
    memory: [corrected.selection],
    choices: [],
    diagnostics: [],
    retrieval: {
      sources: [],
      hits: [],
      insufficient: true,
      strategy: 'lexical-v1',
      fallback: null,
      embeddingUsed: false,
      simulated: true,
      elapsedMs: 0,
      fingerprint: hash(fixtureCommit),
      partial: false,
    },
    payload: {
      notice: 'Synthetic fixture',
      map: { ...map, hash: hash(map) },
      skills: [skill],
      memory: [note],
      sources: [],
    },
    initialBytes: Buffer.byteLength(map.markdown),
    baseSkillBytes: 0,
    complete: true,
  });
  const receipt = { id: receiptId, hash: hash(context) };
  const plan = teamPlanSnapshot.parse({
    version: 1,
    template,
    task,
    classification: classifyPlanTask(task),
    mode: 'team',
    execution: option,
    model,
    limits,
    maxIterations: 1,
    plannedRequests: 2,
    steps: [{ ...step, agent }],
    memory: [corrected.selection],
    contexts: [{ step: 'review', receipt }],
  });
  const planHash = hash(plan);
  const automation = automationSnapshot.parse({
    format: 1,
    title: 'Recovery schedule',
    planId,
    planHash,
    planVersion: 1,
    calendar: { timeZone: 'Europe/Madrid', time: '09:00' },
    maxOccurrences: 1,
    taskId: task.id,
    taskVersion: task.version,
    templateName: template.definition.name,
    templateVersion: 1,
    repository: 'fixture/recovery',
    repositoryId: 101,
    linkVersion: 1,
    teamPolicyVersion: 1,
    commit: fixtureCommit,
    destination: 'local',
    apiRequestLimit: 0,
    limits,
    stages: [{ key: 'review', executionId: 'codex-local-v1', model }],
  });
  const config = codingConfiguration.parse({
    executionId: 'codex-local-v1',
    modelRevision: 'fixture-revision',
    contextReceipt: receipt,
    taskId: task.id,
    commit: fixtureCommit,
    model,
    maxRequests: 2,
    maxOutputTokens: 256,
    limits: { timeoutMs: 60000, maxAttempts: 1 },
    memory: [corrected.selection],
  });
  const report = codingReport.parse({
    kind: 'codex-v1',
    jobId,
    commit: fixtureCommit,
    repository: automation.repository,
    task,
    model,
    cliVersion: '0.166.0',
    simulated: true,
    startedAt: time,
    finishedAt: time,
    summary: privateMarker,
    commands: [],
    tests: [],
    diff: [],
    diffComplete: true,
    usage: null,
    cost: null,
    durationMs: null,
    modelRequests: 2,
    terminationConfirmed: true,
    limitations: ['Seeded report'],
  });
  const delivery = teamDelivery.parse({
    jobId,
    step: 'review',
    result: privateMarker,
    sources: [],
    inputHash: receipt.hash,
    outputHash: hash([]),
    tests: [],
    doubts: [],
    verified: true,
  });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const insert = (statement, parameters) => db.query(statement, parameters);
    await insert('INSERT INTO team_templates(id,project_id) VALUES($1,$2)', [templateId, project]);
    await insert(
      'INSERT INTO team_template_versions(template_id,version,definition,origin) VALUES($1,1,$2,$3)',
      [templateId, encode(template.definition), encode(template.origin)],
    );
    await insert(
      'INSERT INTO project_context_maps(project_id,version,hash,markdown,sources) VALUES($1,1,$2,$3,$4)',
      [project, hash(map), map.markdown, encode([])],
    );
    await insert('INSERT INTO job_executors(id,stopped_at) VALUES($1,now())', [executorId]);
    await insert(
      `INSERT INTO jobs(id,project_id,request_id,request_hash,title,kind,configuration,state,attempt,executor_id,finished_at)
      VALUES($1,$2,$3,$4,$5,'codex-v1',$6,'completed',1,$7,now())`,
      [jobId, project, randomUUID(), hash(config), privateMarker, encode(config), executorId],
    );
    await insert(
      `INSERT INTO job_attempts(job_id,attempt,executor_id,state,started_at,finished_at,termination_confirmed)
      VALUES($1,1,$2,'completed',now()-interval '1 second',now(),true)`,
      [jobId, executorId],
    );
    await insert(
      `INSERT INTO context_pack_receipts(id,project_id,owner_id,request_id,request_hash,hash,snapshot,job_id)
      VALUES($1,$2,$3,$4,$5,$5,$6,$7)`,
      [receiptId, project, owner, randomUUID(), receipt.hash, encode(context), jobId],
    );
    await insert(
      `INSERT INTO coding_runs(job_id,task_id,task_snapshot,owner_id,repository_id,repository,commit_sha,files,manifest,excluded,report,
      agent_snapshot,memory_snapshot,context_receipt_id,output_files) VALUES($1,$2,$3,$4,101,$5,$6,'[]','[]','[]',$7,$8,$9,$10,'[]')`,
      [
        jobId,
        task.id,
        encode(task),
        owner,
        automation.repository,
        fixtureCommit,
        encode(report),
        encode(agent),
        encode([corrected.selection]),
        receiptId,
      ],
    );
    await insert(
      `INSERT INTO execution_budgets(id,project_id,request_id,request_hash,name,max_requests,timeout_ms)
      VALUES($1,$2,$3,$4,$5,2,60000)`,
      [budgetId, project, randomUUID(), hash(limits), privateMarker],
    );
    await insert(
      "INSERT INTO execution_budget_steps(job_id,budget_id,attribution,request_limit,fence,released) VALUES($1,$2,'reviewer',2,$3,true)",
      [jobId, budgetId, fence],
    );
    for (const usage of [
      { inputTokens: 7, outputTokens: null, cachedInputTokens: null, reasoningTokens: null },
      null,
    ]) {
      await insert(
        `INSERT INTO execution_request_admissions(job_id,request_id,fence,payload_hash,usage,settled)
        VALUES($1,$2,$3,$4,$5,true)`,
        [jobId, randomUUID(), fence, hash('fixture admission'), usage && encode(usage)],
      );
    }
    await insert(
      `INSERT INTO prepared_team_plans(id,project_id,task_id,request_id,request_hash,snapshot,hash,approved_at,approval_hash)
      VALUES($1,$2,$3,$4,$5,$6,$5,now(),$5)`,
      [planId, project, task.id, randomUUID(), planHash, encode(plan)],
    );
    await insert(
      `INSERT INTO automation_schedules(id,project_id,plan_id,request_id,request_hash,snapshot,hash,approval_hash,state,observed_count)
      VALUES($1,$2,$3,$4,$5,$6,$5,$5,'exhausted',1)`,
      [scheduleId, project, planId, randomUUID(), hash(automation), encode(automation)],
    );
    await insert(
      "INSERT INTO automation_occurrences(id,project_id,schedule_id,due_at,disposition) VALUES($1,$2,$3,now(),'admitted')",
      [occurrenceId, project, scheduleId],
    );
    // Pending parent with no active child verifies the pre-backup drain guard.
    await insert(
      `INSERT INTO team_executions(id,project_id,plan_id,request_id,request_hash,snapshot,commit_sha,repository_id,repository,link_version,budget_id,automation_occurrence_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,101,$8,1,$9,$10)`,
      [
        executionId,
        project,
        planId,
        occurrenceId,
        planHash,
        encode({ hash: planHash, plan }),
        fixtureCommit,
        automation.repository,
        budgetId,
        occurrenceId,
      ],
    );
    await insert(
      "INSERT INTO team_execution_steps(id,execution_id,position,step_key,job_id,delivery) VALUES($1,$2,1,'review',$3,$4)",
      [stepId, executionId, jobId, encode(delivery)],
    );
    await insert(
      "INSERT INTO automation_notifications(id,project_id,occurrence_id,kind,read_at) VALUES($1,$2,$3,'completed',now())",
      [occurrenceId + ':completed', project, occurrenceId],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

try {
  const project = await one("SELECT id,owner_id FROM projects WHERE name='Release journey'");
  assert.ok(project);
  const task = await one(
    `SELECT id,version,title,description,acceptance_criteria AS "acceptanceCriteria"
    FROM tasks WHERE project_id=$1 AND title='Release task'`,
    [project.id],
  );
  if (fixtureMode === 'seed') {
    await seed(project.owner_id, project.id, task);
  } else if (fixtureMode === 'finish') {
    const closed = await pool.query(
      "UPDATE team_executions SET state='completed',finished_at=now() WHERE project_id=$1 AND automation_occurrence_id IS NOT NULL AND state='pending'",
      [project.id],
    );
    assert.equal(closed.rowCount, 1);
  } else {
    assert.equal(fixtureMode, 'verify');
    const row = await one(
      `SELECT p.snapshot AS plan,p.hash AS plan_hash,r.snapshot AS receipt,r.hash AS receipt_hash,
      e.snapshot AS automation,e.hash AS automation_hash,c.report,s.delivery,m.data AS note,n.read_at,v.content AS skill,v.review,
      a.version AS agent_version
      FROM automation_schedules e JOIN automation_occurrences o ON o.schedule_id=e.id
      JOIN automation_notifications n ON n.occurrence_id=o.id
      JOIN team_executions t ON t.automation_occurrence_id=o.id AND t.state='completed'
      JOIN prepared_team_plans p ON p.id=t.plan_id JOIN team_execution_steps s ON s.execution_id=t.id
      JOIN coding_runs c ON c.job_id=s.job_id JOIN context_pack_receipts r ON r.id=c.context_receipt_id
      JOIN project_memory_revisions m ON m.entry_id=(c.memory_snapshot->0->>'id')::uuid AND m.revision=2
      JOIN agent_versions a ON a.role_id=(c.agent_snapshot->>'id')::uuid AND a.version=2
      JOIN skill_versions v ON v.id=(r.snapshot->'payload'->'skills'->0->>'id')::uuid
      WHERE e.project_id=$1`,
      [project.id],
    );
    assert.equal(hash(teamPlanSnapshot.parse(row.plan)), row.plan_hash);
    assert.equal(hash(contextPackSnapshot.parse(row.receipt)), row.receipt_hash);
    assert.equal(hash(automationSnapshot.parse(row.automation)), row.automation_hash);
    assert.equal(codingReport.parse(row.report).summary, privateMarker);
    assert.equal(teamDelivery.parse(row.delivery).inputHash, row.receipt_hash);
    assert.equal(row.note.content, privateMarker + ' version 2');
    assert.equal(row.agent_version, 2);
    assert.equal(row.review, 'approved');
    assert.equal(row.skill.origin.commit, eccCommit);
    assert.ok(row.read_at);
    const extension = await one('SELECT id FROM project_extensions WHERE project_id=$1', [
      project.id,
    ]);
    const restored = await new ProjectExtensions(pool).read(
      project.owner_id,
      project.id,
      extension.id,
    );
    assert.equal(restored.state, 'enabled');
    assert.ok(restored.events.some((event) => event.action === 'run'));
    assert.ok(restored.resources.some((resource) => resource.visible));
    const inventory = await readFile('./dist/modules/utility-packs/inventory.json', 'utf8');
    assert.equal(JSON.parse(inventory).commit, eccCommit);
    console.log(
      JSON.stringify({
        receipt: row.receipt_hash,
        catalogHash: digest(inventory),
        catalogCommit: eccCommit,
      }),
    );
  }
} finally {
  await pool.end();
}
