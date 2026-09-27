-- Delete the QA test user and its kid from the AI Tutor production project
-- (xlxyfvulqhssxiwctzvy). NOT RUN by the author. Review, then run yourself in
-- the Supabase SQL editor.
--
-- SCOPE — exactly these rows, by UUID, nothing else:
--   parent  ace7c17f-654d-415a-9993-4e81eba95bfd   (auth.users, asaf@ensemble-ai.io, Google)
--   kid     78dc3256-7e5c-49c2-93d4-55b0c5be98a7   (kids, name מאיה, parent = the above)
-- plus that kid's dependent rows and that user's auth rows.
--
-- NEVER touched: the two kids named נועה (885f0024-… and 9f240d61-…), and the
-- orphan kids סופיה (e8b6d85e-…) and דניאל (0751d003-…). Nothing here matches
-- or writes by name; the post-check proves they are unchanged.
--
-- HOW IT IS SAFE
--  1. Every row that will be deleted is first copied, as jsonb, into
--     public.qa_deleted_rows_backup (created if missing, locked down below).
--  2. Backup + deletes are ONE DO block: atomic. Any RAISE EXCEPTION (a failed
--     guard, a count mismatch) rolls back everything, backup included.
--  3. Guards abort before any write if the world is not exactly as resolved:
--     parent id+email match, kid is מאיה and belongs to that parent, the parent
--     owns exactly ONE kid (deleting the auth user cascades to every kid it
--     owns), and the row counts still match what was read on 2026-09-26.
--  4. Order (FK-safe): parent_flags (kid FK is NO ACTION, the trap) ->
--     exercise_attempts -> kid_memory -> subject_profiles -> kids ->
--     auth.refresh_tokens, auth.flow_state (no FK path from users) ->
--     auth.sessions -> auth.identities -> auth.users.
--
-- Expected counts (read-only, 2026-09-26): attempts 8, memory 2, profiles 2,
-- parent_flags 0, kids 1; auth: identities 1, sessions 4, refresh_tokens 15,
-- flow_state 1, users 1. total auth.users 8 before, 7 after.

-- ---------------------------------------------------------------------------
-- 0. BACKUP TABLE. Holds auth rows (tokens, and any password hash), so it is
--    locked: RLS on with no policies, and no access for the API roles. Only
--    the SQL editor / service role can read it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qa_deleted_rows_backup (
  id           uuid        DEFAULT gen_random_uuid(),
  source_table text        NOT NULL,
  row_data     jsonb       NOT NULL,
  deleted_at   timestamptz DEFAULT now()
);
ALTER TABLE public.qa_deleted_rows_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qa_deleted_rows_backup FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. PRE-CHECK (read-only, for the record).
-- ---------------------------------------------------------------------------
SELECT id, email, created_at, last_sign_in_at FROM auth.users WHERE id = 'ace7c17f-654d-415a-9993-4e81eba95bfd';
SELECT id, name, parent_id, grade, gender FROM public.kids WHERE parent_id = 'ace7c17f-654d-415a-9993-4e81eba95bfd';
SELECT id, name, grade, gender, parent_id FROM public.kids WHERE name = 'נועה' ORDER BY created_at;  -- info only: must be 2 rows

-- ---------------------------------------------------------------------------
-- 2. BACKUP + DELETE, atomic.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_parent uuid := 'ace7c17f-654d-415a-9993-4e81eba95bfd';
  v_kid    uuid := '78dc3256-7e5c-49c2-93d4-55b0c5be98a7';
  v_batch  text := 'delete-test-users-2026-09-26';
  n        bigint;
  v_noa_before bigint;
  v_orphans_before bigint;
  c_attempts bigint; c_memory bigint; c_profiles bigint; c_flags bigint;
  c_identities bigint; c_sessions bigint; c_tokens bigint; c_flow bigint;
BEGIN
  -- ---- guards -------------------------------------------------------------
  IF (SELECT count(*) FROM auth.users WHERE id = v_parent AND lower(email) = 'asaf@ensemble-ai.io') <> 1 THEN
    RAISE EXCEPTION 'ABORT: auth user % with email asaf@ensemble-ai.io not found exactly once. Nothing changed.', v_parent;
  END IF;
  IF (SELECT count(*) FROM public.kids WHERE id = v_kid AND name = 'מאיה' AND parent_id = v_parent) <> 1 THEN
    RAISE EXCEPTION 'ABORT: kid % (מאיה, parent %) not found exactly once. Nothing changed.', v_kid, v_parent;
  END IF;
  -- Deleting the auth user CASCADES to every kid it owns: make sure that is only מאיה.
  IF (SELECT count(*) FROM public.kids WHERE parent_id = v_parent) <> 1 THEN
    RAISE EXCEPTION 'ABORT: parent % owns % kids, expected exactly 1 (מאיה). Nothing changed.', v_parent,
      (SELECT count(*) FROM public.kids WHERE parent_id = v_parent);
  END IF;

  SELECT count(*) INTO c_attempts   FROM public.exercise_attempts WHERE kid_id = v_kid;
  SELECT count(*) INTO c_memory     FROM public.kid_memory        WHERE kid_id = v_kid;
  SELECT count(*) INTO c_profiles   FROM public.subject_profiles  WHERE kid_id = v_kid;
  SELECT count(*) INTO c_flags      FROM public.parent_flags      WHERE kid_id = v_kid;
  SELECT count(*) INTO c_identities FROM auth.identities          WHERE user_id = v_parent;
  SELECT count(*) INTO c_sessions   FROM auth.sessions            WHERE user_id = v_parent;
  SELECT count(*) INTO c_tokens     FROM auth.refresh_tokens      WHERE user_id::text = v_parent::text;
  SELECT count(*) INTO c_flow       FROM auth.flow_state          WHERE user_id = v_parent;
  IF (c_attempts, c_memory, c_profiles, c_flags, c_identities, c_sessions, c_tokens, c_flow) IS DISTINCT FROM (8, 2, 2, 0, 1, 4, 15, 1) THEN
    RAISE EXCEPTION 'ABORT: row counts changed since they were read (attempts %, memory %, profiles %, flags %, identities %, sessions %, refresh_tokens %, flow_state %; expected 8,2,2,0,1,4,15,1). Re-resolve before deleting.',
      c_attempts, c_memory, c_profiles, c_flags, c_identities, c_sessions, c_tokens, c_flow;
  END IF;

  SELECT count(*) INTO v_noa_before     FROM public.kids WHERE name = 'נועה';                       -- info: must stay 2
  SELECT count(*) INTO v_orphans_before FROM public.kids WHERE id IN ('e8b6d85e-50d2-4a1c-a8ec-55a11106be85','0751d003-8eac-4f84-abba-19f0b2c4d6eb');  -- must stay 2

  -- ---- backup: every row about to be deleted, first ------------------------
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'auth.users', to_jsonb(u) || jsonb_build_object('_batch', v_batch) FROM auth.users u WHERE u.id = v_parent;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'auth.identities', to_jsonb(i) || jsonb_build_object('_batch', v_batch) FROM auth.identities i WHERE i.user_id = v_parent;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'auth.sessions', to_jsonb(s) || jsonb_build_object('_batch', v_batch) FROM auth.sessions s WHERE s.user_id = v_parent;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'auth.refresh_tokens', to_jsonb(t) || jsonb_build_object('_batch', v_batch) FROM auth.refresh_tokens t WHERE t.user_id::text = v_parent::text;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'auth.flow_state', to_jsonb(f) || jsonb_build_object('_batch', v_batch) FROM auth.flow_state f WHERE f.user_id = v_parent;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'public.kids', to_jsonb(k) || jsonb_build_object('_batch', v_batch) FROM public.kids k WHERE k.id = v_kid;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'public.subject_profiles', to_jsonb(p) || jsonb_build_object('_batch', v_batch) FROM public.subject_profiles p WHERE p.kid_id = v_kid;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'public.kid_memory', to_jsonb(m) || jsonb_build_object('_batch', v_batch) FROM public.kid_memory m WHERE m.kid_id = v_kid;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'public.exercise_attempts', to_jsonb(a) || jsonb_build_object('_batch', v_batch) FROM public.exercise_attempts a WHERE a.kid_id = v_kid;
  INSERT INTO public.qa_deleted_rows_backup (source_table, row_data)
  SELECT 'public.parent_flags', to_jsonb(pf) || jsonb_build_object('_batch', v_batch) FROM public.parent_flags pf WHERE pf.kid_id = v_kid;

  SELECT count(*) INTO n FROM public.qa_deleted_rows_backup WHERE row_data->>'_batch' = v_batch;
  IF n <> 1 + 1 + 4 + 15 + 1 + 1 + 2 + 2 + 8 + 0 THEN   -- users, identity, sessions, tokens, flow, kid, profiles, memory, attempts, flags
    RAISE EXCEPTION 'ABORT: backup holds % rows, expected 35. Rolling back.', n;
  END IF;
  RAISE NOTICE 'backed up % rows (batch %)', n, v_batch;

  -- ---- deletes, FK-safe: kid side first, then the parent -------------------
  DELETE FROM public.parent_flags       WHERE kid_id = v_kid;  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'parent_flags:       %', n;
  DELETE FROM public.exercise_attempts  WHERE kid_id = v_kid;  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'exercise_attempts:  %', n;
  DELETE FROM public.kid_memory         WHERE kid_id = v_kid;  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'kid_memory:         %', n;
  DELETE FROM public.subject_profiles   WHERE kid_id = v_kid;  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'subject_profiles:   %', n;
  DELETE FROM public.kids               WHERE id = v_kid;      GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'kids:               %', n;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORT: expected to delete exactly 1 kid, deleted %. Rolling back.', n; END IF;

  DELETE FROM auth.refresh_tokens WHERE user_id::text = v_parent::text; GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'auth.refresh_tokens: %', n;
  DELETE FROM auth.flow_state     WHERE user_id = v_parent;             GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'auth.flow_state:     %', n;
  DELETE FROM auth.sessions       WHERE user_id = v_parent;             GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'auth.sessions:       %', n;
  DELETE FROM auth.identities     WHERE user_id = v_parent;             GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'auth.identities:     %', n;
  DELETE FROM auth.users          WHERE id = v_parent;                  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'auth.users:          %', n;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORT: expected to delete exactly 1 auth user, deleted %. Rolling back.', n; END IF;

  -- ---- in-transaction proof the bystanders are untouched --------------------
  IF (SELECT count(*) FROM public.kids WHERE name = 'נועה') <> v_noa_before OR v_noa_before <> 2 THEN
    RAISE EXCEPTION 'ABORT: the number of kids named נועה changed (% before). Rolling back.', v_noa_before;
  END IF;
  IF (SELECT count(*) FROM public.kids WHERE id IN ('e8b6d85e-50d2-4a1c-a8ec-55a11106be85','0751d003-8eac-4f84-abba-19f0b2c4d6eb')) <> v_orphans_before THEN
    RAISE EXCEPTION 'ABORT: an orphan kid (סופיה / דניאל) was affected. Rolling back.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. POST-CHECKS (read-only).
-- ---------------------------------------------------------------------------
-- Targets are gone: every count must be 0.
SELECT
  (SELECT count(*) FROM auth.users WHERE id = 'ace7c17f-654d-415a-9993-4e81eba95bfd')                     AS auth_user,
  (SELECT count(*) FROM public.kids WHERE id = '78dc3256-7e5c-49c2-93d4-55b0c5be98a7')                    AS kid_maya,
  (SELECT count(*) FROM auth.identities WHERE user_id = 'ace7c17f-654d-415a-9993-4e81eba95bfd')           AS identities,
  (SELECT count(*) FROM auth.sessions WHERE user_id = 'ace7c17f-654d-415a-9993-4e81eba95bfd')             AS sessions,
  (SELECT count(*) FROM auth.refresh_tokens WHERE user_id::text = 'ace7c17f-654d-415a-9993-4e81eba95bfd') AS refresh_tokens,
  (SELECT count(*) FROM public.exercise_attempts WHERE kid_id = '78dc3256-7e5c-49c2-93d4-55b0c5be98a7')   AS attempts,
  (SELECT count(*) FROM public.kid_memory WHERE kid_id = '78dc3256-7e5c-49c2-93d4-55b0c5be98a7')          AS memory,
  (SELECT count(*) FROM public.subject_profiles WHERE kid_id = '78dc3256-7e5c-49c2-93d4-55b0c5be98a7')    AS profiles;

-- Bystanders untouched: both נועה rows (still 2, same ids/grades/parents), and both orphans.
SELECT id, name, grade, gender, parent_id FROM public.kids WHERE name = 'נועה' ORDER BY created_at;
SELECT id, name, parent_id FROM public.kids WHERE id IN ('e8b6d85e-50d2-4a1c-a8ec-55a11106be85','0751d003-8eac-4f84-abba-19f0b2c4d6eb');
SELECT count(*) AS total_auth_users_should_be_7 FROM auth.users;
SELECT source_table, count(*) FROM public.qa_deleted_rows_backup WHERE row_data->>'_batch' = 'delete-test-users-2026-09-26' GROUP BY 1 ORDER BY 1;

-- ---------------------------------------------------------------------------
-- 4. ROLLBACK — commented, ready. Restores the user, identity, kid and the
--    kid's rows from the backup. It does NOT restore sessions, refresh tokens
--    or flow_state (stale by then; the user signs in again). Generated
--    columns (auth.users.confirmed_at, auth.identities.email) are skipped
--    automatically. Order matters: users -> identities -> kids -> children.
-- ---------------------------------------------------------------------------
-- DO $$
-- DECLARE t text; cols text; rcols text;
--   ord text[] := ARRAY['auth.users','auth.identities','public.kids','public.subject_profiles','public.kid_memory','public.exercise_attempts','public.parent_flags'];
-- BEGIN
--   FOREACH t IN ARRAY ord LOOP
--     SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position),
--            string_agg('r.' || quote_ident(column_name), ',' ORDER BY ordinal_position)
--       INTO cols, rcols
--       FROM information_schema.columns
--      WHERE table_schema = split_part(t, '.', 1) AND table_name = split_part(t, '.', 2) AND is_generated = 'NEVER';
--     EXECUTE format(
--       'INSERT INTO %s (%s) SELECT %s FROM public.qa_deleted_rows_backup b, jsonb_populate_record(NULL::%s, b.row_data) r WHERE b.source_table = %L AND b.row_data->>''_batch'' = ''delete-test-users-2026-09-26''',
--       t, cols, rcols, t, t);
--   END LOOP;
-- END $$;
