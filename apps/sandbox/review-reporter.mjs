// Trusted reporter: repository stdout/stderr are not verification records.
export default async function* report(events) {
  for await (const event of events) {
    if (!['test:pass', 'test:fail'].includes(event.type) || event.data.details?.type === 'suite')
      continue;
    let error = event.data.details?.error,
      assertion = false;
    for (let i = 0; i < 5 && error; i++, error = error.cause)
      if (error.code === 'ERR_ASSERTION') assertion = true;
    yield JSON.stringify({
      protocol: 'ferweb-test-v1',
      name: event.data.name,
      outcome:
        event.data.skip || event.data.todo
          ? 'skipped'
          : event.type === 'test:pass'
            ? 'passed'
            : assertion
              ? 'failed'
              : 'unverifiable',
      file: event.data.file ?? null,
    }) + '\n';
  }
}
