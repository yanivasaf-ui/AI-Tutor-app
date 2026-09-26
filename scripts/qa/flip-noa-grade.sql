-- Flip the QA kid נועה (live QA row) from grade NULL to 'ב'.
-- NOT RUN by the author. Review, then run yourself in the Supabase SQL editor
-- (project xlxyfvulqhssxiwctzvy).
--
-- Targets ONE row by UUID: 9f240d61-56d1-415d-8719-ea9e6293477b.
-- There are two kids named נועה; the other one (id starts 885f0024) must
-- never be touched, so nothing in this script writes by name.
--
-- The whole write is ONE DO block, so it is atomic: any RAISE EXCEPTION
-- (failed pre-check, 0 rows updated, failed post-check) rolls everything back.
--
-- Guard: the row must currently have grade NULL. If it already has a grade
-- (e.g. 'ב' from an earlier flip), the script ABORTS and changes nothing —
-- run the rollback at the bottom first if you really want to redo the flip.

-- (a) PRE-CHECK, shown for the record: must be exactly 1 row, name 'נועה', grade NULL.
SELECT id, name, grade, parent_id FROM kids WHERE id = '9f240d61-56d1-415d-8719-ea9e6293477b';

-- (b) INFO ONLY (never used in a WHERE for writes): how many kids are named נועה.
SELECT count(*) FROM kids WHERE name = 'נועה';

DO $$
DECLARE
  v_id    uuid := '9f240d61-56d1-415d-8719-ea9e6293477b';
  v_name  text;
  v_grade text;
  n       bigint;
BEGIN
  -- (a) pre-check, enforced: exactly one row, named נועה, grade NULL.
  SELECT count(*) INTO n FROM kids WHERE id = v_id;
  IF n <> 1 THEN
    RAISE EXCEPTION 'ABORT: expected exactly 1 kids row for %, found %. Nothing changed.', v_id, n;
  END IF;
  SELECT name, grade INTO v_name, v_grade FROM kids WHERE id = v_id;
  IF v_name IS DISTINCT FROM 'נועה' THEN
    RAISE EXCEPTION 'ABORT: row % is named %, expected נועה. Nothing changed.', v_id, v_name;
  END IF;
  IF v_grade IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: row % already has grade %, expected NULL. Nothing changed.', v_id, v_grade;
  END IF;

  -- (c) the update: by UUID, and only while grade is still NULL.
  UPDATE kids SET grade = 'ב' WHERE id = v_id AND grade IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'kids updated: %', n;
  IF n <> 1 THEN
    RAISE EXCEPTION 'ABORT: expected to update exactly 1 row, updated %. Rolling back.', n;
  END IF;

  -- (d) post-check, enforced inside the same transaction.
  SELECT grade INTO v_grade FROM kids WHERE id = v_id;
  IF v_grade IS DISTINCT FROM 'ב' THEN
    RAISE EXCEPTION 'ABORT: post-check found grade %, expected ב. Rolling back.', v_grade;
  END IF;
END $$;

-- (d) POST-CHECK, shown for the record: grade must now be 'ב'.
SELECT id, name, grade, parent_id FROM kids WHERE id = '9f240d61-56d1-415d-8719-ea9e6293477b';

-- (e) ROLLBACK — commented, ready. Restores the original value (NULL).
-- UPDATE kids SET grade = NULL WHERE id = '9f240d61-56d1-415d-8719-ea9e6293477b';
