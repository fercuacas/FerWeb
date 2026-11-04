import http from 'node:http';
export function docker(method, path, body, limit = 20 * 1024 * 1024, onData) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: '/var/run/docker.sock',
        method,
        path: '/v1.51' + path,
        headers: body ? { 'content-type': 'application/json' } : {},
      },
      (res) => {
        const parts = [];
        let size = 0;
        res.on('data', (part) => {
          size += part.length;
          if (size > limit) res.destroy(new Error('docker_output_limit'));
          else {
            parts.push(part);
            onData?.(part);
          }
        });
        res.on('error', reject);
        res.on('end', () => {
          const data = Buffer.concat(parts);
          if (res.statusCode >= 400) {
            reject(
              Object.assign(new Error('docker_operation_failed_' + res.statusCode), {
                detail: data.toString().slice(0, 500),
              }),
            );
            return;
          }
          resolve(data);
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(150000, () => request.destroy(new Error('docker_timeout')));
    request.end(body ? JSON.stringify(body) : undefined);
  });
}
export async function json(method, path, body) {
  const data = await docker(method, path, body);
  return data.length ? JSON.parse(data.toString()) : null;
}
export function demux(data) {
  const parts = [];
  let offset = 0;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset + 4);
    if (offset + 8 + length > data.length) throw new Error('docker_stream_truncated');
    parts.push(data.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return Buffer.concat(parts).toString('utf8');
}
