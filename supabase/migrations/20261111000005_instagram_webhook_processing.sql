-- Add leased, service-role-only processing for persisted Instagram webhook events.
BEGIN;

ALTER TABLE public.webhook_events
    ADD COLUMN processing_outcome TEXT
        CHECK (
            processing_outcome IS NULL
            OR processing_outcome IN (
                'MATCHED',
                'NO_MATCH',
                'IGNORED',
                'RETRYABLE_FAILURE',
                'TERMINAL_FAILURE'
            )
        ),
    ADD COLUMN matched_automation_ids UUID[],
    ADD COLUMN claim_token UUID,
    ADD COLUMN claim_expires_at TIMESTAMPTZ;

CREATE INDEX webhook_events_claimable_idx
    ON public.webhook_events (processing_status, received_at, id)
    WHERE processing_status IN ('PENDING', 'PROCESSING');

CREATE OR REPLACE FUNCTION public.claim_instagram_webhook_events(
    p_batch_size INTEGER,
    p_lease_seconds INTEGER
)
RETURNS TABLE (
    event_id UUID,
    external_event_id TEXT,
    event_type TEXT,
    event_payload JSONB,
    attempts INTEGER,
    claim_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
    IF COALESCE(auth.role() = 'service_role', FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'SERVICE_ROLE_REQUIRED';
    END IF;

    IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 5
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 180 THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_CLAIM_LIMITS';
    END IF;

    UPDATE public.webhook_events AS event
    SET
        processing_status = 'FAILED',
        processing_outcome = 'TERMINAL_FAILURE',
        error_message = 'MAX_ATTEMPTS_EXCEEDED',
        processed_at = v_now,
        claim_token = NULL,
        claim_expires_at = NULL
    WHERE event.attempts >= 5
      AND (
          event.processing_status = 'PENDING'
          OR (
              event.processing_status = 'PROCESSING'
              AND (
                  event.claim_expires_at IS NULL
                  OR event.claim_expires_at <= v_now
              )
          )
      );

    RETURN QUERY
    WITH candidates AS (
        SELECT event.id
        FROM public.webhook_events AS event
        WHERE event.attempts < 5
          AND (
              event.processing_status = 'PENDING'
              OR (
                  event.processing_status = 'PROCESSING'
                  AND (
                      event.claim_expires_at IS NULL
                      OR event.claim_expires_at <= v_now
                  )
              )
          )
        ORDER BY event.received_at, event.id
        FOR UPDATE SKIP LOCKED
        LIMIT p_batch_size
    ),
    claimed AS (
        UPDATE public.webhook_events AS event
        SET
            processing_status = 'PROCESSING',
            attempts = event.attempts + 1,
            claim_token = extensions.gen_random_uuid(),
            claim_expires_at = v_now
                + pg_catalog.make_interval(secs => p_lease_seconds)
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING
            event.id,
            event.external_event_id,
            event.event_type,
            event.event_payload,
            event.attempts,
            event.claim_token
    )
    SELECT
        claimed.id,
        claimed.external_event_id,
        claimed.event_type,
        claimed.event_payload,
        claimed.attempts,
        claimed.claim_token
    FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_instagram_webhook_event(
    p_event_id UUID,
    p_claim_token UUID,
    p_outcome TEXT,
    p_instagram_account_id UUID,
    p_matched_automation_ids UUID[],
    p_error_code TEXT
)
RETURNS TABLE (
    processing_status TEXT,
    processing_outcome TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_event public.webhook_events%ROWTYPE;
    v_status TEXT;
    v_outcome TEXT;
    v_error_code TEXT;
    v_business_id TEXT;
BEGIN
    IF COALESCE(auth.role() = 'service_role', FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'SERVICE_ROLE_REQUIRED';
    END IF;

    -- Reject outcomes the processor is never allowed to record.
    IF p_outcome IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_EVENT_OUTCOME: outcome must not be null';
    END IF;

    IF p_outcome !~ '^(MATCHED|NO_MATCH|IGNORED|RETRYABLE_FAILURE|TERMINAL_FAILURE)$' THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_EVENT_OUTCOME: unsupported outcome';
    END IF;

    -- Basic parameter shape.
    IF p_event_id IS NULL
       OR p_claim_token IS NULL
       OR p_matched_automation_ids IS NULL
       OR (
           p_error_code IS NOT NULL
           AND p_error_code !~ '^[A-Z0-9_]{1,64}$'
       )
       -- MATCHED must include at least one automation.
       OR (p_outcome = 'MATCHED' AND pg_catalog.cardinality(p_matched_automation_ids) = 0)
       -- Everything else must ship an empty array.
       OR (p_outcome <> 'MATCHED' AND pg_catalog.cardinality(p_matched_automation_ids) <> 0) THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_EVENT_OUTCOME';
    END IF;

    -- Reject NULLs inside the UUID[] too; a NULL element is not valid
    -- matching evidence even if the array length alone is acceptable.
    IF p_matched_automation_ids != ARRAY[]::UUID[]
       AND array_position(p_matched_automation_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_EVENT_OUTCOME: matched_automation_ids contains null';
    END IF;

    -- Reject accidental duplicate automation IDs.
    IF p_matched_automation_ids IS NOT NULL
       AND pg_catalog.array_length(p_matched_automation_ids, 1) <> pg_catalog.array_length(pg_catalog.unnest(p_matched_automation_ids), 1) THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'INVALID_EVENT_OUTCOME: matched_automation_ids contains duplicates';
    END IF;

    SELECT event.*
    INTO v_event
    FROM public.webhook_events AS event
    WHERE event.id = p_event_id
      AND event.processing_status = 'PROCESSING'
      AND event.claim_token = p_claim_token
      AND event.claim_expires_at > pg_catalog.clock_timestamp()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '40001',
            MESSAGE = 'WEBHOOK_CLAIM_LOST';
    END IF;

    v_business_id := v_event.event_payload #>> '{entry,id}';

    -- Account mapping validation.
    -- MATCHED and NO_MATCH require a non-NULL, connected, business-ID matched
    -- account. IGNORED keeps the account reference even when disconnected.
    -- RETRYABLE_FAILURE and TERMINAL_FAILURE allow NULL and ignore the account.
    IF p_outcome = 'MATCHED' OR p_outcome = 'NO_MATCH' THEN
        IF p_instagram_account_id IS NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'INVALID_EVENT_ACCOUNT_MAPPING: account is required';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.instagram_accounts AS account
            WHERE account.id = p_instagram_account_id
              AND account.instagram_business_id = v_business_id
              AND account.connection_status = 'CONNECTED'
        ) THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'INVALID_EVENT_ACCOUNT_MAPPING';
        END IF;

    ELSIF p_outcome = 'IGNORED' THEN
        IF p_instagram_account_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1
                FROM public.instagram_accounts AS account
                WHERE account.id = p_instagram_account_id
                  AND account.instagram_business_id = v_business_id
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '22023',
                    MESSAGE = 'INVALID_EVENT_ACCOUNT_MAPPING';
            END IF;
        END IF;

    END IF;

    -- Retryable failures, bounded retries, and finalization.
    IF p_outcome = 'RETRYABLE_FAILURE' THEN
        v_error_code := COALESCE(p_error_code, 'PROCESSING_FAILED');
        IF v_event.attempts >= 5 THEN
            v_status := 'FAILED';
            v_outcome := 'TERMINAL_FAILURE';
            v_error_code := 'MAX_ATTEMPTS_EXCEEDED';
        ELSE
            v_status := 'PENDING';
            v_outcome := 'RETRYABLE_FAILURE';
        END IF;

    ELSIF p_outcome = 'TERMINAL_FAILURE' THEN
        IF v_event.attempts < 5 THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'TERMINAL_FAILURE_REQUIRES_MAX_ATTEMPTS';
        END IF;
        v_status := 'FAILED';
        v_outcome := 'TERMINAL_FAILURE';
        v_error_code := COALESCE(p_error_code, 'PROCESSING_FAILED');

    ELSIF p_outcome = 'IGNORED' THEN
        v_status := 'IGNORED';
        v_outcome := 'IGNORED';
        v_error_code := p_error_code;

    ELSE
        -- MATCHED or NO_MATCH.
        v_status := 'COMPLETED';
        v_outcome := p_outcome;
        v_error_code := NULL;
    END IF;

    RETURN QUERY
    UPDATE public.webhook_events AS event
    SET
        instagram_account_id = p_instagram_account_id,
        processing_status = v_status,
        processing_outcome = v_outcome,
        matched_automation_ids = p_matched_automation_ids,
        error_message = v_error_code,
        processed_at = CASE
            WHEN v_status IN ('PENDING', 'PROCESSING') THEN NULL
            ELSE pg_catalog.clock_timestamp()
        END,
        claim_token = NULL,
        claim_expires_at = NULL
    WHERE event.id = p_event_id
    RETURNING event.processing_status, event.processing_outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_instagram_webhook_events(INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_instagram_webhook_events(INTEGER, INTEGER)
    TO service_role;

REVOKE ALL ON FUNCTION public.finish_instagram_webhook_event(
    UUID, UUID, TEXT, UUID, UUID[], TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_instagram_webhook_event(
    UUID, UUID, TEXT, UUID, UUID[], TEXT
) TO service_role;

COMMIT;
