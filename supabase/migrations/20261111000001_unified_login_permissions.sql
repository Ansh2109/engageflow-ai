CREATE OR REPLACE FUNCTION public.persist_instagram_unified_login_connection(
    p_owner_id UUID,
    p_client_business_id TEXT,
    p_system_user_id TEXT,
    p_config_id TEXT,
    p_encrypted_access_token TEXT,
    p_token_expires_at TIMESTAMPTZ,
    p_scopes TEXT[],
    p_accounts JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_connection_id UUID;
    v_account_id UUID;
    v_account JSONB;
    v_instagram_user_id TEXT;
    v_username TEXT;
BEGIN
    IF p_accounts IS NULL
        OR pg_catalog.jsonb_typeof(p_accounts) IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_instagram_unified_login_payload';
    END IF;

    IF pg_catalog.jsonb_array_length(p_accounts) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_instagram_unified_login_payload';
    END IF;

    IF p_owner_id IS NULL
        OR p_client_business_id IS NULL
        OR p_client_business_id !~ '^[0-9]+$'
        OR p_system_user_id IS NULL
        OR p_system_user_id !~ '^[0-9]+$'
        OR p_config_id IS NULL
        OR p_config_id !~ '^[0-9]+$'
        OR p_encrypted_access_token IS NULL
        OR p_encrypted_access_token = ''
        OR (p_token_expires_at IS NOT NULL
            AND p_token_expires_at <= pg_catalog.clock_timestamp())
        OR COALESCE(p_scopes, '{}'::TEXT[]) @> ARRAY[
            'instagram_basic',
            'instagram_manage_comments',
            'instagram_manage_messages',
            'instagram_content_publish'
        ]::TEXT[] IS NOT TRUE
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_instagram_unified_login_payload';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_accounts) AS item(value)
        WHERE item.value->>'id' IS NULL
            OR item.value->>'id' !~ '^[0-9]+$'
            OR item.value->>'username' IS NULL
            OR pg_catalog.btrim(item.value->>'username') = ''
            OR pg_catalog.length(item.value->>'username') > 255
    )
        OR (
            SELECT pg_catalog.count(DISTINCT item.value->>'id')
            FROM pg_catalog.jsonb_array_elements(p_accounts) AS item(value)
        ) <> pg_catalog.jsonb_array_length(p_accounts)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_instagram_unified_login_payload';
    END IF;

    INSERT INTO public.instagram_unified_login_connections (
        owner_id,
        client_business_id,
        system_user_id,
        config_id,
        encrypted_access_token,
        token_expires_at,
        scopes,
        connection_status
    )
    VALUES (
        p_owner_id,
        p_client_business_id,
        p_system_user_id,
        p_config_id,
        p_encrypted_access_token,
        p_token_expires_at,
        p_scopes,
        'CONNECTED'
    )
    ON CONFLICT (owner_id, client_business_id)
    DO UPDATE SET
        system_user_id = EXCLUDED.system_user_id,
        config_id = EXCLUDED.config_id,
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        token_expires_at = EXCLUDED.token_expires_at,
        scopes = EXCLUDED.scopes,
        connection_status = 'CONNECTED'
    RETURNING id INTO v_connection_id;

    WITH removed_accounts AS (
        UPDATE public.instagram_accounts AS account
        SET
            connection_id = NULL,
            unified_connection_id = NULL,
            connection_status = 'DISCONNECTED'
        WHERE account.owner_id = p_owner_id
          AND account.unified_connection_id = v_connection_id
          AND NOT EXISTS (
              SELECT 1
              FROM pg_catalog.jsonb_array_elements(p_accounts) AS assigned(value)
              WHERE assigned.value->>'id' = account.instagram_business_id
          )
        RETURNING account.id
    ),
    paused_automations AS (
        UPDATE public.automations AS automation
        SET
            status = 'PAUSED',
            updated_at = pg_catalog.now()
        WHERE automation.owner_id = p_owner_id
          AND automation.status = 'ACTIVE'
          AND automation.instagram_account_id IN (
              SELECT removed_accounts.id FROM removed_accounts
          )
        RETURNING automation.id
    )
    INSERT INTO public.activity_logs (
        owner_id,
        instagram_account_id,
        event_type,
        action_type,
        status,
        metadata
    )
    SELECT
        p_owner_id,
        removed_accounts.id,
        'INSTAGRAM_ACCOUNT_ACCESS_REMOVED',
        'DISCONNECT',
        'SKIPPED',
        '{"connection_method":"META_UNIFIED_LOGIN"}'::JSONB
    FROM removed_accounts;

    FOR v_account IN
        SELECT value FROM pg_catalog.jsonb_array_elements(p_accounts)
    LOOP
        v_instagram_user_id := v_account->>'id';
        v_username := v_account->>'username';

        INSERT INTO public.instagram_accounts AS existing (
            owner_id,
            connection_id,
            unified_connection_id,
            instagram_business_id,
            facebook_page_id,
            username,
            name,
            profile_picture_url,
            account_type,
            connection_status
        )
        VALUES (
            p_owner_id,
            NULL,
            v_connection_id,
            v_instagram_user_id,
            NULL,
            v_username,
            v_account->>'name',
            v_account->>'profile_picture_url',
            'UNKNOWN',
            'CONNECTED'
        )
        ON CONFLICT (instagram_business_id)
        DO UPDATE SET
            connection_id = NULL,
            unified_connection_id = EXCLUDED.unified_connection_id,
            username = EXCLUDED.username,
            name = EXCLUDED.name,
            profile_picture_url = EXCLUDED.profile_picture_url,
            connection_status = 'CONNECTED'
        WHERE existing.owner_id = EXCLUDED.owner_id
        RETURNING id INTO v_account_id;

        IF v_account_id IS NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '23505',
                MESSAGE = 'instagram_account_already_connected';
        END IF;

        INSERT INTO public.activity_logs (
            owner_id,
            instagram_account_id,
            event_type,
            action_type,
            status,
            metadata
        )
        VALUES (
            p_owner_id,
            v_account_id,
            'INSTAGRAM_ACCOUNT_CONNECTED',
            'CONNECT',
            'MATCHED',
            '{"connection_method":"META_UNIFIED_LOGIN"}'::JSONB
        );
    END LOOP;

    RETURN v_connection_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_instagram_unified_login_connection(
    UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[], JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_instagram_unified_login_connection(
    UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[], JSONB
) TO service_role;
