// Execute inside the compiled API. Tokens and provider configuration stay inside the container.
const probe = String.raw`
const base = 'http://127.0.0.1:3001';
const fetchLocal = (path, headers) =>
  fetch(base + path, { headers, redirect: 'error', signal: AbortSignal.timeout(6000) });
const health = await fetchLocal('/api/health/ready');
const state = await health.json();
const metrics = await fetchLocal('/internal/metrics', { Authorization: 'Bearer ' + process.env.METRICS_TOKEN });
if (!metrics.ok) throw Error('Protected operations metrics unavailable.');
const samples = (await metrics.text()).split('\n').filter((line) =>
  /^ferweb_(operations_|jobs\{|process_resident_memory_bytes )/.test(line));
const issues = samples.filter((line) => line.startsWith('ferweb_operations_queue_inconsistencies{'));
if (issues.length !== 3) throw Error('Incomplete operations diagnostics.');
console.log(JSON.stringify({
  ready: health.ok,
  checks: state.checks,
  queueConsistent: issues.every((line) => line.endsWith(' 0')),
  samples,
}));`;

export async function diagnose(options) {
  const result = await options.run(['exec', '-T', 'api', 'node', '--input-type=module'], {
    input: probe,
    capture: true,
  });
  return JSON.parse(result);
}
