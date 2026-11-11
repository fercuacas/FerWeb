import {
  codingWorkspace,
  type AgentEvaluationEvidence,
  type AgentEvaluationInput,
  type codingConfiguration,
  type codingRunSchema,
  type contextReceipt,
  type teamExecutionResponse,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { HttpError } from '../../http-error.js';
import { canonical, digest, publicationTree } from '../jobs/review-artifacts.js';
import {
  additionFixtureHash,
  additionPath,
  gradeAddition,
  gradeAdditionArtifact,
  ungraded,
} from './evaluation-grader.js';

type Team = z.infer<typeof teamExecutionResponse>;
type Arm = AgentEvaluationEvidence['solo'];
export type EvaluationRun = {
  run: z.infer<typeof codingRunSchema>;
  configuration: z.infer<typeof codingConfiguration>;
  repositoryId: string;
  state: Arm['steps'][number]['state'];
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  files: unknown;
  tree: Parameters<typeof publicationTree>[2] | null;
  output: unknown;
  receipt: z.infer<typeof contextReceipt> | null;
  memory: unknown;
};
const fingerprint = (value: unknown) => digest(canonical(value));
const filesFingerprint = (files: Iterable<[string, string]>) =>
  fingerprint([...files].map(([path, text]) => [path, digest(text)]).sort());
const elapsed = (start: string | Date, end: string | Date | null) =>
  end ? Math.max(0, new Date(end).getTime() - new Date(start).getTime()) : null;
function baseline(item: EvaluationRun) {
  const parsed = codingWorkspace.safeParse(item.files);
  if (!parsed.success) return null;
  const files = new Map(parsed.data.map(({ path, content }) => [path, content]));
  const manifest = new Map(item.run.manifest.map((file) => [file.path, file.contentHash]));
  if (
    files.size !== parsed.data.length ||
    files.size !== manifest.size ||
    [...files].some(([path, content]) => manifest.get(path) !== digest(content))
  )
    return null;
  return files;
}

function checkedArtifact(item: EvaluationRun, input: Map<string, string>) {
  const { run } = item;
  const report = run.report;
  if (
    !report?.controls ||
    report.jobId !== run.jobId ||
    report.commit !== run.commit ||
    report.controls.receiptId !== (run.contextReceipt?.id ?? null) ||
    report.controls.files !== input.size ||
    report.controls.inputHash !==
      digest(
        JSON.stringify([
          run.commit,
          [...input].map(([p, c]) => [p, digest(c)]).sort(),
          report.controls.receiptId,
        ]),
      )
  )
    return null;
  if (
    report.reason !== 'completed' ||
    report.turnCompleted !== true ||
    report.agentError ||
    report.agentExitCode !== 0 ||
    !report.terminationConfirmed ||
    !report.diffComplete ||
    report.controls.events.some((event) => event.status !== 'passed') ||
    !item.tree
  )
    return null;
  const output = new Map(input);
  try {
    if (report.diff.length)
      for (const entry of publicationTree(
        report,
        [...input].map(([path, content]) => ({ path, content })),
        item.tree,
      )) {
        if ('content' in entry) output.set(entry.path, entry.content);
        else output.delete(entry.path);
      }
  } catch (error) {
    if (error instanceof HttpError && error.code === 'review_artifact_invalid') return null;
    throw error;
  }
  return output;
}

function context(
  item: EvaluationRun,
  corpus: AgentEvaluationInput['case'],
): Arm['steps'][number]['context'] {
  const receipt = item.receipt;
  if (!receipt) return null;
  const { snapshot, expansions } = receipt;
  const sources = [
    ...snapshot.payload.map.sources,
    ...snapshot.payload.sources,
    ...expansions.flatMap((e) => e.sources),
  ];
  return {
    receiptHash: receipt.finalHash,
    inputHash: fingerprint({
      protocol: snapshot.protocol,
      implementation: snapshot.implementation,
      profile: snapshot.profile,
      policy: snapshot.policy.hash,
      payload: snapshot.payload,
      expansions: expansions.map(({ status, sources, errorCode }) => ({
        status,
        sources,
        errorCode,
      })),
    }),
    bytes: receipt.bytes,
    expansions: expansions.length,
    diagnostics: [
      ...(snapshot.complete ? [] : ['context_incomplete']),
      ...(expansions.some((item) => item.status !== 'completed')
        ? ['context_expansion_incomplete']
        : []),
    ],
    relevance:
      corpus === 'recorded'
        ? 'unknown'
        : sources.some((s) => s.path === additionPath)
          ? 'observed'
          : 'missing',
  };
}

function step(
  metadata: Pick<Arm['steps'][number], 'jobId' | 'key' | 'iteration' | 'state' | 'errorCode'>,
  item: EvaluationRun | null,
  corpus: AgentEvaluationInput['case'],
): Arm['steps'][number] {
  const report = item?.run.report;
  const usage = item?.run.budget?.steps.find((s) => s.jobId === metadata.jobId);
  return {
    ...metadata,
    reportHash: report ? fingerprint(report) : null,
    durationMs: report?.durationMs ?? null,
    requests: usage?.admittedRequests ?? report?.modelRequests ?? null,
    attribution: usage?.attribution ?? null,
    providerUsage: report?.providerUsage ?? null,
    tests: (report?.tests ?? []).map(({ command, origin, exitCode }) => ({
      command,
      origin,
      exitCode,
    })),
    context: item ? context(item, corpus) : null,
  };
}

function evidenceKind(runs: EvaluationRun[]): Arm['evidence'] {
  const values = runs.map(({ run }) =>
    run.report && run.environment?.simulated !== run.report.simulated
      ? null
      : (run.environment?.simulated ?? null),
  );
  if (values.includes(true) && values.includes(false)) return 'mixed';
  if (!values.length || values.some((v) => typeof v !== 'boolean')) return 'unknown';
  return values[0] ? 'simulated' : 'real';
}
const taskHash = ({
  id,
  version,
  title,
  description,
  acceptanceCriteria,
}: Record<string, unknown>) => fingerprint([id, version, title, description, acceptanceCriteria]);
const environmentHash = ({ run, configuration }: EvaluationRun) =>
  run.environment?.image && run.environment?.policyHash
    ? fingerprint([run.environment, configuration.workspaceAccess ?? 'write'])
    : null;
const contextHash = (item: EvaluationRun, corpus: AgentEvaluationInput['case']) => {
  const receipt = context(item, corpus);
  return fingerprint([
    item.memory,
    item.run.agent?.materials ?? [],
    receipt?.inputHash ?? null,
    item.configuration.recipe ?? null,
  ]);
};

export function evaluationEvidence(
  corpus: AgentEvaluationInput['case'],
  solo: EvaluationRun,
  team: Team,
  children: Map<string, EvaluationRun>,
): AgentEvaluationEvidence {
  const { execution, plan } = team;
  const runs = team.steps.flatMap((s) => (s.jobId ? [children.get(s.jobId)!] : []));
  const first = runs[0];
  const soloInput = baseline(solo);
  const teamInput = first ? baseline(first) : null;
  const soloSource = soloInput && filesFingerprint(soloInput);
  const teamSource = teamInput && filesFingerprint(teamInput);
  const soloEnv = environmentHash(solo);
  const teamEnv = first ? environmentHash(first) : null;
  const soloTask = taskHash(solo.run.task);
  const teamTask = taskHash(plan.task);
  const soloLimits = solo.configuration.budgetLimits ?? null;
  const teamBudget = first?.run.budget;
  const soloKind = evidenceKind([solo]);
  const teamKind = evidenceKind(runs);
  const differences: AgentEvaluationEvidence['differences'] = [];
  if (soloTask !== teamTask || runs.some(({ run }) => taskHash(run.task) !== teamTask))
    differences.push('task');
  if (
    !soloSource ||
    soloSource !== teamSource ||
    !first ||
    solo.run.commit !== execution.commit ||
    canonical(solo.tree) !== canonical(first.tree) ||
    runs.some(
      (item) => item.repositoryId !== solo.repositoryId || item.run.commit !== execution.commit,
    )
  )
    differences.push('snapshot');
  if (!soloEnv || soloEnv !== teamEnv || runs.some((run) => environmentHash(run) !== teamEnv))
    differences.push('tools');
  if (
    !soloLimits ||
    canonical(soloLimits) !== canonical(plan.limits) ||
    canonical(solo.run.budget?.limits ?? null) !== canonical(soloLimits) ||
    canonical(teamBudget?.limits ?? null) !== canonical(plan.limits) ||
    teamBudget?.id !== execution.budgetId ||
    teamBudget?.steps.some((item) => !children.has(item.jobId)) ||
    solo.configuration.maxRequests !== plan.limits.maxRequests ||
    solo.configuration.limits.timeoutMs !== plan.limits.timeoutMs ||
    solo.run.budget?.steps.length !== 1 ||
    runs.some(
      ({ configuration, run }) =>
        run.budget?.id !== execution.budgetId ||
        configuration.limits.timeoutMs !== plan.limits.timeoutMs ||
        configuration.maxOutputTokens !== solo.configuration.maxOutputTokens,
    )
  )
    differences.push('limits');
  if (
    solo.configuration.model !== plan.model ||
    (solo.run.report && solo.run.report.model !== solo.configuration.model) ||
    runs.some(
      ({ configuration, run }) =>
        configuration.model !== plan.model || (run.report && run.report.model !== plan.model),
    )
  )
    differences.push('model');
  if (runs.some((run) => contextHash(run, corpus) !== contextHash(solo, corpus)))
    differences.push('context');
  if (
    soloKind !== teamKind ||
    !['simulated', 'real'].includes(soloKind) ||
    plan.execution.simulated !== (teamKind === 'simulated')
  )
    differences.push('destination');

  const soloOutput =
    solo.state === 'completed' && soloInput ? checkedArtifact(solo, soloInput) : null;
  let teamOutput = teamInput;
  if (execution.state === 'completed' && team.gathering.complete && teamOutput) {
    for (const entry of team.steps) {
      const child = entry.jobId ? children.get(entry.jobId) : null;
      const childInput = child ? baseline(child) : null;
      const childOutput = child && childInput ? checkedArtifact(child, childInput) : null;
      const captured = codingWorkspace.safeParse(child?.output);
      if (
        !teamOutput ||
        !child ||
        child.state !== 'completed' ||
        !childInput ||
        !childOutput ||
        !captured.success ||
        !entry.delivery?.verified ||
        entry.delivery.jobId !== child.run.jobId ||
        entry.delivery.inputHash !== fingerprint(child.files) ||
        entry.delivery.outputHash !== fingerprint(captured.data) ||
        filesFingerprint(childInput) !== filesFingerprint(teamOutput) ||
        filesFingerprint(childOutput) !==
          filesFingerprint(captured.data.map(({ path, content }) => [path, content]))
      ) {
        teamOutput = null;
        break;
      }
      teamOutput = childOutput;
    }
  } else teamOutput = null;

  function grades(
    state: Arm['state'],
    before: Map<string, string> | null,
    after: Map<string, string> | null,
  ) {
    const baseline =
      corpus === 'recorded'
        ? ungraded('not_run', 'recorded_only')
        : gradeAddition(before?.get(additionPath));
    const grade =
      corpus === 'recorded'
        ? baseline
        : state !== 'completed'
          ? ungraded('not_run', 'run_not_completed')
          : !after
            ? ungraded('unverifiable', 'artifact_unverified')
            : !before || baseline.status !== 'failed'
              ? ungraded('unverifiable', 'fixture_baseline_not_failing')
              : gradeAdditionArtifact(before, after);
    return {
      baseline,
      grade,
      artifactHash: after && filesFingerprint(after),
      costUsd: null,
      lineCoverage: null,
    };
  }
  const soloState = solo.state as Arm['state'];
  return {
    protocol: 'ferweb-agent-evaluation-v1',
    case: corpus,
    planHash: execution.planHash,
    fixtureHash: corpus === 'addition-v1' ? additionFixtureHash : null,
    comparable: differences.length === 0,
    differences,
    solo: {
      ...grades(soloState, soloInput, soloOutput),
      state: soloState,
      errorCode: solo.errorCode,
      elapsedMs: elapsed(solo.createdAt, solo.finishedAt),
      limits: soloLimits,
      iterations: solo.run.report || solo.run.budget?.deadlineAt ? 1 : 0,
      model: solo.configuration.model,
      maxOutputTokens: solo.configuration.maxOutputTokens,
      evidence: soloKind,
      repository: solo.run.repository,
      commit: solo.run.commit,
      taskHash: soloTask,
      sourceHash: soloSource,
      environmentHash: soloEnv,
      steps: [
        step(
          {
            key: 'solo',
            iteration: 1,
            jobId: solo.run.jobId,
            state: solo.state,
            errorCode: solo.errorCode,
          },
          solo,
          corpus,
        ),
      ],
    },
    team: {
      ...grades(execution.state as Arm['state'], teamInput, teamOutput),
      state: execution.state as Arm['state'],
      errorCode: execution.errorCode,
      elapsedMs: elapsed(execution.createdAt, execution.finishedAt),
      limits: plan.limits,
      iterations: Math.max(0, ...team.steps.filter((s) => s.jobId).map((s) => s.iteration)),
      model: plan.model,
      maxOutputTokens: first?.configuration.maxOutputTokens ?? null,
      evidence: teamKind,
      repository: execution.repository,
      commit: execution.commit,
      taskHash: teamTask,
      sourceHash: teamSource,
      environmentHash: teamEnv,
      steps: team.steps.map(({ jobId, key, iteration, state, errorCode }) =>
        step(
          { jobId, key, iteration, state, errorCode },
          jobId ? children.get(jobId)! : null,
          corpus,
        ),
      ),
    },
  };
}
