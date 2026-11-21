
-- ==============================================================================
-- ENGAGEFLOW AI — PHASE 4.2 WEBHOOK PROCESSING REGRESSION SUITE
-- File: supabase/tests/webhook_processing_test.sql
-- Description:
--   Verifies atomic claiming, lease expiry, bounded retries, retry backoff,
--   account-aware outcomes and the service-role guard.
--
-- Run ONLY against a disposable or local Supabase-compatible database:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this_file
--
-- Safety:
--   Everything runs inside one transaction and rolls back.
--   NEVER run this test against production.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
    v_owner UUID := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    v_owner2 UUID := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    v_account UUID := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    v_account2 UUID := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    v_event UUID := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    v_event2 UUID := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    v_event3 UUID := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_event4 UUID := '11111111-1111-4111-8111-111111111111';
    v_event5 UUID := '22222222-2222-4222-8222-222222222222';

    v_payload JSONB :=
        '{"object":"instagram","entry":{"id":"17841400000000042","time":1793319200,"change":{"field":"comments","value":{"id":"18000000000000042","text":"price","media":{"id":"17900000000000042"}}}}}'::JSONB;

    v_claim RECORD;
    v_count INTEGER;
    v_account_id UUID;
    v_status TEXT;
    v_outcome TEXT;
    v_next TIMESTAMPTZ;
    v_passed BOOLEAN;
    v_token TEXT;

BEGIN
    -- Use postgres for test setup.
    PERFORM pg_catalog.set_config('role', 'postgres', true);

    -- ------------------------------------------------------------------
    -- TEST SETUP: create synthetic users and accounts.
    -- Only v_event is inserted now so that TESTS B–H operate on a
    -- single event.  v_event2/v_event3 are inserted later (before
    -- TEST I) and v_event4/v_event5 before TESTS S/T.  This makes
    -- claiming deterministic regardless of UUID ordering.
    -- ------------------------------------------------------------------

    INSERT INTO auth.users (id, email)
    VALUES
        (v_owner, 'phase42-processor@test.invalid'),
        (v_owner2, 'phase42-processor-2@test.invalid')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.instagram_accounts (
        id,
        owner_id,
        instagram_business_id,
        username,
        connection_status
    )
    VALUES
        (
            v_account,
            v_owner,
            '17841400000000042',
            'phase42',
            'CONNECTED'
        ),
        (
            v_account2,
            v_owner2,
            '17841400000000043',
            'phase42-disconnected',
            'DISCONNECTED'
        );

    INSERT INTO public.webhook_events (
        id,
        external_event_id,
        event_type,
        event_payload
    )
    VALUES
        (
            v_event,
            '17841400000000042:18000000000000042',
            'change:comments',
            v_payload
        );

    -- ------------------------------------------------------------------
    -- TEST A: authenticated users cannot claim webhook events.
    -- ------------------------------------------------------------------

    PERFORM pg_catalog.set_config('role', 'authenticated', true);

    PERFORM pg_catalog.set_config(
        'request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_owner),
        true
    );

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.claim_instagram_webhook_events(1, 60);

    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST A FAILED: authenticated role claimed a webhook event.';
    END IF;

    RAISE NOTICE
        'TEST A PASSED: authenticated cannot claim webhook events.';

    -- ------------------------------------------------------------------
    -- TEST B: service_role works without JWT claims.
    -- This simulates the opaque Supabase secret-key SET ROLE path.
    -- ------------------------------------------------------------------

    PERFORM pg_catalog.set_config('role', 'service_role', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);

    SELECT *
    INTO v_claim
    FROM public.claim_instagram_webhook_events(1, 60);

    IF v_claim.event_id IS NULL THEN
        RAISE EXCEPTION
            'TEST B FAILED: service_role session was rejected.';
    END IF;

    IF v_claim.attempts <> 1 THEN
        RAISE EXCEPTION
            'TEST B FAILED: attempts should be 1, got %.',
            v_claim.attempts;
    END IF;

    RAISE NOTICE
        'TEST B PASSED: service_role claims events without JWT claims.';

    -- ------------------------------------------------------------------
    -- TEST C: authenticated users cannot call the finish RPC.
    -- ------------------------------------------------------------------

    PERFORM pg_catalog.set_config('role', 'authenticated', true);

    PERFORM pg_catalog.set_config(
        'request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', v_owner),
        true
    );

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event,
            v_claim.claim_token,
            'NO_MATCH',
            v_account,
            '{}'::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST C FAILED: authenticated role finalized a webhook event.';
    END IF;

    RAISE NOTICE
        'TEST C PASSED: authenticated cannot finalize webhook events.';

    -- ------------------------------------------------------------------
    -- TEST D: a live lease prevents a second worker from claiming.
    -- v_event was claimed in TEST B and is PROCESSING with an active
    -- 60-second lease.  No other events exist yet, so a second claim
    -- attempt must return zero rows.
    -- ------------------------------------------------------------------

    PERFORM pg_catalog.set_config('role', 'service_role', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);

    SELECT pg_catalog.count(*)
    INTO v_count
    FROM public.claim_instagram_webhook_events(1, 60);

    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'TEST D FAILED: a leased event was claimed twice.';
    END IF;

    RAISE NOTICE
        'TEST D PASSED: an active lease is not re-claimed.';

    -- ------------------------------------------------------------------
    -- TEST E: finalizing with the wrong claim token is rejected.
    -- ------------------------------------------------------------------

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event,
            extensions.gen_random_uuid(),
            'NO_MATCH',
            v_account,
            '{}'::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '40001' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST E FAILED: a stale claim token finalized an event.';
    END IF;

    RAISE NOTICE
        'TEST E PASSED: WEBHOOK_CLAIM_LOST protects finalization.';

    -- ------------------------------------------------------------------
    -- TEST F: retryable failure returns event to PENDING with backoff.
    -- v_claim.claim_token belongs to v_event (claimed in TEST B), so
    -- the finish call uses the correct token.
    -- ------------------------------------------------------------------

    PERFORM 1
    FROM public.finish_instagram_webhook_event(
        v_event,
        v_claim.claim_token,
        'RETRYABLE_FAILURE',
        v_account,
        '{}'::UUID[],
        'PROCESSING_FAILED'
    );

    SELECT
        processing_status,
        next_attempt_at
    INTO
        v_status,
        v_next
    FROM public.webhook_events
    WHERE id = v_event;

    IF v_status <> 'PENDING'
       OR v_next IS NULL
       OR v_next <= pg_catalog.clock_timestamp()
    THEN
        RAISE EXCEPTION
            'TEST F FAILED: expected PENDING with a future retry, got % / %.',
            v_status,
            v_next;
    END IF;

    RAISE NOTICE
        'TEST F PASSED: retryable failures are scheduled with backoff.';

    -- ------------------------------------------------------------------
    -- TEST G: backoff is respected by the claim query.
    -- v_event is PENDING with a future next_attempt_at, so no event
    -- is claimable.
    -- ------------------------------------------------------------------

    SELECT pg_catalog.count(*)
    INTO v_count
    FROM public.claim_instagram_webhook_events(1, 60);

    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'TEST G FAILED: a backed-off event was claimed immediately.';
    END IF;

    -- Move retry time into the past to simulate elapsed backoff.
    UPDATE public.webhook_events
    SET next_attempt_at =
        pg_catalog.clock_timestamp() - INTERVAL '1 second'
    WHERE id = v_event;

    RAISE NOTICE
        'TEST G PASSED: backoff delays the next claim.';

    -- ------------------------------------------------------------------
    -- TEST H: exhausted attempts are finalized, never claimed again.
    -- Claim v_event (now that backoff has elapsed), then simulate an
    -- event that has reached the five-attempt limit and verify the
    -- claim function finalizes it as TERMINAL_FAILURE instead of
    -- handing it to a worker.
    -- ------------------------------------------------------------------

    SELECT *
    INTO v_claim
    FROM public.claim_instagram_webhook_events(1, 60);

    IF v_claim.event_id IS NULL THEN
        RAISE EXCEPTION
            'TEST H FAILED: due event was not claimed after backoff elapsed.';
    END IF;

    -- Simulate an event that has reached the five-attempt limit.
    UPDATE public.webhook_events
    SET
        attempts = 5,
        claim_expires_at =
            pg_catalog.clock_timestamp() - INTERVAL '1 second'
    WHERE id = v_event;

    SELECT pg_catalog.count(*)
    INTO v_count
    FROM public.claim_instagram_webhook_events(1, 60);

    SELECT
        processing_status,
        processing_outcome
    INTO
        v_status,
        v_outcome
    FROM public.webhook_events
    WHERE id = v_event;

    IF v_count <> 0
       OR v_status <> 'FAILED'
       OR v_outcome <> 'TERMINAL_FAILURE'
    THEN
        RAISE EXCEPTION
            'TEST H FAILED: expected exhausted event finalized, got % claimed, % / %.',
            v_count,
            v_status,
            v_outcome;
    END IF;

    RAISE NOTICE
        'TEST H PASSED: retries are bounded at five attempts.';

    -- ------------------------------------------------------------------
    -- Insert v_event2 and v_event3 for the remaining tests.
    -- v_event2 has an earlier received_at so the claim function
    -- (which orders by received_at, id) returns it first.
    -- ------------------------------------------------------------------

    INSERT INTO public.webhook_events (
        id,
        external_event_id,
        event_type,
        event_payload,
        received_at
    )
    VALUES
        (
            v_event2,
            '17841400000000042:18000000000000043',
            'change:comments',
            v_payload,
            pg_catalog.now() - INTERVAL '10 seconds'
        ),
        (
            v_event3,
            '17841400000000043:18000000000000044',
            'change:comments',
            v_payload,
            pg_catalog.now() - INTERVAL '5 seconds'
        );

    -- ------------------------------------------------------------------
    -- TEST I: IGNORED may retain disconnected account ID.
    -- Actionable outcomes must reject disconnected accounts.
    -- Claims v_event2 (earlier received_at), then verifies that
    -- NO_MATCH rejects a disconnected account while IGNORED accepts it.
    -- ------------------------------------------------------------------

    UPDATE public.instagram_accounts
    SET connection_status = 'DISCONNECTED'
    WHERE id = v_account;

    SELECT *
    INTO v_claim
    FROM public.claim_instagram_webhook_events(1, 60);

    IF v_claim.event_id IS NULL THEN
        RAISE EXCEPTION
            'TEST I FAILED: replacement event was not claimed.';
    END IF;

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_claim.event_id,
            v_claim.claim_token,
            'NO_MATCH',
            v_account,
            '{}'::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST I FAILED: NO_MATCH accepted a disconnected account.';
    END IF;

    -- IGNORED is allowed to retain the disconnected account reference.
    PERFORM 1
    FROM public.finish_instagram_webhook_event(
        v_claim.event_id,
        v_claim.claim_token,
        'IGNORED',
        v_account,
        '{}'::UUID[],
        'ACCOUNT_NOT_CONNECTED'
    );

    SELECT
        processing_status,
        processing_outcome,
        instagram_account_id
    INTO
        v_status,
        v_outcome,
        v_account_id
    FROM public.webhook_events
    WHERE id = v_claim.event_id;

    IF v_status <> 'IGNORED'
       OR v_outcome <> 'IGNORED'
       OR v_account_id IS DISTINCT FROM v_account
    THEN
        RAISE EXCEPTION
            'TEST I FAILED: unexpected IGNORED result (%, %, %).',
            v_status,
            v_outcome,
            v_account_id;
    END IF;

    RAISE NOTICE
        'TEST I PASSED: IGNORED retains a disconnected account; actionable outcomes do not.';

    -- Restore v_account to CONNECTED for the valid MATCHED/NO_MATCH tests.
    UPDATE public.instagram_accounts
    SET connection_status = 'CONNECTED'
    WHERE id = v_account;

    -- ------------------------------------------------------------------
    -- TEST J: readiness and lifecycle safeguards remain untouched.
    -- ------------------------------------------------------------------

    -- Switch to postgres for read-only verification.
    -- service_role intentionally has no direct table privileges here.
    PERFORM pg_catalog.set_config('role', 'postgres', true);

    SELECT webhook_verified
    INTO v_passed
    FROM public.automation_runtime_readiness
    WHERE singleton = TRUE;

    IF COALESCE(v_passed, FALSE) THEN
        RAISE EXCEPTION
            'TEST J FAILED: processing must not mark runtime readiness.';
    END IF;

    RAISE NOTICE
        'TEST J PASSED: runtime readiness remains unverified.';

    -- ------------------------------------------------------------------
    -- Claim v_event3 (the only PENDING event) for the parameter-
    -- validation and account-mapping tests below.  v_claim now holds
    -- v_event3's claim token, and v_event3 is PROCESSING.
    -- ------------------------------------------------------------------

    PERFORM pg_catalog.set_config('role', 'service_role', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);

    SELECT *
    INTO v_claim
    FROM public.claim_instagram_webhook_events(1, 60);

    IF v_claim.event_id IS NULL THEN
        RAISE EXCEPTION
            'TEST K SETUP FAILED: v_event3 was not claimed.';
    END IF;

    -- ------------------------------------------------------------------
    -- TEST K: outcome validation rejects NULL and unsupported outcomes.
    -- These checks fire before the claim lookup, so the event state
    -- does not affect the result.
    -- ------------------------------------------------------------------

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            NULL,
            v_account,
            '{}'::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST K FAILED: NULL outcome was accepted.';
    END IF;

    RAISE NOTICE
        'TEST K PASSED: NULL outcome is rejected.';

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'UNKNOWN_OUTCOME',
            v_account,
            '{}'::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST K FAILED: unsupported outcome was accepted.';
    END IF;

    RAISE NOTICE
        'TEST K PASSED: unsupported outcome is rejected.';

    -- ------------------------------------------------------------------
    -- TEST M: MATCHED and NO_MATCH must include a non-NULL account.
    -- These checks fire after the claim lookup, so v_event3 must be
    -- PROCESSING with v_claim's token (which it is from the claim above).
    -- ------------------------------------------------------------------

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'MATCHED',
            NULL,
            ARRAY[v_account]::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST M FAILED: MATCHED accepted a NULL account.';
    END IF;

    RAISE NOTICE
        'TEST M PASSED: MATCHED requires an account.';

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'NO_MATCH',
            NULL,
            '{}'::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST M FAILED: NO_MATCH accepted a NULL account.';
    END IF;

    RAISE NOTICE
        'TEST M PASSED: NO_MATCH requires an account.';

    -- ------------------------------------------------------------------
    -- TEST N: MATCHED must include at least one automation ID.
    -- ------------------------------------------------------------------

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'MATCHED',
            v_account,
            '{}'::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST N FAILED: MATCHED accepted an empty matched automation array.';
    END IF;

    RAISE NOTICE
        'TEST N PASSED: MATCHED requires at least one automation.';

    -- ------------------------------------------------------------------
    -- TEST O: non-MATCHED outcomes must include an empty automation array.
    -- ------------------------------------------------------------------

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'NO_MATCH',
            v_account,
            ARRAY[v_account]::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST O FAILED: NO_MATCH accepted a non-empty matched automation array.';
    END IF;

    RAISE NOTICE
        'TEST O PASSED: non-MATCHED outcomes require an empty array.';

    -- ------------------------------------------------------------------
    -- TEST P: UUID[] containing NULL is rejected.
    -- ------------------------------------------------------------------

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'MATCHED',
            v_account,
            ARRAY[v_account, NULL]::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST P FAILED: NULL UUID array element was accepted.';
    END IF;

    RAISE NOTICE
        'TEST P PASSED: NULL UUID array element is rejected.';

    -- ------------------------------------------------------------------
    -- TEST Q: duplicate UUID array entries are rejected.
    -- ------------------------------------------------------------------

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'MATCHED',
            v_account,
            ARRAY[v_account, v_account]::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST Q FAILED: duplicate automation IDs were accepted.';
    END IF;

    RAISE NOTICE
        'TEST Q PASSED: duplicate automation IDs are rejected.';

    -- ------------------------------------------------------------------
    -- TEST R: disconnected account rejected for actionable outcomes.
    -- v_event3 is still PROCESSING with v_claim's token (the preceding
    -- tests caught their exceptions without finalizing).  v_account2
    -- has a different business_id and is DISCONNECTED, so the account
    -- mapping check raises 22023 for both MATCHED and NO_MATCH.
    -- ------------------------------------------------------------------

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'MATCHED',
            v_account2,
            ARRAY[v_account2]::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST R FAILED: MATCHED accepted a disconnected account.';
    END IF;

    RAISE NOTICE
        'TEST R PASSED: MATCHED rejects disconnected accounts.';

    v_passed := FALSE;

    BEGIN
        PERFORM 1
        FROM public.finish_instagram_webhook_event(
            v_event3,
            v_claim.claim_token,
            'NO_MATCH',
            v_account2,
            '{}'::UUID[],
            NULL
        );

    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION
            'TEST R FAILED: NO_MATCH accepted a disconnected account.';
    END IF;

    RAISE NOTICE
        'TEST R PASSED: NO_MATCH rejects disconnected accounts.';

    -- ------------------------------------------------------------------
    -- TEST S: valid MATCHED case with a correctly mapped connected
    -- account.  v_event3 is still PROCESSING (TEST R caught its
    -- exceptions), so we insert a fresh v_event4 to claim.
    -- ------------------------------------------------------------------

    INSERT INTO public.webhook_events (
        id,
        external_event_id,
        event_type,
        event_payload
    )
    VALUES
        (
            v_event4,
            '17841400000000042:18000000000000045',
            'change:comments',
            v_payload
        );

    SELECT *
    INTO v_claim
    FROM public.claim_instagram_webhook_events(1, 60);

    IF v_claim.event_id IS NULL THEN
        RAISE EXCEPTION
            'TEST S FAILED: replacement event was not claimed for the MATCHED path.';
    END IF;

    PERFORM 1
    FROM public.finish_instagram_webhook_event(
        v_claim.event_id,
        v_claim.claim_token,
        'MATCHED',
        v_account,
        ARRAY[v_account]::UUID[],
        NULL
    );

    SELECT
        processing_status,
        processing_outcome,
        instagram_account_id
    INTO
        v_status,
        v_outcome,
        v_account_id
    FROM public.webhook_events
    WHERE id = v_claim.event_id;

    IF v_status <> 'COMPLETED'
       OR v_outcome <> 'MATCHED'
       OR v_account_id IS DISTINCT FROM v_account
    THEN
        RAISE EXCEPTION
            'TEST S FAILED: MATCHED case produced unexpected final state (%, %, %).',
            v_status,
            v_outcome,
            v_account_id;
    END IF;

    RAISE NOTICE
        'TEST S PASSED: MATCHED finalizes with the correct account.';

    -- ------------------------------------------------------------------
    -- TEST T: valid NO_MATCH case with a correctly mapped connected
    -- account.  Insert a fresh v_event5 to claim.
    -- ------------------------------------------------------------------

    INSERT INTO public.webhook_events (
        id,
        external_event_id,
        event_type,
        event_payload
    )
    VALUES
        (
            v_event5,
            '17841400000000042:18000000000000046',
            'change:comments',
            v_payload
        );

    PERFORM pg_catalog.set_config('role', 'service_role', true);

    SELECT *
    INTO v_claim
    FROM public.claim_instagram_webhook_events(1, 60);

    IF v_claim.event_id IS NULL THEN
        RAISE EXCEPTION
            'TEST T FAILED: replacement event was not claimed for the NO_MATCH path.';
    END IF;

    PERFORM 1
    FROM public.finish_instagram_webhook_event(
        v_claim.event_id,
        v_claim.claim_token,
        'NO_MATCH',
        v_account,
        '{}'::UUID[],
        NULL
    );

    SELECT
        processing_status,
        processing_outcome,
        instagram_account_id
    INTO
        v_status,
        v_outcome,
        v_account_id
    FROM public.webhook_events
    WHERE id = v_claim.event_id;

    IF v_status <> 'COMPLETED'
       OR v_outcome <> 'NO_MATCH'
       OR v_account_id IS DISTINCT FROM v_account
    THEN
        RAISE EXCEPTION
            'TEST T FAILED: NO_MATCH case produced unexpected final state (%, %, %).',
            v_status,
            v_outcome,
            v_account_id;
    END IF;

    RAISE NOTICE
        'TEST T PASSED: NO_MATCH finalizes with the correct connected account.';

    RAISE NOTICE
        'ALL PHASE 4.2 WEBHOOK PROCESSING TESTS PASSED';

END $$;

ROLLBACK;
