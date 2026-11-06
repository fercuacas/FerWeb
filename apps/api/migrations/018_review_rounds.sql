ALTER TABLE team_execution_steps ADD COLUMN iteration integer NOT NULL DEFAULT 1 CHECK(iteration BETWEEN 1 AND 2);
ALTER TABLE team_execution_steps DROP CONSTRAINT team_execution_steps_position_check;
ALTER TABLE team_execution_steps ADD CONSTRAINT team_execution_steps_position_check CHECK(position BETWEEN 1 AND 8);
