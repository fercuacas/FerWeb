import type { z } from 'zod';
import {
  skillIsPortable,
  supportsAgent,
  type SkillVersion,
  type ExecutionOption,
  type contextSkillRule,
} from '@ferweb/contracts';
import { lexicalScore, terms } from '../retrieval/ranking.js';
import { HttpError } from '../../http-error.js';
export function selectContextSkills(input: {
  skills: SkillVersion[];
  rules: z.infer<typeof contextSkillRule>[];
  query: string;
  profile: 'lean' | 'full';
  mode: 'manual' | 'suggested' | 'automatic';
  explicit: string[];
  excluded: string[];
  mandatory: string[];
  execution: ExecutionOption;
}) {
  const byId = new Map(input.skills.map((s) => [s.id, s])),
    rules = new Map(input.rules.map((r) => [r.id, r])),
    explicit = new Set([...input.explicit, ...input.mandatory]),
    excluded = new Set(input.excluded),
    selected = new Map<
      string,
      {
        skill: SkillVersion;
        reason: 'mandatory_role' | 'manual' | 'lexical' | 'dependency';
        score: number;
        matched: string[];
      }
    >(),
    diagnostics: string[] = [];
  const fail = (code: string) => new HttpError(422, 'context_skill_selection', code);
  function add(
    id: string,
    reason: 'mandatory_role' | 'manual' | 'lexical' | 'dependency',
    seen = new Set<string>(),
  ) {
    if (selected.has(id)) return;
    if (seen.has(id)) throw fail('Dependencia circular entre skills.');
    seen.add(id);
    const skill = byId.get(id),
      rule = rules.get(id);
    if (
      !skill ||
      skill.review !== 'approved' ||
      !skillIsPortable(skill) ||
      !supportsAgent(skill, input.execution)
    )
      throw fail('La skill no está revisada o no es compatible con el ejecutor.');
    if (
      excluded.has(id) ||
      (rule && !rule.profiles.includes(input.profile)) ||
      (rule?.explicitOnly && !explicit.has(id))
    )
      throw fail(
        'La selección exige una skill excluida, de otro perfil o de invocación explícita.',
      );
    if (
      [...selected.keys()].some(
        (other) => rule?.excludes.includes(other) || rules.get(other)?.excludes.includes(id),
      )
    )
      throw fail('Las skills seleccionadas se excluyen entre sí.');
    for (const dep of rule?.dependsOn ?? []) add(dep, 'dependency', new Set(seen));
    if (
      [...selected.keys()].some(
        (other) => rule?.excludes.includes(other) || rules.get(other)?.excludes.includes(id),
      )
    )
      throw fail('Las dependencias de una skill se excluyen entre sí.');
    if (selected.size >= 3)
      throw fail('El contexto admite hasta tres skills, incluidas las del rol y sus dependencias.');
    const score = lexicalScore(
      input.query,
      skill.name +
        ' ' +
        skill.slug +
        ' ' +
        skill.technologies.join(' ') +
        ' ' +
        (rule?.keywordsEs ?? []).join(' ') +
        ' ' +
        (rule?.keywordsEn ?? []).join(' '),
      skill.description,
    );
    selected.set(id, { skill, reason, score: score.score, matched: score.matched });
  }
  for (const id of input.mandatory) add(id, 'mandatory_role');
  for (const id of input.explicit) add(id, 'manual');
  const latest = [...byId.values()]
    .filter((s) => s.review === 'approved')
    .filter(
      (s, _i, all) => !all.some((other) => other.slug === s.slug && other.version > s.version),
    );
  const suggestions = latest
    .map((skill) => {
      const rule = rules.get(skill.id),
        rank = lexicalScore(
          input.query,
          skill.name +
            ' ' +
            skill.slug +
            ' ' +
            skill.technologies.join(' ') +
            ' ' +
            (rule?.keywordsEs ?? []).join(' ') +
            ' ' +
            (rule?.keywordsEn ?? []).join(' '),
          skill.description,
        );
      return { skill, ...rank };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.skill.slug.localeCompare(b.skill.slug) ||
        a.skill.id.localeCompare(b.skill.id),
    );
  for (const item of suggestions.slice(0, 50)) {
    if (selected.has(item.skill.id)) continue;
    if (input.mode === 'automatic') {
      const rule = rules.get(item.skill.id),
        anchors = new Set(
          terms(
            [
              item.skill.name,
              item.skill.slug,
              ...item.skill.technologies,
              ...(rule?.keywordsEs ?? []),
              ...(rule?.keywordsEn ?? []),
            ].join(' '),
          ),
        );
      if (!item.matched.some((t) => anchors.has(t))) {
        diagnostics.push('skill_requires_explicit_selection:' + item.skill.id);
        continue;
      }
      const tied = suggestions.some(
        (other) => other.skill.id !== item.skill.id && Math.abs(other.score - item.score) < 1e-9,
      );
      if (tied && !input.query.toLowerCase().includes(item.skill.slug)) {
        diagnostics.push('ambiguous_skill_selection:' + item.skill.id);
        continue;
      }
    }
    const before = new Map(selected);
    try {
      add(item.skill.id, 'lexical');
      if (input.mode !== 'automatic') {
        selected.clear();
        for (const pair of before) selected.set(...pair);
      } else if (input.profile === 'lean') break;
    } catch (error) {
      selected.clear();
      for (const pair of before) selected.set(...pair);
      if (!(error instanceof HttpError)) throw error;
      diagnostics.push('skill_not_admitted:' + item.skill.id);
    }
  }
  return { selected: [...selected.values()], suggestions: suggestions.slice(0, 50), diagnostics };
}
