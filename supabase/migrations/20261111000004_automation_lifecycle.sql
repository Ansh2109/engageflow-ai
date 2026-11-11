-- Lifecycle transitions are separate from draft editing and message execution.
BEGIN;

CREATE TABLE public.automation_runtime_readiness (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    webhook_verified BOOLEAN NOT NULL DEFAULT FALSE,
    event_ingestion_operational BOOLEAN NOT NULL DEFAULT FALSE,
    event_processor_operational BOOLEAN NOT NULL DEFAULT FALSE,
    message_executor_operational BOOLEAN NOT NULL DEFAULT FALSE,
    retry_policy_verified BOOLEAN NOT NULL DEFAULT FALSE,
    idempotency_verified BOOLEAN NOT NULL DEFAULT FALSE,
    last_verified_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

INSERT INTO public.automation_runtime_readiness (singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.automation_runtime_readiness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_runtime_readiness
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.automation_media_validations (
    automation_id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    instagram_account_id UUID NOT NULL,
    media_id TEXT NOT NULL CHECK (media_id ~ '^[0-9]{1,32}$'),
    media_type TEXT NOT NULL
        CHECK (media_type IN ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
    is_valid BOOLEAN NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    CONSTRAINT automation_media_validation_validity_check
        CHECK (valid_until > verified_at),
    CONSTRAINT automation_media_validation_automation_owner_fkey
        FOREIGN KEY (automation_id, owner_id)
        REFERENCES public.automations(id, owner_id) ON DELETE CASCADE,
    CONSTRAINT automation_media_validation_account_owner_fkey
        FOREIGN KEY (instagram_account_id, owner_id)
        REFERENCES public.instagram_accounts(id, owner_id) ON DELETE CASCADE
);

CREATE INDEX automation_media_validations_owner_account_idx
    ON public.automation_media_validations (owner_id, instagram_account_id);

ALTER TABLE public.automation_media_validations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_media_validations
    FROM PUBLIC, anon, authenticated, service_role;
-- The server route is the only application writer and records a row only after
-- it has verified the owned media against Meta using the account's stored token.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automation_media_validations
    TO service_role;

CREATE TABLE public.automation_lifecycle_events (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    automation_id UUID NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    previous_status TEXT
        CHECK (previous_status IS NULL OR previous_status IN ('DRAFT', 'ACTIVE', 'PAUSED')),
    new_status TEXT NOT NULL CHECK (new_status IN ('DRAFT', 'ACTIVE', 'PAUSED')),
    action TEXT NOT NULL
        CHECK (action IN ('CREATED', 'BASELINE', 'ACTIVATED', 'PAUSED', 'RESUMED', 'STATUS_CHANGED')),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (pg_catalog.jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT automation_lifecycle_event_status_pair_check CHECK (
        (action IN ('CREATED', 'BASELINE') AND previous_status IS NULL)
        OR (action NOT IN ('CREATED', 'BASELINE') AND previous_status IS NOT NULL)
    )
);

-- Deliberately no automation FK: lifecycle evidence remains append-only if a
-- deletable draft is later removed.
CREATE INDEX automation_lifecycle_events_owner_automation_time_idx
    ON public.automation_lifecycle_events (owner_id, automation_id, created_at DESC);

INSERT INTO public.automation_lifecycle_events (
    automation_id,
    owner_id,
    previous_status,
    new_status,
    action,
    metadata
)
SELECT
    automation.id,
    automation.owner_id,
    NULL,
    automation.status,
    'BASELINE',
    '{"source":"lifecycle_tracking_migration"}'::JSONB
FROM public.automations AS automation;

ALTER TABLE public.automation_lifecycle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_lifecycle_events
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.automation_lifecycle_events TO authenticated;

CREATE POLICY automation_lifecycle_events_select_own
    ON public.automation_lifecycle_events
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = owner_id);

-- A private transaction-scoped, single-use permit prevents direct status
-- changes, including service-role updates.
CREATE TABLE public.automation_lifecycle_transition_permits (
    transaction_id BIGINT NOT NULL,
    automation_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    previous_status TEXT NOT NULL
        CHECK (previous_status IN ('DRAFT', 'ACTIVE', 'PAUSED')),
    target_status TEXT NOT NULL
        CHECK (target_status IN ('ACTIVE', 'PAUSED')),
    action TEXT NOT NULL CHECK (action IN ('ACTIVATE', 'PAUSE', 'RESUME')),
    PRIMARY KEY (transaction_id, automation_id)
);

ALTER TABLE public.automation_lifecycle_transition_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_lifecycle_transition_permits
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_automation_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_permitted BOOLEAN := FALSE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'DRAFT' THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'LIFECYCLE_TRANSITION_REQUIRED';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status THEN
        DELETE FROM public.automation_lifecycle_transition_permits AS permit
        WHERE permit.transaction_id = pg_catalog.txid_current()
          AND permit.automation_id = NEW.id
          AND permit.owner_id = NEW.owner_id
          AND permit.previous_status = OLD.status
          AND permit.target_status = NEW.status
          AND (
              (permit.action = 'ACTIVATE' AND OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE')
              OR (permit.action = 'PAUSE' AND OLD.status = 'ACTIVE' AND NEW.status = 'PAUSED')
              OR (permit.action = 'RESUME' AND OLD.status = 'PAUSED' AND NEW.status = 'ACTIVE')
          )
        RETURNING TRUE INTO v_permitted;

        IF NOT COALESCE(v_permitted, FALSE) THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'LIFECYCLE_TRANSITION_REQUIRED';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_automation_status_transition()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER automation_status_transition_guard
    BEFORE INSERT OR UPDATE ON public.automations
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_automation_status_transition();

CREATE OR REPLACE FUNCTION public.record_automation_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_action TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'CREATED';
        INSERT INTO public.automation_lifecycle_events (
            automation_id,
            owner_id,
            previous_status,
            new_status,
            action,
            metadata
        )
        VALUES (
            NEW.id,
            NEW.owner_id,
            NULL,
            NEW.status,
            v_action,
            '{"source":"automation_insert"}'::JSONB
        );
        RETURN NEW;
    END IF;

    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' THEN
        v_action := 'ACTIVATED';
    ELSIF OLD.status = 'ACTIVE' AND NEW.status = 'PAUSED' THEN
        v_action := 'PAUSED';
    ELSIF OLD.status = 'PAUSED' AND NEW.status = 'ACTIVE' THEN
        v_action := 'RESUMED';
    ELSE
        v_action := 'STATUS_CHANGED';
    END IF;

    INSERT INTO public.automation_lifecycle_events (
        automation_id,
        owner_id,
        previous_status,
        new_status,
        action,
        metadata
    )
    VALUES (
        NEW.id,
        NEW.owner_id,
        OLD.status,
        NEW.status,
        v_action,
        '{"source":"automation_status_trigger"}'::JSONB
    );

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_automation_lifecycle_event()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER automation_lifecycle_created_event
    AFTER INSERT ON public.automations
    FOR EACH ROW
    EXECUTE FUNCTION public.record_automation_lifecycle_event();

CREATE TRIGGER automation_lifecycle_status_event
    AFTER UPDATE OF status ON public.automations
    FOR EACH ROW
    EXECUTE FUNCTION public.record_automation_lifecycle_event();

CREATE OR REPLACE FUNCTION public.automation_execution_readiness_blockers(
    p_automation_id UUID
)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_owner_id UUID := auth.uid();
    v_automation RECORD;
    v_account RECORD;
    v_scopes TEXT[] := '{}'::TEXT[];
    v_blockers TEXT[] := '{}'::TEXT[];
    v_trigger_count BIGINT;
    v_total_trigger_count BIGINT;
    v_action_count BIGINT;
    v_action_type TEXT;
    v_action_message TEXT;
    v_public_reply_enabled BOOLEAN;
    v_public_reply TEXT;
    v_media_verified BOOLEAN;
    v_runtime RECORD;
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
    END IF;

    SELECT
        automation.id,
        automation.owner_id,
        automation.instagram_account_id,
        automation.automation_type,
        automation.status,
        automation.target_post_id,
        automation.target_media_type
    INTO v_automation
    FROM public.automations AS automation
    WHERE automation.id = p_automation_id
      AND automation.owner_id = v_owner_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'NOT_FOUND';
    END IF;

    IF v_automation.automation_type <> 'COMMENT_TO_DM' THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'UNSUPPORTED_AUTOMATION_TYPE');
    END IF;

    SELECT
        account.id,
        account.owner_id,
        account.connection_status,
        account.connection_id,
        account.unified_connection_id
    INTO v_account
    FROM public.instagram_accounts AS account
    WHERE account.id = v_automation.instagram_account_id
      AND account.owner_id = v_owner_id
    FOR SHARE;

    IF NOT FOUND THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'ACCOUNT_NOT_CONNECTED');
    ELSIF v_account.connection_status <> 'CONNECTED' THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'ACCOUNT_NOT_CONNECTED');
    ELSE
        SELECT COALESCE(pg_catalog.array_agg(scope_row.scope), '{}'::TEXT[])
        INTO v_scopes
        FROM (
            SELECT pg_catalog.unnest(connection.scopes) AS scope
            FROM public.instagram_business_connections AS connection
            WHERE connection.id = v_account.connection_id
              AND connection.owner_id = v_owner_id
              AND connection.connection_status = 'CONNECTED'
              AND (
                  connection.token_expires_at IS NULL
                  OR connection.token_expires_at > pg_catalog.clock_timestamp()
              )
            UNION
            SELECT pg_catalog.unnest(connection.scopes) AS scope
            FROM public.instagram_unified_login_connections AS connection
            WHERE connection.id = v_account.unified_connection_id
              AND connection.owner_id = v_owner_id
              AND connection.connection_status = 'CONNECTED'
              AND (
                  connection.token_expires_at IS NULL
                  OR connection.token_expires_at > pg_catalog.clock_timestamp()
              )
            UNION
            SELECT pg_catalog.unnest(token.scopes) AS scope
            FROM public.instagram_account_tokens AS token
            WHERE token.instagram_account_id = v_account.id
              AND token.owner_id = v_owner_id
              AND (
                  token.token_expires_at IS NULL
                  OR token.token_expires_at > pg_catalog.clock_timestamp()
              )
        ) AS scope_row;

        IF NOT (
            v_scopes @> ARRAY['instagram_business_basic']::TEXT[]
            OR v_scopes @> ARRAY['instagram_basic']::TEXT[]
        ) OR NOT (
            v_scopes @> ARRAY['instagram_business_manage_messages']::TEXT[]
            OR v_scopes @> ARRAY['instagram_manage_messages']::TEXT[]
        ) THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'MISSING_META_PERMISSIONS');
        END IF;

        IF v_automation.automation_type = 'COMMENT_TO_DM'
           AND NOT (
               v_scopes @> ARRAY['instagram_business_manage_comments']::TEXT[]
               OR v_scopes @> ARRAY['instagram_manage_comments']::TEXT[]
           ) THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'MISSING_META_PERMISSIONS');
        END IF;
    END IF;

    SELECT
        pg_catalog.count(*),
        pg_catalog.count(*) FILTER (
            WHERE trig.trigger_type = CASE
                WHEN v_automation.automation_type = 'COMMENT_TO_DM'
                    THEN 'COMMENT_KEYWORD'
                ELSE 'DM_KEYWORD'
            END
              AND pg_catalog.char_length(pg_catalog.btrim(trig.keyword)) BETWEEN 1 AND 64
        )
    INTO v_total_trigger_count, v_trigger_count
    FROM public.automation_triggers AS trig
    WHERE trig.automation_id = v_automation.id;

    SELECT pg_catalog.count(*)
    INTO v_action_count
    FROM public.automation_actions AS act
    WHERE act.automation_id = v_automation.id;

    IF v_total_trigger_count < 1
       OR v_total_trigger_count <> v_trigger_count
       OR v_action_count <> 1 THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'INVALID_CONFIGURATION');
    ELSE
        SELECT
            act.action_type,
            act.message_text,
            act.public_reply_enabled,
            act.public_comment_reply_text
        INTO
            v_action_type,
            v_action_message,
            v_public_reply_enabled,
            v_public_reply
        FROM public.automation_actions AS act
        WHERE act.automation_id = v_automation.id;

        IF v_action_message IS NULL
           OR pg_catalog.btrim(v_action_message) = ''
           OR pg_catalog.char_length(pg_catalog.btrim(v_action_message))
                NOT BETWEEN 1 AND 2200
           OR (
               v_public_reply IS NOT NULL
               AND (
                   pg_catalog.btrim(v_public_reply) = ''
                   OR pg_catalog.char_length(pg_catalog.btrim(v_public_reply))
                        NOT BETWEEN 1 AND 2200
               )
           )
           OR (
               v_public_reply_enabled
               AND (
                   v_public_reply IS NULL
                   OR pg_catalog.btrim(v_public_reply) = ''
                   OR pg_catalog.char_length(pg_catalog.btrim(v_public_reply))
                        NOT BETWEEN 1 AND 2200
               )
           ) THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'INVALID_CONFIGURATION');
        ELSIF v_automation.automation_type = 'COMMENT_TO_DM' THEN
            IF v_automation.target_post_id IS NULL
               OR v_automation.target_post_id !~ '^[0-9]{1,32}$'
               OR v_automation.target_media_type IS NULL
               OR v_automation.target_media_type NOT IN ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')
               OR (
                   v_public_reply_enabled
                   AND (
                       v_action_type <> 'SEND_DM_AND_REPLY_COMMENT'
                   )
               )
               OR (
                   NOT v_public_reply_enabled
                   AND v_action_type <> 'SEND_DM'
               ) THEN
                v_blockers := pg_catalog.array_append(v_blockers, 'INVALID_CONFIGURATION');
            END IF;
        ELSIF v_automation.automation_type = 'DM_KEYWORD' THEN
            IF v_action_type <> 'SEND_DM' THEN
                v_blockers := pg_catalog.array_append(v_blockers, 'INVALID_CONFIGURATION');
            END IF;
        ELSE
            v_blockers := pg_catalog.array_append(v_blockers, 'UNSUPPORTED_AUTOMATION_TYPE');
        END IF;

        IF v_automation.automation_type = 'COMMENT_TO_DM' THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.automation_media_validations AS validation
                WHERE validation.automation_id = v_automation.id
                  AND validation.owner_id = v_owner_id
                  AND validation.instagram_account_id = v_automation.instagram_account_id
                  AND validation.media_id = v_automation.target_post_id
                  AND validation.media_type = v_automation.target_media_type
                  AND validation.is_valid
                  AND validation.verified_at <= pg_catalog.clock_timestamp()
                  AND validation.valid_until > pg_catalog.clock_timestamp()
            )
            INTO v_media_verified;

            IF NOT v_media_verified THEN
                v_blockers := pg_catalog.array_append(v_blockers, 'TARGET_MEDIA_NOT_VERIFIED');
            END IF;
        END IF;
    END IF;

    SELECT *
    INTO v_runtime
    FROM public.automation_runtime_readiness AS readiness
    WHERE readiness.singleton = TRUE;

    IF NOT FOUND THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'RUNTIME_READINESS_UNAVAILABLE');
    ELSE
        IF NOT v_runtime.webhook_verified THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'WEBHOOK_NOT_VERIFIED');
        END IF;
        IF NOT v_runtime.event_ingestion_operational THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'EVENT_INGESTION_UNAVAILABLE');
        END IF;
        IF NOT v_runtime.event_processor_operational THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'EVENT_PROCESSOR_UNAVAILABLE');
        END IF;
        IF NOT v_runtime.message_executor_operational THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'MESSAGE_EXECUTOR_UNAVAILABLE');
        END IF;
        IF NOT v_runtime.retry_policy_verified THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'RETRY_POLICY_UNVERIFIED');
        END IF;
        IF NOT v_runtime.idempotency_verified THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'IDEMPOTENCY_UNVERIFIED');
        END IF;
        IF v_runtime.last_verified_at IS NULL
           OR v_runtime.last_verified_at > pg_catalog.clock_timestamp()
           OR v_runtime.last_verified_at < pg_catalog.clock_timestamp() - INTERVAL '5 minutes' THEN
            v_blockers := pg_catalog.array_append(v_blockers, 'READINESS_NOT_VERIFIED');
        END IF;
    END IF;

    RETURN v_blockers;
END;
$$;

REVOKE ALL ON FUNCTION public.automation_execution_readiness_blockers(UUID)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_automation_execution_readiness(
    p_automation_id UUID
)
RETURNS TABLE (
    automation_id UUID,
    ready BOOLEAN,
    blockers TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_owner_id UUID := auth.uid();
    v_id UUID;
    v_blockers TEXT[];
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
    END IF;

    IF p_automation_id IS NOT NULL THEN
        v_blockers := public.automation_execution_readiness_blockers(p_automation_id);
        automation_id := p_automation_id;
        blockers := v_blockers;
        ready := pg_catalog.cardinality(v_blockers) = 0;
        RETURN NEXT;
        RETURN;
    END IF;

    FOR v_id IN
        SELECT automation.id
        FROM public.automations AS automation
        WHERE automation.owner_id = v_owner_id
    LOOP
        v_blockers := public.automation_execution_readiness_blockers(v_id);
        automation_id := v_id;
        blockers := v_blockers;
        ready := pg_catalog.cardinality(v_blockers) = 0;
        RETURN NEXT;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_automation_execution_readiness(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_automation_execution_readiness(UUID)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_automation_lifecycle(
    p_automation_id UUID,
    p_action TEXT
)
RETURNS TABLE (
    status TEXT,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_owner_id UUID := auth.uid();
    v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
    v_current_status TEXT;
    v_next_status TEXT;
    v_automation_owner_id UUID;
    v_instagram_account_id UUID;
    v_locked_account_id UUID;
    v_blockers TEXT[];
BEGIN
    IF v_owner_id IS NULL AND NOT v_is_service_role THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
    END IF;

    SELECT
        automation.owner_id,
        automation.instagram_account_id
    INTO
        v_automation_owner_id,
        v_instagram_account_id
    FROM public.automations AS automation
    WHERE automation.id = p_automation_id
      AND (v_is_service_role OR automation.owner_id = v_owner_id);

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'NOT_FOUND';
    END IF;

    IF v_is_service_role THEN
        IF p_action <> 'PAUSE'
           OR EXISTS (
               SELECT 1
               FROM public.instagram_accounts AS account
               WHERE account.id = v_instagram_account_id
                 AND account.connection_status = 'CONNECTED'
           ) THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'UNAUTHORIZED';
        END IF;
    ELSIF p_action IN ('ACTIVATE', 'RESUME') THEN
        SELECT account.id
        INTO v_locked_account_id
        FROM public.instagram_accounts AS account
        WHERE account.id = v_instagram_account_id
          AND account.owner_id = v_automation_owner_id
        FOR SHARE;
    END IF;

    SELECT
        automation.status,
        automation.instagram_account_id
    INTO
        v_current_status,
        v_locked_account_id
    FROM public.automations AS automation
    WHERE automation.id = p_automation_id
      AND automation.owner_id = v_automation_owner_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'NOT_FOUND';
    END IF;

    IF v_locked_account_id IS DISTINCT FROM v_instagram_account_id THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'AUTOMATION_ACCOUNT_CHANGED';
    END IF;

    IF p_action = 'PAUSE' AND v_current_status = 'ACTIVE' THEN
        v_next_status := 'PAUSED';
    ELSIF p_action = 'ACTIVATE' AND v_current_status = 'DRAFT' THEN
        v_next_status := 'ACTIVE';
    ELSIF p_action = 'RESUME' AND v_current_status = 'PAUSED' THEN
        v_next_status := 'ACTIVE';
    ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_TRANSITION';
    END IF;

    IF p_action IN ('ACTIVATE', 'RESUME') THEN
        v_blockers := public.automation_execution_readiness_blockers(p_automation_id);
        IF v_blockers @> ARRAY['ACCOUNT_NOT_CONNECTED']::TEXT[] THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCOUNT_NOT_CONNECTED';
        END IF;
        IF pg_catalog.cardinality(v_blockers) > 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'EXECUTION_NOT_READY',
                DETAIL = pg_catalog.array_to_json(v_blockers)::TEXT;
        END IF;
    END IF;

    INSERT INTO public.automation_lifecycle_transition_permits (
        transaction_id,
        automation_id,
        owner_id,
        previous_status,
        target_status,
        action
    )
    VALUES (
        pg_catalog.txid_current(),
        p_automation_id,
        v_automation_owner_id,
        v_current_status,
        v_next_status,
        p_action
    );

    RETURN QUERY
    UPDATE public.automations AS target
    SET
        status = v_next_status,
        updated_at = pg_catalog.clock_timestamp()
    WHERE target.id = p_automation_id
      AND target.owner_id = v_automation_owner_id
    RETURNING target.status, target.updated_at;

    IF EXISTS (
        SELECT 1
        FROM public.automation_lifecycle_transition_permits AS permit
        WHERE permit.transaction_id = pg_catalog.txid_current()
          AND permit.automation_id = p_automation_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'LIFECYCLE_TRANSITION_PERMIT_NOT_CONSUMED';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_automation_lifecycle(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_automation_lifecycle(UUID, TEXT)
    TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pause_automations_after_account_disconnect()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_automation_id UUID;
BEGIN
    IF OLD.connection_status = NEW.connection_status
       OR NEW.connection_status = 'CONNECTED' THEN
        RETURN NEW;
    END IF;

    FOR v_automation_id IN
        SELECT automation.id
        FROM public.automations AS automation
        WHERE automation.instagram_account_id = NEW.id
          AND automation.owner_id = NEW.owner_id
          AND automation.status = 'ACTIVE'
    LOOP
        PERFORM public.transition_automation_lifecycle(v_automation_id, 'PAUSE');
    END LOOP;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pause_automations_after_account_disconnect()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER pause_automations_after_account_disconnect
    AFTER UPDATE OF connection_status ON public.instagram_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.pause_automations_after_account_disconnect();

COMMIT;
