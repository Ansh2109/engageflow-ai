ALTER TABLE public.instagram_business_connections
    ALTER COLUMN client_business_id DROP NOT NULL,
    ALTER COLUMN system_user_id DROP NOT NULL,
    ALTER COLUMN config_id DROP NOT NULL;

ALTER TABLE public.instagram_business_connections
    ADD COLUMN login_type TEXT DEFAULT 'UNIFIED_LOGIN' NOT NULL
        CHECK (login_type IN ('UNIFIED_LOGIN', 'INSTAGRAM_LOGIN')),
    ADD COLUMN instagram_user_id TEXT
        CHECK (instagram_user_id IS NULL OR instagram_user_id ~ '^[0-9]+$');

CREATE UNIQUE INDEX unique_instagram_login_user_connection
    ON public.instagram_business_connections (owner_id, instagram_user_id)
    WHERE login_type = 'INSTAGRAM_LOGIN'
      AND instagram_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.persist_instagram_login_connection(
    p_owner_id UUID,
    p_instagram_user_id TEXT,
    p_username TEXT,
    p_name TEXT,
    p_profile_picture_url TEXT,
    p_account_type TEXT,
    p_encrypted_access_token TEXT,
    p_token_expires_at TIMESTAMPTZ,
    p_scopes TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_connection_id UUID;
    v_account_id UUID;
BEGIN
    IF p_owner_id IS NULL
        OR p_instagram_user_id IS NULL
        OR p_instagram_user_id !~ '^[0-9]+$'
        OR p_username IS NULL
        OR pg_catalog.btrim(p_username) = ''
        OR pg_catalog.length(p_username) > 255
        OR p_account_type IS NULL
        OR p_account_type NOT IN ('BUSINESS', 'CREATOR', 'UNKNOWN')
        OR p_encrypted_access_token IS NULL
        OR p_encrypted_access_token = ''
        OR p_token_expires_at IS NULL
        OR p_token_expires_at <= pg_catalog.clock_timestamp()
        OR COALESCE(p_scopes, '{}'::TEXT[]) @> ARRAY[
            'instagram_business_basic',
            'instagram_business_manage_comments',
            'instagram_business_manage_messages',
            'instagram_business_content_publish'
        ]::TEXT[] IS NOT TRUE
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_instagram_login_connection_payload';
    END IF;

    INSERT INTO public.instagram_business_connections (
        owner_id,
        login_type,
        instagram_user_id,
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
        'INSTAGRAM_LOGIN',
        p_instagram_user_id,
        NULL,
        NULL,
        NULL,
        p_encrypted_access_token,
        p_token_expires_at,
        p_scopes,
        'CONNECTED'
    )
    ON CONFLICT (owner_id, instagram_user_id)
        WHERE login_type = 'INSTAGRAM_LOGIN'
          AND instagram_user_id IS NOT NULL
    DO UPDATE SET
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        token_expires_at = EXCLUDED.token_expires_at,
        scopes = EXCLUDED.scopes,
        connection_status = 'CONNECTED'
    RETURNING id INTO v_connection_id;

    INSERT INTO public.instagram_accounts AS existing (
        owner_id,
        connection_id,
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
        v_connection_id,
        p_instagram_user_id,
        NULL,
        p_username,
        p_name,
        p_profile_picture_url,
        p_account_type,
        'CONNECTED'
    )
    ON CONFLICT (instagram_business_id)
    DO UPDATE SET
        connection_id = EXCLUDED.connection_id,
        username = EXCLUDED.username,
        name = EXCLUDED.name,
        profile_picture_url = EXCLUDED.profile_picture_url,
        account_type = EXCLUDED.account_type,
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
        '{"connection_method":"INSTAGRAM_LOGIN"}'::JSONB
    );

    RETURN v_connection_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_instagram_login_connection(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_instagram_login_connection(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT[]
) TO service_role;
