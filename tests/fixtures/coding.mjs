import { readFileSync } from 'node:fs';
import { addSource } from './retrieval.mjs';
export function codingCorpus(fixture) {
  for (const path of ['src/add.cjs', 'tests/add.test.cjs', 'tests/isolation-probe.cjs'])
    addSource(
      fixture,
      path,
      readFileSync(new URL('./coding-repo/' + path, import.meta.url), 'utf8'),
    );
  return fixture;
}
