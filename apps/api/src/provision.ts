import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readConfig } from './config.js';
import { createPool } from './database.js';
import { provisionOwner } from './modules/identity/provision.js';

async function secret(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Use an interactive terminal or FERWEB_OWNER_PASSWORD.');
  stdout.write(prompt);
  const previousRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function finish() {
      stdin.off('data', read);
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdout.write('\n');
    }
    function read(chunk: string) {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ') value += character;
      }
    }
    stdin.on('data', read);
  });
}

try {
  let email = process.env.FERWEB_OWNER_EMAIL;
  if (!email) {
    if (!stdin.isTTY) throw new Error('Use an interactive terminal or FERWEB_OWNER_EMAIL.');
    const reader = createInterface({ input: stdin, output: stdout });
    email = await reader.question('Correo del propietario: ');
    reader.close();
  }
  const password =
    process.env.FERWEB_OWNER_PASSWORD ?? (await secret('Contraseña (12–128 caracteres; oculta): '));
  if (!process.env.FERWEB_OWNER_PASSWORD && password !== (await secret('Repite la contraseña: ')))
    throw new Error('Las contraseñas no coinciden.');
  const pool = createPool(readConfig());
  try {
    await provisionOwner(pool, { email, password });
    console.log('Propietario creado. Ya puedes entrar en FerWeb.');
  } finally {
    await pool.end();
  }
} catch (error) {
  if (error instanceof Error && error.message.startsWith('Owner already'))
    console.error('Ya existe un propietario. Se han conservado sus credenciales.');
  else
    console.error(
      'No se pudo crear el propietario. Comprueba conexión, migraciones y un correo y contraseña válidos.',
    );
  process.exitCode = 1;
}
