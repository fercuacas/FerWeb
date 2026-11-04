import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { githubLinkSchema, githubSnapshotSchema, type GitHubSnapshot } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { tokenHash } from '../identity/sessions.js';
import { CredentialCipher } from './crypto.js';
import { GitHubClient, readableInstallation, visiblePath, type GitHubFetch } from './client.js';
import type { GitHubConfig } from './config.js';

const absent = () => new HttpError(404, 'not_found', 'No se ha encontrado el recurso.');
const changed = () =>
  new HttpError(
    409,
    'github_changed',
    'La conexión o el proyecto han cambiado. Actualiza antes de continuar.',
  );
interface Access {
  token: string;
  encrypted: string;
  api: GitHubClient;
  owner: string;
  installation: number;
}
function dto(row: QueryResultRow) {
  return githubLinkSchema.parse({
    installationId: Number(row.installation_id),
    repositoryId: Number(row.repository_id),
    fullName: row.full_name,
    branch: row.branch,
    version: row.version,
    stale: row.stale,
    revoked: row.revoked,
    syncedAt: row.synced_at?.toISOString() ?? null,
    snapshot: row.snapshot,
  });
}
export class GitHubService {
  readonly client: GitHubClient | null;
  private readonly cipher: CredentialCipher | null;
  constructor(
    readonly pool: Pool,
    readonly config: GitHubConfig | null,
    transport?: GitHubFetch,
  ) {
    this.client = config ? new GitHubClient(config, transport) : null;
    this.cipher = config ? new CredentialCipher(config.encryptionKey) : null;
  }
  private configured() {
    if (!this.config || !this.client || !this.cipher)
      throw new HttpError(
        503,
        'github_unconfigured',
        'GitHub App todavía no está configurada en el servidor. Consulta docs/github.md.',
      );
    return { config: this.config, api: this.client.operation(), cipher: this.cipher };
  }
  async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async project(owner: string, project: string) {
    const row = (
      await this.pool.query('SELECT * FROM projects WHERE owner_id=$1 AND id=$2', [owner, project])
    ).rows[0];
    if (!row) throw absent();
    return row;
  }
  private async writable(client: PoolClient, owner: string, project: string) {
    const row = (
      await client.query('SELECT * FROM projects WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
        owner,
        project,
      ])
    ).rows[0];
    if (!row) throw absent();
    if (row.archived_at)
      throw new HttpError(
        409,
        'project_archived',
        'Restaura el proyecto antes de cambiar su integración.',
      );
  }
  async status(owner: string) {
    const row = (
      await this.pool.query(
        'SELECT login, encrypted_token IS NOT NULL AS connected, expires_at FROM github_connections WHERE owner_id=$1',
        [owner],
      )
    ).rows[0];
    return {
      configured: !!this.config,
      connected:
        !!this.config &&
        !!row?.connected &&
        (!row.expires_at || row.expires_at.getTime() > Date.now()),
      login: row?.login ?? null,
      expiresAt: row?.expires_at?.toISOString() ?? null,
      installUrl: this.config
        ? `https://github.com/apps/${this.config.appSlug}/installations/new`
        : null,
    };
  }
  async start(owner: string, sessionToken: string) {
    const { config, cipher } = this.configured();
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url');
    await this.pool.query(
      'DELETE FROM github_oauth_states WHERE expires_at <= now() OR session_hash=$1',
      [tokenHash(sessionToken)],
    );
    const result = await this.pool.query(
      `INSERT INTO github_oauth_states (state_hash, session_hash, encrypted_verifier, expires_at)
      SELECT $1, token_hash, $3, LEAST(expires_at, now()+interval '10 minutes') FROM sessions WHERE token_hash=$2 AND user_id=$4 AND expires_at>now()`,
      [
        tokenHash(state),
        tokenHash(sessionToken),
        cipher.encrypt(verifier, tokenHash(state)),
        owner,
      ],
    );
    if (!result.rowCount)
      throw new HttpError(401, 'unauthenticated', 'Vuelve a entrar antes de conectar GitHub.');
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      allow_signup: 'false',
    }).toString();
    return { url: url.href };
  }
  async callback(state: string, code?: string) {
    const { api, cipher } = this.configured();
    const result = await this.pool.query(
      `DELETE FROM github_oauth_states s USING sessions a WHERE s.state_hash=$1 AND s.session_hash=a.token_hash AND s.expires_at>now() AND a.expires_at>now() RETURNING s.encrypted_verifier,s.session_hash,a.user_id`,
      [tokenHash(state)],
    );
    const row = result.rows[0];
    if (!row || !code)
      throw new HttpError(
        400,
        'github_oauth_state',
        'La autorización ha caducado o ha sido cancelada. Iníciala de nuevo.',
      );
    const owner = row.user_id as string;
    const token = await api.exchange(
      code,
      cipher.decrypt(row.encrypted_verifier, tokenHash(state)),
    );
    const user = await api.user(token.access_token);
    await this.transaction(async (client) => {
      // Session revocation while GitHub was responding must cancel the connection too.
      const session = await client.query(
        'SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR SHARE',
        [row.session_hash, owner],
      );
      if (!session.rowCount)
        throw new HttpError(401, 'unauthenticated', 'La sesión de conexión ha terminado.');
      const previous = (
        await client.query(
          'SELECT github_user_id FROM github_connections WHERE owner_id=$1 FOR UPDATE',
          [owner],
        )
      ).rows[0];
      if (previous && Number(previous.github_user_id) !== user.id)
        await client.query('DELETE FROM github_installations WHERE owner_id=$1', [owner]);
      await client.query(
        `INSERT INTO github_connections (owner_id,github_user_id,login,encrypted_token,expires_at) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (owner_id) DO UPDATE SET github_user_id=$2,login=$3,encrypted_token=$4,expires_at=$5,updated_at=now()`,
        [
          owner,
          user.id,
          user.login,
          cipher.encrypt(token.access_token, owner),
          token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
        ],
      );
    });
  }
  async revoke(owner: string) {
    await this.transaction(async (client) => {
      await client.query('UPDATE github_connections SET encrypted_token=NULL WHERE owner_id=$1', [
        owner,
      ]);
      await client.query('UPDATE github_installations SET active=false WHERE owner_id=$1', [owner]);
      await client.query(
        'UPDATE github_links SET revoked=true,stale=true,snapshot=NULL,synced_at=NULL,generation=generation+1 WHERE owner_id=$1',
        [owner],
      );
    });
  }
  async disconnect(owner: string) {
    await this.transaction(async (client) => {
      await client.query(
        'DELETE FROM github_oauth_states s USING sessions a WHERE s.session_hash=a.token_hash AND a.user_id=$1',
        [owner],
      );
      await client.query('DELETE FROM github_connections WHERE owner_id=$1', [owner]);
    });
  }
  private async credential(owner: string) {
    const { api, cipher } = this.configured();
    const row = (
      await this.pool.query('SELECT * FROM github_connections WHERE owner_id=$1', [owner])
    ).rows[0];
    if (!row?.encrypted_token || (row.expires_at && row.expires_at.getTime() <= Date.now())) {
      if (row?.encrypted_token) await this.revoke(owner);
      throw new HttpError(
        409,
        'github_reauthorize',
        'Autoriza de nuevo la GitHub App para continuar.',
      );
    }
    try {
      return {
        api,
        token: cipher.decrypt(row.encrypted_token, owner),
        encrypted: row.encrypted_token as string,
      };
    } catch {
      throw new HttpError(
        503,
        'github_key_changed',
        'No se puede abrir la credencial. Revisa la clave del servidor o vuelve a autorizar GitHub.',
      );
    }
  }
  private async guarded<T>(owner: string, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpError && error.code === 'github_reauthorize')
        await this.revoke(owner);
      throw error;
    }
  }
  async installations(owner: string) {
    const { api, token } = await this.credential(owner);
    return this.guarded(owner, async () => {
      const list = await api.installations(token);
      const connected = (
        await this.pool.query(
          'SELECT installation_id FROM github_installations WHERE owner_id=$1 AND active',
          [owner],
        )
      ).rows.map((row) => Number(row.installation_id));
      return {
        installations: list.map((item) => ({
          id: item.id,
          account: item.account.login,
          connected: connected.includes(item.id),
        })),
      };
    });
  }
  async connect(owner: string, installation: number) {
    const { api, token, encrypted } = await this.credential(owner);
    const found = await this.guarded(owner, async () =>
      (await api.installations(token)).find((item) => item.id === installation),
    );
    if (!found || !readableInstallation(found))
      throw new HttpError(
        403,
        'github_access_denied',
        'Esta instalación no está disponible o le faltan permisos de lectura de Contents, Issues y Pull requests.',
      );
    await this.transaction(async (client) => {
      const current = await client.query(
        'SELECT 1 FROM github_connections WHERE owner_id=$1 AND encrypted_token=$2 FOR SHARE',
        [owner, encrypted],
      );
      if (!current.rowCount) throw changed();
      await client.query(
        `INSERT INTO github_installations (owner_id,installation_id,account) VALUES ($1,$2,$3) ON CONFLICT (owner_id,installation_id) DO UPDATE SET active=true,account=$3`,
        [owner, installation, found.account.login],
      );
      await client.query(
        'UPDATE github_links SET revoked=false,stale=true,generation=generation+1 WHERE owner_id=$1 AND installation_id=$2',
        [owner, installation],
      );
    });
  }
  private async access(owner: string, installation: number): Promise<Access> {
    const credentials = await this.credential(owner);
    const row = await this.pool.query(
      'SELECT 1 FROM github_installations WHERE owner_id=$1 AND installation_id=$2 AND active',
      [owner, installation],
    );
    if (!row.rowCount)
      throw new HttpError(
        409,
        'github_installation',
        'Conecta de nuevo la instalación para continuar.',
      );
    const available = await this.guarded(owner, () =>
      credentials.api.installations(credentials.token),
    );
    const installationRow = available.find((item) => item.id === installation);
    if (!installationRow || !readableInstallation(installationRow)) {
      await this.transaction(async (client) => {
        await client.query(
          'UPDATE github_installations SET active=false WHERE owner_id=$1 AND installation_id=$2',
          [owner, installation],
        );
        await client.query(
          'UPDATE github_links SET revoked=true,stale=true,snapshot=NULL,synced_at=NULL,generation=generation+1 WHERE owner_id=$1 AND installation_id=$2',
          [owner, installation],
        );
      });
      throw new HttpError(
        403,
        'github_access_denied',
        'GitHub ha retirado el acceso o los permisos de lectura de esta instalación.',
      );
    }
    return { ...credentials, owner, installation };
  }
  private async live(client: PoolClient, access: Access) {
    const row = await client.query(
      `SELECT 1 FROM github_connections c JOIN github_installations i ON c.owner_id=i.owner_id WHERE c.owner_id=$1 AND c.encrypted_token=$2 AND (c.expires_at IS NULL OR c.expires_at>now()) AND i.installation_id=$3 AND i.active FOR SHARE OF c,i`,
      [access.owner, access.encrypted, access.installation],
    );
    if (!row.rowCount) throw changed();
  }
  async repositories(owner: string, installation: number, page: number) {
    const access = await this.access(owner, installation);
    return this.guarded(owner, () => access.api.repositories(access.token, installation, page));
  }
  // Server-only capability: never serialize this object or pass it to a worker/repository.
  async publicationAccess(owner: string, project: string, repositoryId: number, branch: string) {
    const row = await this.linked(owner, project);
    if (!row || row.revoked || Number(row.repository_id) !== repositoryId || row.branch !== branch)
      throw changed();
    const access = await this.authorized(owner, row);
    const installations = await access.api.installations(access.token);
    const permissions = installations.find((i) => i.id === access.installation)?.permissions;
    if (permissions?.contents !== 'write' || permissions.pull_requests !== 'write')
      throw new HttpError(
        403,
        'github_write_denied',
        'La App necesita Contents y Pull requests con permiso de escritura.',
      );
    await access.api.requirePush(access.token, access.fullName);
    const check = () =>
      this.transaction(async (db) => {
        await this.writable(db, owner, project);
        await this.live(db, access);
        const current = (
          await db.query(
            'SELECT version,revoked FROM github_links WHERE project_id=$1 AND repository_id=$2 AND branch=$3',
            [project, repositoryId, branch],
          )
        ).rows[0];
        if (!current || current.revoked || current.version !== row.version) throw changed();
      });
    await check();
    return { api: access.api, token: access.token, fullName: access.fullName, check };
  }
  async link(
    owner: string,
    project: string,
    input: {
      installationId: number;
      repositoryId: number;
      branch?: string | undefined;
      version: number;
    },
  ) {
    await this.project(owner, project);
    const access = await this.access(owner, input.installationId);
    const repo = await this.guarded(owner, () =>
      access.api.accessibleRepository(access.token, input.installationId, input.repositoryId),
    );
    return this.transaction(async (client) => {
      await this.writable(client, owner, project);
      await this.live(client, access);
      const old = (
        await client.query('SELECT version FROM github_links WHERE project_id=$1', [project])
      ).rows[0];
      if ((old?.version ?? 0) !== input.version) throw changed();
      const result = await client.query(
        `INSERT INTO github_links (project_id,owner_id,installation_id,repository_id,full_name,branch) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (project_id) DO UPDATE SET installation_id=$3,repository_id=$4,full_name=$5,branch=$6,version=github_links.version+1,generation=github_links.generation+1,stale=true,revoked=false,snapshot=NULL,synced_at=NULL RETURNING *`,
        [
          project,
          owner,
          input.installationId,
          input.repositoryId,
          repo.fullName,
          input.branch || repo.defaultBranch,
        ],
      );
      return { link: dto(result.rows[0]!) };
    });
  }
  async unlink(owner: string, project: string, version: number) {
    await this.transaction(async (client) => {
      await this.writable(client, owner, project);
      const row = await client.query(
        'DELETE FROM github_links WHERE project_id=$1 AND owner_id=$2 AND version=$3',
        [project, owner, version],
      );
      if (!row.rowCount) throw changed();
    });
  }
  private async linked(owner: string, project: string) {
    await this.project(owner, project);
    return (
      await this.pool.query('SELECT * FROM github_links WHERE project_id=$1 AND owner_id=$2', [
        project,
        owner,
      ])
    ).rows[0];
  }
  private async authorized(owner: string, row: QueryResultRow) {
    const access = await this.access(owner, Number(row.installation_id));
    try {
      const repo = await this.guarded(owner, () =>
        access.api.accessibleRepository(
          access.token,
          access.installation,
          Number(row.repository_id),
        ),
      );
      return { ...access, fullName: repo.fullName };
    } catch (error) {
      if (error instanceof HttpError && error.code === 'github_access_denied')
        await this.pool.query(
          'UPDATE github_links SET revoked=true,stale=true,snapshot=NULL,synced_at=NULL,generation=generation+1 WHERE project_id=$1',
          [row.project_id],
        );
      throw error;
    }
  }
  async read(owner: string, project: string) {
    const row = await this.linked(owner, project);
    if (!row) return { link: null };
    if (row.revoked) return { link: dto({ ...row, snapshot: null }) };
    const access = await this.authorized(owner, row);
    // Re-read after remote validation: a webhook may have revoked/invalidated the snapshot.
    return this.transaction(async (client) => {
      await this.live(client, access);
      const current = (
        await client.query('SELECT * FROM github_links WHERE project_id=$1 AND owner_id=$2', [
          project,
          owner,
        ])
      ).rows[0];
      if (current && current.version !== row.version) throw changed();
      return { link: current ? dto(current) : null };
    });
  }
  async contextStamp(owner: string, project: string) {
    const row = await this.linked(owner, project);
    if (!row || row.revoked) throw changed();
    const access = await this.authorized(owner, row);
    const installations = await access.api.installations(access.token);
    const installation = installations.find((i) => i.id === access.installation);
    if (!installation || !readableInstallation(installation))
      throw new HttpError(
        403,
        'github_access_denied',
        'GitHub ha retirado los permisos de lectura.',
      );
    const permissions = installation.permissions;
    await this.transaction((db) => this.live(db, access));
    const permissionHash = createHash('sha256')
      .update(
        JSON.stringify([
          owner,
          tokenHash(access.encrypted),
          access.installation,
          Object.entries(permissions).sort(([a], [b]) => a.localeCompare(b)),
        ]),
      )
      .digest('hex');
    const current = (
      await this.pool.query('SELECT * FROM github_links WHERE project_id=$1 AND owner_id=$2', [
        project,
        owner,
      ])
    ).rows[0];
    if (
      !current ||
      current.revoked ||
      current.version !== row.version ||
      current.generation !== row.generation
    )
      throw changed();
    return { link: dto(current), permissionHash, generation: current.generation as number };
  }
  async sync(owner: string, project: string, version: number) {
    const projectRow = await this.project(owner, project);
    if (projectRow.archived_at)
      throw new HttpError(409, 'project_archived', 'Restaura el proyecto antes de sincronizar.');
    const row = await this.linked(owner, project);
    if (!row) throw absent();
    if (row.version !== version) throw changed();
    const access = await this.authorized(owner, row);
    const snapshot = githubSnapshotSchema.parse(
      await this.guarded(owner, () =>
        access.api.snapshot(access.token, access.fullName, row.branch),
      ),
    );
    if (snapshot.repository.id !== Number(row.repository_id)) throw changed();
    return this.transaction(async (client) => {
      await this.writable(client, owner, project);
      await this.live(client, access);
      const result = await client.query(
        `UPDATE github_links SET snapshot=$4::jsonb,synced_at=now(),full_name=$5,stale=false,revoked=false,version=version+1 WHERE project_id=$1 AND owner_id=$2 AND version=$3 AND generation=$6 RETURNING *`,
        [
          project,
          owner,
          version,
          JSON.stringify(snapshot),
          snapshot.repository.fullName,
          row.generation,
        ],
      );
      if (!result.rows[0]) throw changed();
      return { link: dto(result.rows[0]) };
    });
  }
  async file(owner: string, project: string, path: string, version: number) {
    const row = await this.linked(owner, project);
    if (!row) throw absent();
    if (row.version !== version) throw changed();
    const access = await this.authorized(owner, row);
    if (!row.snapshot || row.revoked || !visiblePath(path)) throw absent();
    const snapshot: GitHubSnapshot = githubSnapshotSchema.parse(row.snapshot);
    const entry = snapshot.tree.find((item) => item.path === path);
    if (!entry || entry.type !== 'blob') throw absent();
    if (!['100644', '100755'].includes(entry.mode) || (entry.size ?? 0) > 1_000_000)
      throw new HttpError(
        415,
        'github_file_unsupported',
        'No se muestran enlaces simbólicos ni archivos de más de 1 MB.',
      );
    const content = await this.guarded(owner, () =>
      access.api.blob(access.token, access.fullName, entry.sha),
    );
    return this.transaction(async (client) => {
      await this.live(client, access);
      const current = (
        await client.query(
          'SELECT version,stale,revoked,snapshot IS NOT NULL AS available FROM github_links WHERE project_id=$1 AND owner_id=$2',
          [project, owner],
        )
      ).rows[0];
      if (!current || current.version !== row.version || current.revoked || !current.available)
        throw changed();
      return {
        path,
        commit: snapshot.commit,
        sha: entry.sha,
        content,
        stale: current.stale as boolean,
      };
    });
  }
}
