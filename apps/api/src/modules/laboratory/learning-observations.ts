import type { QueryResultRow } from 'pg';
import { codingReport, type LearningHealth } from '@ferweb/contracts';
import { canonical, digest } from '../jobs/review-artifacts.js';

type Observation = LearningHealth['observations'][number];
const directTest = /^(?:(?:\/bin\/(?:bash|sh)|bash|sh) -lc (['"])node --test\1|node --test)$/;

export function learningObservation(row: QueryResultRow): Observation {
  const report = row.report ? codingReport.parse(row.report) : null;
  const controls = report?.controls?.events ?? [];
  const lastTest = report?.commands.findLast(
    (event) =>
      event.origin === 'codex-event' &&
      event.exitCode !== null &&
      directTest.test(event.command.trim()),
  );
  const test = controls.find((event) => event.id === 'verification');
  const knownFailure = controls.find((event) =>
    ['failed', 'blocked', 'timeout'].includes(event.status),
  );
  const failure =
    row.state !== 'failed'
      ? null
      : knownFailure?.id === 'configuration' ||
          knownFailure?.id === 'verification' ||
          knownFailure?.id === 'artifact'
        ? knownFailure.id
        : row.error_code?.includes('timeout')
          ? 'timeout'
          : report?.agentError || (report?.agentExitCode != null && report.agentExitCode !== 0)
            ? 'agent'
            : row.error_code
              ? 'other'
              : 'unknown';
  const role = row.agent_snapshot;
  const skills = new Map<string, Observation['skills'][number]>();
  for (const { id, version, sha256 } of [...(role?.skills ?? []), ...(row.context_skills ?? [])])
    skills.set(id, { id, version, sha256 });
  return {
    jobId: row.job_id,
    reportHash: report ? digest(canonical(report)) : null,
    role: role ? { id: role.id, version: role.version } : null,
    skills: [...skills.values()],
    state: row.state,
    failure,
    origin:
      report && row.environment?.simulated === report.simulated
        ? report.simulated
          ? 'simulated'
          : 'real'
        : 'unknown',
    agentTest: lastTest ? (lastTest.exitCode === 0 ? 'passed' : 'failed') : 'unobserved',
    controllerTest:
      test?.status === 'passed'
        ? 'passed'
        : test && ['failed', 'timeout', 'blocked'].includes(test.status)
          ? 'failed'
          : 'unobserved',
    recordedAt: row.finished_at.toISOString(),
  };
}
