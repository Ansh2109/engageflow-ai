-- ==============================================================================
-- ENGAGEFLOW AI — PHASE 3 MULTI-TENANT RLS & INTEGRITY TEST SUITE (HARDENED V2)
-- File: supabase/tests/rls_security_test.sql
-- Description: Rigorous verification script testing genuine role switches,
--              exact SQLSTATE exception assertions, and retention cascade behavior.
-- Compatible with Supabase PostgreSQL (PostgreSQL 15+).
-- Safe execution: Everything runs inside a transaction and rolls back at the end.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
    v_user_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    v_user_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    v_account_a UUID := '11111111-1111-1111-1111-111111111111';
    v_account_b UUID := '22222222-2222-2222-2222-222222222222';
    v_automation_a UUID := 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
    v_automation_b UUID := 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';
    v_token_a UUID := '33333333-3333-3333-3333-333333333333';
    v_webhook_id UUID := '44444444-4444-4444-4444-444444444444';
    v_log_a UUID := '55555555-5555-5555-5555-555555555555';
    v_log_b UUID := '66666666-6666-6666-6666-666666666666';
    v_count INTEGER;
    v_passed BOOLEAN;
    v_log_owner UUID;
    v_log_account UUID;
    v_log_auto UUID;
BEGIN
    RAISE NOTICE '=============================================================';
    RAISE NOTICE 'ENGAGEFLOW AI — MULTI-TENANT RLS & INTEGRITY VERIFICATION';
    RAISE NOTICE '=============================================================';

    -- --------------------------------------------------------------------------
    -- STEP 0: SEED BASE MOCK DATA (EXECUTED AS POSTGRES / SERVICE_ROLE)
    -- --------------------------------------------------------------------------
    PERFORM pg_catalog.set_config('role', 'postgres', true);

    -- 0.1 Seed mock users in auth.users
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES 
        (v_user_a, 'user_a@test.com', '{"full_name":"User A"}'::jsonb),
        (v_user_b, 'user_b@test.com', '{"full_name":"User B"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    -- 0.2 Confirm profiles automatically created by on_auth_user_created trigger
    SELECT COUNT(*) INTO v_count FROM public.profiles WHERE id IN (v_user_a, v_user_b);
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'TEST 0 FAILED: Automatic profile trigger did not create 2 profiles. Count: %', v_count;
    END IF;
    RAISE NOTICE 'TEST 0 PASSED: Profiles created automatically via trigger.';

    -- 0.3 Populate base accounts, automations, and tokens via service_role
    INSERT INTO public.instagram_accounts (id, owner_id, instagram_business_id, username, account_type)
    VALUES 
        (v_account_a, v_user_a, 'ig_biz_user_a', 'creator_a', 'CREATOR'),
        (v_account_b, v_user_b, 'ig_biz_user_b', 'creator_b', 'BUSINESS');

    INSERT INTO public.instagram_account_tokens (id, instagram_account_id, owner_id, encrypted_access_token)
    VALUES (v_token_a, v_account_a, v_user_a, 'iv_hex:tag_hex:cipher_hex');

    INSERT INTO public.automations (id, owner_id, instagram_account_id, name, automation_type)
    VALUES 
        (v_automation_a, v_user_a, v_account_a, 'Auto A', 'COMMENT_TO_DM'),
        (v_automation_b, v_user_b, v_account_b, 'Auto B', 'DM_KEYWORD');

    -- Insert valid activity log for User A
    INSERT INTO public.activity_logs (
        id, owner_id, instagram_account_id, automation_id, event_type, action_type, status
    )
    VALUES (
        v_log_a, v_user_a, v_account_a, v_automation_a, 'comments', 'SEND_DM', 'SENT'
    );

    INSERT INTO public.activity_logs (
        id, owner_id, instagram_account_id, automation_id, event_type, action_type, status
    )
    VALUES (
        v_log_b, v_user_b, v_account_b, v_automation_b, 'comments', 'SEND_DM', 'SENT'
    );

    -- --------------------------------------------------------------------------
    -- TEST 1: SWITCH TO GENUINE "authenticated" ROLE AS USER A
    --         Verify User A CANNOT read User B's accounts
    -- --------------------------------------------------------------------------
    PERFORM pg_catalog.set_config('role', 'authenticated', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_a), true);

    IF CURRENT_USER <> 'authenticated' THEN
        RAISE EXCEPTION 'TEST 1 FAILED: Effective role is %, expected authenticated.', CURRENT_USER;
    END IF;
    RAISE NOTICE 'RLS checks execute with current_user=%.', CURRENT_USER;

    SELECT COUNT(*) INTO v_count FROM public.instagram_accounts WHERE owner_id = v_user_b;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'TEST 1 FAILED: User A was able to read User B accounts! Found: %', v_count;
    END IF;
    RAISE NOTICE 'TEST 1 PASSED: User A cannot read User B Instagram accounts.';

    -- --------------------------------------------------------------------------
    -- TEST 2: User A CANNOT modify or delete User B's automations
    -- --------------------------------------------------------------------------
    UPDATE public.automations SET name = 'Hacked by User A' WHERE id = v_automation_b;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'TEST 2 FAILED: User A updated User B automation!';
    END IF;

    DELETE FROM public.automations WHERE id = v_automation_b;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'TEST 2 FAILED: User A deleted User B automation!';
    END IF;
    RAISE NOTICE 'TEST 2 PASSED: User A cannot update or delete User B automations.';

    -- --------------------------------------------------------------------------
    -- TEST 3: User A CANNOT attach an automation to User B's Instagram account
    --         Must fail with precise SQLSTATE '23503' (foreign_key_violation)
    --         or RLS check failure.
    -- --------------------------------------------------------------------------
    v_passed := FALSE;
    BEGIN
        INSERT INTO public.automations (owner_id, instagram_account_id, name, automation_type)
        VALUES (v_user_a, v_account_b, 'Exploit Attack', 'COMMENT_TO_DM');
    EXCEPTION
        WHEN SQLSTATE '23503' THEN -- foreign_key_violation (compound FK rejected)
            v_passed := TRUE;
        WHEN SQLSTATE '42501' THEN -- insufficient_privilege (RLS check rejected)
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 3 FAILED: User A attached an automation to User B account without raising 23503 or 42501!';
    END IF;
    RAISE NOTICE 'TEST 3 PASSED: Cross-tenant automation creation rejected with exact SQLSTATE.';

    -- --------------------------------------------------------------------------
    -- TEST 4: User A CANNOT read token records in instagram_account_tokens
    -- --------------------------------------------------------------------------
    v_passed := FALSE;
    BEGIN
        SELECT COUNT(*) INTO v_count FROM public.instagram_account_tokens;
        -- If SELECT doesn't throw insufficient_privilege, RLS returns 0 rows
        IF v_count = 0 THEN
            v_passed := TRUE;
        END IF;
    EXCEPTION
        WHEN SQLSTATE '42501' THEN -- insufficient_privilege (permissions revoked)
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Authenticated user accessed private token storage! Count: %', v_count;
    END IF;
    RAISE NOTICE 'TEST 4 PASSED: Token vault is completely inaccessible to authenticated clients.';

    -- --------------------------------------------------------------------------
    -- TEST 5: User A CANNOT insert fabricated activity logs
    --         Must fail with exact SQLSTATE '42501' (insufficient_privilege)
    -- --------------------------------------------------------------------------
    v_passed := FALSE;
    BEGIN
        INSERT INTO public.activity_logs (owner_id, event_type, action_type, status)
        VALUES (v_user_a, 'comments', 'SEND_DM', 'SENT');
    EXCEPTION
        WHEN SQLSTATE '42501' THEN -- insufficient_privilege (permission revoked)
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Customer was able to INSERT directly into activity_logs!';
    END IF;
    v_passed := FALSE;
    BEGIN
        UPDATE public.activity_logs SET status = 'FAILED' WHERE id = v_log_a;
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Customer was able to UPDATE activity_logs!';
    END IF;

    v_passed := FALSE;
    BEGIN
        DELETE FROM public.activity_logs WHERE id = v_log_a;
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Customer was able to DELETE activity_logs!';
    END IF;
    RAISE NOTICE 'TEST 5 PASSED: Customer INSERT, UPDATE, and DELETE on activity_logs are rejected.';

    -- --------------------------------------------------------------------------
    -- TEST 6: User A CANNOT insert or manipulate instagram_accounts directly
    --         Must fail with exact SQLSTATE '42501' (insufficient_privilege)
    -- --------------------------------------------------------------------------
    v_passed := FALSE;
    BEGIN
        INSERT INTO public.instagram_accounts (owner_id, instagram_business_id, username)
        VALUES (v_user_a, 'rogue_account_id', 'rogue_user');
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 6 FAILED: Customer directly inserted an instagram_account bypassing OAuth!';
    END IF;

    v_passed := FALSE;
    BEGIN
        UPDATE public.instagram_accounts SET username = 'rogue_user' WHERE id = v_account_a;
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 6 FAILED: Customer directly updated an instagram_account!';
    END IF;

    v_passed := FALSE;
    BEGIN
        DELETE FROM public.instagram_accounts WHERE id = v_account_a;
    EXCEPTION
        WHEN SQLSTATE '42501' THEN
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 6 FAILED: Customer directly deleted an instagram_account!';
    END IF;
    RAISE NOTICE 'TEST 6 PASSED: Customer INSERT, UPDATE, and DELETE on instagram_accounts are rejected.';

    -- --------------------------------------------------------------------------
    -- SWITCH TO SERVICE_ROLE FOR PRIVILEGED BACKEND TESTS
    -- --------------------------------------------------------------------------
    PERFORM pg_catalog.set_config('role', 'service_role', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

    IF CURRENT_USER <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE ROLE SETUP FAILED: Effective role is %, expected service_role.', CURRENT_USER;
    END IF;
    RAISE NOTICE 'Privileged backend checks execute with current_user=%.', CURRENT_USER;

    -- --------------------------------------------------------------------------
    -- TEST 7: Webhook Idempotency (Duplicate events cannot be stored twice)
    --         Must fail with exact SQLSTATE '23505' (unique_violation)
    -- --------------------------------------------------------------------------
    INSERT INTO public.webhook_events (id, external_event_id, event_type, event_payload)
    VALUES (v_webhook_id, 'meta_comment_12345', 'comments', '{"comment":"test"}'::jsonb);

    v_passed := FALSE;
    BEGIN
        INSERT INTO public.webhook_events (external_event_id, event_type, event_payload)
        VALUES ('meta_comment_12345', 'comments', '{"comment":"duplicate"}'::jsonb);
    EXCEPTION
        WHEN SQLSTATE '23505' THEN -- unique_violation
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 7 FAILED: Duplicate webhook event did not raise SQLSTATE 23505!';
    END IF;
    RAISE NOTICE 'TEST 7 PASSED: Duplicate webhook event rejected by uniqueness constraint (SQLSTATE 23505).';

    -- --------------------------------------------------------------------------
    -- TEST 8: Cross-tenant activity log references are rejected by compound FK
    --         Must fail with exact SQLSTATE '23503' (foreign_key_violation)
    -- --------------------------------------------------------------------------
    v_passed := FALSE;
    BEGIN
        INSERT INTO public.activity_logs (
            owner_id, 
            instagram_account_id, 
            automation_id, 
            event_type, 
            action_type, 
            status
        )
        VALUES (
            v_user_a, 
            v_account_a, 
            v_automation_b, -- Belongs to User B!
            'comments', 
            'SEND_DM', 
            'SENT'
        );
    EXCEPTION
        WHEN SQLSTATE '23503' THEN -- foreign_key_violation
            v_passed := TRUE;
    END;

    IF NOT v_passed THEN
        RAISE EXCEPTION 'TEST 8 FAILED: Activity log allowed cross-tenant automation reference!';
    END IF;
    RAISE NOTICE 'TEST 8 PASSED: Cross-tenant activity log reference rejected by compound FK (SQLSTATE 23503).';

    -- --------------------------------------------------------------------------
    -- TEST 9: Cascade deletion retains historical activity_logs with owner_id intact
    --         Deleting automation_a must NULL automation_id but KEEP owner_id
    -- --------------------------------------------------------------------------
    DELETE FROM public.automations WHERE id = v_automation_a;

    SELECT owner_id, automation_id INTO v_log_owner, v_log_auto 
    FROM public.activity_logs WHERE id = v_log_a;

    IF v_log_owner <> v_user_a THEN
        RAISE EXCEPTION 'TEST 9 FAILED: owner_id was corrupted or nulled! Expected %, got %', v_user_a, v_log_owner;
    END IF;

    IF v_log_auto IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 9 FAILED: automation_id was not set to NULL upon automation deletion! Got %', v_log_auto;
    END IF;
    RAISE NOTICE 'TEST 9 PASSED: Automation deletion nulled automation_id while preserving owner_id on activity_logs.';

    -- --------------------------------------------------------------------------
    -- TEST 10: Cascade deletion retains historical activity_logs with owner_id intact
    --          Deleting instagram_account_a must NULL instagram_account_id but KEEP owner_id
    -- --------------------------------------------------------------------------
    DELETE FROM public.instagram_accounts WHERE id = v_account_a;

    SELECT owner_id, instagram_account_id INTO v_log_owner, v_log_account 
    FROM public.activity_logs WHERE id = v_log_a;

    IF v_log_owner <> v_user_a THEN
        RAISE EXCEPTION 'TEST 10 FAILED: owner_id was corrupted or nulled! Expected %, got %', v_user_a, v_log_owner;
    END IF;

    IF v_log_account IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 10 FAILED: instagram_account_id was not set to NULL upon account deletion! Got %', v_log_account;
    END IF;
    RAISE NOTICE 'TEST 10 PASSED: Account deletion nulled instagram_account_id while preserving owner_id on activity_logs.';

    -- --------------------------------------------------------------------------
    -- TEST 11: User A can read only User A's activity logs after account deletion
    -- --------------------------------------------------------------------------
    PERFORM pg_catalog.set_config('role', 'authenticated', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_a), true);

    IF CURRENT_USER <> 'authenticated' THEN
        RAISE EXCEPTION 'TEST 11 FAILED: Effective role is %, expected authenticated.', CURRENT_USER;
    END IF;

    SELECT COUNT(*) INTO v_count FROM public.activity_logs;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'TEST 11 FAILED: User A should see only their retained activity log. Visible count: %', v_count;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.activity_logs WHERE id = v_log_a AND owner_id = v_user_a) THEN
        RAISE EXCEPTION 'TEST 11 FAILED: User A cannot see their retained activity log.';
    END IF;
    RAISE NOTICE 'TEST 11 PASSED: Activity-log RLS hides User B data and preserves User A history.';

    RAISE NOTICE '=============================================================';
    RAISE NOTICE 'ALL 11 RLS, INTEGRITY & CASCADE TESTS PASSED SUCCESSFULLY';
    RAISE NOTICE '=============================================================';
END $$;

-- ------------------------------------------------------------------------------
-- CLEANUP: Always rollback test transaction to guarantee ZERO residual data
-- ------------------------------------------------------------------------------
ROLLBACK;
