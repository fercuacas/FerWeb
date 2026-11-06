// Token splitting and character n-gram routing adapted from ECC's MIT-licensed
// scripts/lib/context-retrieval.js at b38be6a7f6350964d59328b52f0624e1d1d552d1.
// See ECC-LICENSE.txt. FerWeb adds Spanish normalization and literal precedence.
const stop = new Set(
  'a an and are for from help i in is it me my of on please the to with el la los las de del un una unos unas y o para por con en es que como quiero necesito favor hacer usar'.split(
    ' ',
  ),
);
export function normalize(text: string) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}
export function terms(text: string) {
  return [
    ...new Set(
      normalize(text)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((x) => x.length > 1 && !stop.has(x)),
    ),
  ].slice(0, 100);
}
function grams(text: string) {
  const result = new Set<string>();
  for (const token of terms(text))
    for (let n = 3; n <= Math.min(4, token.length); n++)
      for (let i = 0; i <= token.length - n; i++) result.add(token.slice(i, i + n));
  return result;
}
export function lexicalScore(query: string, name: string, body: string) {
  const q = terms(query),
    a = new Set(terms(name)),
    b = new Set(terms(body)),
    matched = q.filter((x) => a.has(x) || b.has(x));
  const qa = grams(query),
    ba = grams(name + ' ' + body.slice(0, 800));
  let overlap = 0;
  for (const g of qa) if (ba.has(g)) overlap++;
  const ngram = qa.size ? overlap / qa.size : 0;
  return {
    score: matched.reduce((v, t) => v + (a.has(t) ? 4 : 1), 0) + (ngram >= 0.45 ? ngram : 0),
    matched,
    ngram,
  };
}
export function rankSources<
  T extends { id: string; path: string; content: string; start_line: number },
>(query: string, rows: T[]) {
  const literals = [...query.matchAll(/`([^`]{2,300})`|"([^"\n]{3,300})"/g)].map(
    (x) => x[1] ?? x[2]!,
  );
  const rawTokens = query
    .split(/\s+/)
    .map((x) => x.replace(/^[`"'(]+|[`"'),;:]+$/g, ''))
    .filter((x) => x.length >= 3);
  return rows
    .map((row) => {
      const base = lexicalScore(query, row.path, row.content),
        reason: ('exact_path' | 'exact_identifier' | 'exact_text' | 'lexical' | 'ngrams')[] = [];
      if (query.trim() === row.path || [...rawTokens, ...literals].includes(row.path))
        reason.push('exact_path');
      if (rawTokens.some((x) => /[_A-Z]/.test(x) && row.content.includes(x)))
        reason.push('exact_identifier');
      if (literals.some((x) => row.content.includes(x))) reason.push('exact_text');
      if (base.matched.length) reason.push('lexical');
      if (base.ngram >= 0.45) reason.push('ngrams');
      return {
        row,
        score: base.score + reason.filter((x) => x.startsWith('exact')).length * 100,
        reason,
      };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.row.path.localeCompare(b.row.path) ||
        a.row.start_line - b.row.start_line ||
        a.row.id.localeCompare(b.row.id),
    );
}
export function fuseRanks(
  lexical: { id: string; exact: boolean }[],
  vector: { id: string; score: number }[],
) {
  const scores = new Map<
    string,
    {
      id: string;
      score: number;
      lexicalRank: number | null;
      vectorRank: number | null;
      exact: boolean;
    }
  >();
  lexical.forEach((x, i) =>
    scores.set(x.id, {
      id: x.id,
      score: 1 / (60 + i + 1),
      lexicalRank: i + 1,
      vectorRank: null,
      exact: x.exact,
    }),
  );
  vector.forEach((x, i) => {
    const value = scores.get(x.id) ?? {
      id: x.id,
      score: 0,
      lexicalRank: null,
      vectorRank: null,
      exact: false,
    };
    value.score += 1 / (60 + i + 1);
    value.vectorRank = i + 1;
    scores.set(x.id, value);
  });
  return [...scores.values()].sort(
    (a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.id.localeCompare(b.id),
  );
}
