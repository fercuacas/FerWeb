import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import {
  sendTeamMessageInput,
  teamMessage,
  teamMessagesResponse,
  type teamMessageKind,
} from '@ferweb/contracts';
import type { CodingService } from '../jobs/coding-service.js';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { HttpError } from '../../http-error.js';

const denied = (code: string) =>
  new HttpError(
    409,
    code,
    'El mensaje no pertenece a una generación, destinatario o cuota vigente.',
  );
const dto = (row: QueryResultRow) =>
  teamMessage.parse({
    id: row.id,
    sequence: row.sequence,
    kind: row.kind,
    text: row.text,
    sender: row.sender,
    senderStepId: row.sender_step_id,
    senderJobId: row.sender_job_id,
    to: row.recipient_step_id,
    replyTo: row.reply_to,
    verified: row.verified,
    createdAt: row.created_at.toISOString(),
  });
export async function systemTeamMessage(
  db: PoolClient,
  execution: string,
  step: string | null,
  to: string | null,
  kind: z.infer<typeof teamMessageKind>,
  text: string,
  verified: boolean,
) {
  const count = (
    await db.query(
      "SELECT count(*)::int AS n FROM team_messages WHERE execution_id=$1 AND sender='coordinator'",
      [execution],
    )
  ).rows[0].n;
  if (count >= 20) throw denied('team_system_message_limit');
  const sequence = (
    await db.query(
      'UPDATE team_executions SET message_sequence=message_sequence+1 WHERE id=$1 RETURNING message_sequence',
      [execution],
    )
  ).rows[0].message_sequence;
  await db.query(
    "INSERT INTO team_messages(execution_id,sequence,request_id,sender,sender_step_id,recipient_step_id,kind,text,verified,payload_hash) VALUES($1,$2,$3,'coordinator',$4,$5,$6,$7,$8,$9)",
    [
      execution,
      sequence,
      randomUUID(),
      step,
      to,
      kind,
      text.slice(0, 2000),
      verified,
      digest(text),
    ],
  );
}
export class TeamMessages {
  constructor(
    private readonly pool: Pool,
    private readonly coding: CodingService,
  ) {}
  private async actor(db: PoolClient, id: string, fence: string) {
    const row = (
      await db.query(
        `SELECT s.id AS step_id,s.execution_id,r.cancel_requested,r.state AS parent_state,j.project_id
      FROM jobs j JOIN team_execution_steps s ON s.job_id=j.id JOIN team_executions r ON r.id=s.execution_id JOIN projects p ON p.id=j.project_id
      WHERE j.id=$1 AND j.fence=$2 AND j.state='running' AND j.lease_until>clock_timestamp() AND j.deadline_at>clock_timestamp()
      AND NOT j.cancel_requested AND p.archived_at IS NULL AND r.snapshot->'plan'->'template'->'definition'->>'strategy'='specialists'
      AND j.configuration->>'workspaceAccess'='read-only' FOR UPDATE OF j`,
        [id, fence],
      )
    ).rows[0];
    if (!row || row.cancel_requested || row.parent_state !== 'running')
      throw denied('team_message_generation');
    const parent = (
      await db.query('SELECT * FROM team_executions WHERE id=$1 FOR UPDATE', [row.execution_id])
    ).rows[0];
    if (parent.cancel_requested || parent.state !== 'running')
      throw denied('team_message_generation');
    return row;
  }
  async send(id: string, fence: string, input: z.infer<typeof sendTeamMessageInput>) {
    await this.coding.executionInput(id, fence, true);
    return this.coding.jobs.queue.tx(async (db) => {
      const actor = await this.actor(db, id, fence);
      const hash = digest(canonical({ actor: id, ...input }));
      const prior = (
        await db.query('SELECT * FROM team_messages WHERE execution_id=$1 AND request_id=$2', [
          actor.execution_id,
          input.requestId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.payload_hash !== hash) throw denied('team_message_conflict');
        return { message: dto(prior), repeated: true };
      }
      if (input.to) {
        const target = await db.query(
          'SELECT 1 FROM team_execution_steps WHERE id=$1 AND execution_id=$2',
          [input.to, actor.execution_id],
        );
        if (!target.rowCount || input.to === actor.step_id) throw denied('team_message_recipient');
      }
      if (input.replyTo) {
        const query = (
          await db.query('SELECT * FROM team_messages WHERE id=$1 AND execution_id=$2', [
            input.replyTo,
            actor.execution_id,
          ])
        ).rows[0];
        if (
          !query ||
          query.recipient_step_id !== actor.step_id ||
          (input.kind === 'response' &&
            (query.kind !== 'query' || input.to !== query.sender_step_id))
        )
          throw denied('team_message_reply');
      }
      const counts = (
        await db.query(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE sender_job_id=$2)::int AS own FROM team_messages WHERE execution_id=$1 AND sender='agent'",
          [actor.execution_id, id],
        )
      ).rows[0];
      if (counts.total >= 80 || counts.own >= 16) throw denied('team_message_quota');
      const sequence = (
        await db.query(
          'UPDATE team_executions SET message_sequence=message_sequence+1 WHERE id=$1 RETURNING message_sequence',
          [actor.execution_id],
        )
      ).rows[0].message_sequence;
      const row = (
        await db.query(
          "INSERT INTO team_messages(execution_id,sequence,request_id,sender,sender_step_id,sender_job_id,recipient_step_id,kind,text,reply_to,payload_hash) VALUES($1,$2,$3,'agent',$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            actor.execution_id,
            sequence,
            input.requestId,
            actor.step_id,
            id,
            input.to,
            input.kind,
            input.text,
            input.replyTo ?? null,
            hash,
          ],
        )
      ).rows[0];
      return { message: dto(row), repeated: false };
    });
  }
  private async page(db: Pool | PoolClient, execution: string, after: number, step?: string) {
    const rows = (
      await db.query(
        `SELECT * FROM team_messages WHERE execution_id=$1 AND sequence>$2 ${step ? 'AND (recipient_step_id=$3 OR sender_step_id=$3)' : ''} ORDER BY sequence LIMIT 51`,
        step ? [execution, after, step] : [execution, after],
      )
    ).rows;
    const selected = rows.slice(0, 50);
    return teamMessagesResponse.parse({
      messages: selected.map(dto),
      nextCursor: selected.at(-1)?.sequence ?? after,
      hasMore: rows.length > 50,
    });
  }
  async inbox(id: string, fence: string, after: number) {
    await this.coding.executionInput(id, fence, true);
    return this.coding.jobs.queue.tx(async (db) => {
      const actor = await this.actor(db, id, fence);
      return this.page(db, actor.execution_id, after, actor.step_id);
    });
  }
  async read(owner: string, project: string, execution: string, after: number) {
    await this.coding.projects.get(owner, project);
    const row = (
      await this.pool.query(
        'SELECT repository_id,snapshot FROM team_executions WHERE id=$1 AND project_id=$2',
        [execution, project],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'not_found', 'No se ha encontrado la ejecución.');
    if (row.snapshot.plan.memory?.length)
      await this.coding.memory.selections(owner, project, row.snapshot.plan.memory, 'history');
    for (const item of row.snapshot.plan.contexts ?? [])
      await this.coding.contextPacks!.read(owner, project, item.receipt.id);
    const contextRows = (
      await this.pool.query(
        'SELECT c.context_receipt_id FROM team_execution_steps s JOIN coding_runs c ON c.job_id=s.job_id WHERE s.execution_id=$1 AND c.context_receipt_id IS NOT NULL',
        [execution],
      )
    ).rows;
    for (const item of contextRows)
      await this.coding.contextPacks!.read(owner, project, item.context_receipt_id);
    const { link } = await this.coding.github.read(owner, project);
    if (!link || link.revoked || link.repositoryId !== Number(row.repository_id))
      throw new HttpError(
        403,
        'team_source_denied',
        'No se puede confirmar el acceso a los mensajes.',
      );
    return this.page(this.pool, execution, after);
  }
}
