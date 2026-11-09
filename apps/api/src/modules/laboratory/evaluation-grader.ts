import type { AgentEvaluationEvidence } from '@ferweb/contracts';
import { digest } from '../jobs/review-artifacts.js';

type Grade = AgentEvaluationEvidence['solo']['grade'];
export const additionPath = 'src/add.cjs';
export const ungraded = (status: 'unverifiable' | 'not_run', code: string): Grade => ({
  status,
  code,
  passed: null,
  total: null,
});

// The candidate is data. Accept only a whole, bounded declaration in this fixture's
// grammar; never load CommonJS, evaluate JS, or execute the candidate's tests here.
const arrow = /^exports\.add\s*=\s*\(a,\s*b\)[ \t]*=>\s*([ab])\s*([+-])\s*([ab]);?$/;
const declaration =
  /^exports\.add\s*=\s*function\s*\(a,\s*b\)\s*\{\s*return[ \t]+([ab])\s*([+-])\s*([ab]);?\s*\};?$/;
const probes = [
  [0, 27, 27],
  [-13, 41, 28],
  [142, -192, -50],
  [-17, -29, -46],
  [113, 287, 400],
] as const;
export const additionFixtureHash = digest(
  JSON.stringify(['addition-v1', additionPath, arrow.source, declaration.source, probes]),
);

export function gradeAddition(source: string | undefined): Grade {
  if (source === undefined) return ungraded('unverifiable', 'fixture_source_missing');
  const candidate = source.trim();
  const expression =
    candidate.length <= 256 && (arrow.exec(candidate) ?? declaration.exec(candidate));
  if (!expression) return ungraded('unverifiable', 'fixture_unsupported_or_modified');
  const [, left, op, right] = expression;
  const passed = probes.filter(([a, b, expected]) => {
    const lhs = left === 'a' ? a : b;
    const rhs = right === 'a' ? a : b;
    return (op === '+' ? lhs + rhs : lhs - rhs) === expected;
  }).length;
  return {
    status: passed === probes.length ? 'passed' : 'failed',
    code: 'addition-v1',
    passed,
    total: probes.length,
  };
}

export function gradeAdditionArtifact(
  before: Map<string, string>,
  after: Map<string, string>,
): Grade {
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const path of paths)
    if (path !== additionPath && before.get(path) !== after.get(path))
      return ungraded('unverifiable', 'fixture_scope_changed');
  return gradeAddition(after.get(additionPath));
}
