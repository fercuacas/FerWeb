import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export class CredentialCipher {
  private readonly key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, 'base64');
  }
  encrypt(value: string, context: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [nonce, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64url'))
      .join('.');
  }
  decrypt(value: string, context: string) {
    const [nonce, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!nonce || !tag || !encrypted) throw new Error('Invalid encrypted credential');
    const cipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
  }
}
export function validSignature(secret: string, payload: Buffer, signature: string | undefined) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const actual = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(payload).digest();
  return timingSafeEqual(actual, expected);
}
