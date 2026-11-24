import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../../http-error.js';

export async function assertTaskReady(
  db: Pool | PoolClient,
  project: string,
  task: string,
  options: {
    templateId?: string | undefined;
    templateVersion?: number | undefined;
    checkClaim?: boolean;
  } = {},
) {
  const rows = (
    await db.query(
      `WITH RECURSIVE edges(src,dst) AS (
    SELECT task_id,dependency_id FROM task_dependencies WHERE project_id=$1
    UNION SELECT parent_epic_id,task_id FROM task_coordination WHERE project_id=$1 AND parent_epic_id IS NOT NULL
  ), required(id) AS (SELECT $2::uuid UNION SELECT e.dst FROM edges e JOIN required r ON e.src=r.id)
  SELECT t.id,t.status,c.blocker,c.claimed_template_id,c.claimed_template_version FROM required r
  JOIN tasks t ON t.id=r.id AND t.project_id=$1 LEFT JOIN task_coordination c ON c.task_id=t.id`,
      [project, task],
    )
  ).rows;
  const current = rows.find((r) => r.id === task);
  if (!current) throw new HttpError(404, 'not_found', 'No se ha encontrado la tarea.');
  if (current.blocker || rows.some((r) => r.id !== task && (r.status !== 'done' || r.blocker)))
    throw new HttpError(
      409,
      'task_blocked',
      'Resuelve los bloqueos y completa las dependencias antes de avanzar.',
    );
  if (
    options.checkClaim !== false &&
    current.claimed_template_id &&
    (current.claimed_template_id !== options.templateId ||
      current.claimed_template_version !== options.templateVersion)
  )
    throw new HttpError(
      409,
      'task_claimed',
      'La tarea está reclamada por otra versión de equipo. Revisa su asignación.',
    );
}
