-- Instagram API with Unified Login returns one business-scoped token that can
-- authorize multiple Instagram accounts. Keep that token on a shared,
-- server-only business connection rather than duplicating it per account.
CREATE TABLE public.instagram_business_connections (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_business_id TEXT NOT NULL,
    system_user_id TEXT NOT NULL,
    config_id TEXT NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[] DEFAULT '{}'::TEXT[] NOT NULL,
    connection_status TEXT DEFAULT 'CONNECTED' NOT NULL
        CHECK (connection_status IN ('CONNECTED', 'EXPIRED', 'REVOKED')),
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    CONSTRAINT unique_instagram_business_connection
        UNIQUE (owner_id, client_business_id),
    CONSTRAINT unique_instagram_business_connection_owner
        UNIQUE (id, owner_id)
);

ALTER TABLE public.instagram_accounts
    ADD COLUMN connection_id UUID;

ALTER TABLE public.instagram_accounts
    ADD CONSTRAINT fk_instagram_accounts_connection_owner
    FOREIGN KEY (connection_id, owner_id)
    REFERENCES public.instagram_business_connections(id, owner_id)
    ON DELETE SET NULL (connection_id);

CREATE INDEX idx_instagram_accounts_connection
    ON public.instagram_accounts (connection_id);

ALTER TABLE public.instagram_business_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.instagram_business_connections
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.instagram_business_connections TO service_role;

CREATE TRIGGER set_instagram_business_connections_updated_at
    BEFORE UPDATE ON public.instagram_business_connections
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
