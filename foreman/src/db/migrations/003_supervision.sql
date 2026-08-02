-- The COO does work that is not a task.
--
-- Reviewing what is finished, planning a goal that has no work under it, and
-- unblocking what it can are all real runs — they cost money and they can go
-- wrong — but none of them belongs to a task row. Making the link optional is
-- what lets supervision be observable on the same screens as everything else,
-- rather than happening invisibly inside a tick.
ALTER TABLE run ALTER COLUMN task_id DROP NOT NULL;

-- Runs with no task are the ones the dashboard would otherwise lose.
CREATE INDEX run_untasked ON run (started_at DESC) WHERE task_id IS NULL;
