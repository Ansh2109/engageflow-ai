CREATE TABLE public.instagram_oauth_states (
    nonce_hash TEXT PRIMARY KEY
        CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT instagram_oauth_states_valid_lifetime
        CHECK (
            expires_at > issued_at
            AND expires_at <= issued_at + INTERVAL '10 minutes'
        )
);

CREATE INDEX idx_instagram_oauth_states_expiry
    ON public.instagram_oauth_states (expires_at);

ALTER TABLE public.instagram_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.instagram_oauth_states
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_instagram_oauth_state(
    p_nonce_hash TEXT,
    p_user_id UUID,
    p_issued_at TIMESTAMPTZ,
    p_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
    IF p_nonce_hash IS NULL
        OR p_nonce_hash !~ '^[0-9a-f]{64}$'
        OR p_user_id IS NULL
        OR p_issued_at IS NULL
        OR p_expires_at IS NULL
        OR p_issued_at > pg_catalog.clock_timestamp()
        OR p_expires_at <= pg_catalog.clock_timestamp()
        OR p_expires_at <= p_issued_at
        OR p_expires_at > p_issued_at + INTERVAL '10 minutes'
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_instagram_oauth_state';
    END IF;

    DELETE FROM public.instagram_oauth_states
    WHERE expires_at <= pg_catalog.clock_timestamp();

    INSERT INTO public.instagram_oauth_states (
        nonce_hash,
        user_id,
        issued_at,
        expires_at
    )
    VALUES (
        p_nonce_hash,
        p_user_id,
        p_issued_at,
        p_expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_instagram_oauth_state(
    p_nonce_hash TEXT,
    p_user_id UUID,
    p_issued_at TIMESTAMPTZ,
    p_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_consumed BOOLEAN;
BEGIN
    IF p_nonce_hash IS NULL
        OR p_nonce_hash !~ '^[0-9a-f]{64}$'
        OR p_user_id IS NULL
        OR p_issued_at IS NULL
        OR p_expires_at IS NULL
    THEN
        RETURN FALSE;
    END IF;

    UPDATE public.instagram_oauth_states
    SET consumed_at = pg_catalog.clock_timestamp()
    WHERE nonce_hash = p_nonce_hash
      AND user_id = p_user_id
      AND issued_at = p_issued_at
      AND expires_at = p_expires_at
      AND consumed_at IS NULL
      AND issued_at <= pg_catalog.clock_timestamp()
      AND expires_at > pg_catalog.clock_timestamp()
      AND expires_at <= issued_at + INTERVAL '10 minutes'
    RETURNING TRUE INTO v_consumed;

    RETURN COALESCE(v_consumed, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.create_instagram_oauth_state(
    TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_instagram_oauth_state(
    TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.consume_instagram_oauth_state(
    TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_instagram_oauth_state(
    TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
