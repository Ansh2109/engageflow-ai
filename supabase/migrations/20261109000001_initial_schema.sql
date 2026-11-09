-- ==============================================================================
-- ENGAGEFLOW AI — PHASE 3 DATABASE MIGRATION (SECURITY-HARDENED V2)
-- Migration: 20261109000001_initial_schema.sql
-- Description: Core multi-tenant tables, strict RLS, compound FKs, and triggers.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. EXTENSIONS & UTILITIES
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- Generic updated_at timestamp trigger function with hardened search_path
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

-- Revoke public execution rights on utility trigger function
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_updated_at() TO postgres, service_role;

-- ------------------------------------------------------------------------------
-- 1. PROFILES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Revoke default public permissions; explicitly grant minimal required access
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
GRANT SELECT, UPDATE, INSERT ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

-- Profiles RLS Policies: Customers can only select/update their own profile
CREATE POLICY "profiles_select_own"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = id);

CREATE POLICY "profiles_update_own"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = id)
    WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY "profiles_insert_own"
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = id);

CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- Hardened trigger function for automatic profile creation on auth.users signup
-- - Fixed search_path = '' prevents search-path hijacking
-- - Input sanitization & truncation protects against malicious metadata payloads
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_raw_name TEXT;
    v_sanitized_name TEXT;
    v_sanitized_email TEXT;
BEGIN
    -- Extract and normalize full_name: trim surrounding whitespace and truncate
    v_raw_name := NEW.raw_user_meta_data->>'full_name';
    IF v_raw_name IS NOT NULL THEN
        v_sanitized_name := pg_catalog.substr(pg_catalog.btrim(v_raw_name), 1, 255);
    ELSE
        v_sanitized_name := '';
    END IF;

    -- Extract and sanitize email: truncate to 255 chars
    IF NEW.email IS NOT NULL THEN
        v_sanitized_email := pg_catalog.substr(pg_catalog.btrim(NEW.email), 1, 255);
    ELSE
        v_sanitized_email := NULL;
    END IF;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (NEW.id, v_sanitized_name, v_sanitized_email)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 2. INSTAGRAM ACCOUNTS TABLE (Public metadata only - NO tokens)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instagram_accounts (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    instagram_business_id TEXT NOT NULL,
    facebook_page_id TEXT,
    username TEXT NOT NULL,
    name TEXT,
    profile_picture_url TEXT,
    account_type TEXT DEFAULT 'BUSINESS' NOT NULL 
        CHECK (account_type IN ('BUSINESS', 'CREATOR', 'UNKNOWN')),
    connection_status TEXT DEFAULT 'CONNECTED' NOT NULL 
        CHECK (connection_status IN ('CONNECTED', 'EXPIRED', 'REVOKED', 'DISCONNECTED')),
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    -- GLOBAL UNIQUENESS: A single Instagram Professional account can only be claimed
    -- by one active EngageFlow tenant at a time. This guarantees deterministic webhook
    -- routing and prevents duplicate automation conflicts.
    CONSTRAINT unique_instagram_business_id UNIQUE (instagram_business_id),
    -- Relational integrity anchor: downstream tables enforce compound ownership
    CONSTRAINT unique_instagram_account_owner UNIQUE (id, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_owner ON public.instagram_accounts (owner_id);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_business_id ON public.instagram_accounts (instagram_business_id);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_status ON public.instagram_accounts (connection_status);

ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;

-- RESTRICT CUSTOMER PRIVILEGES:
-- Customers are permitted ONLY to SELECT their own account metadata.
-- INSERT, UPDATE, and DELETE are strictly restricted to trusted server-side
-- OAuth connection and disconnection operations executed via service_role.
REVOKE ALL ON TABLE public.instagram_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.instagram_accounts TO authenticated;
GRANT ALL ON TABLE public.instagram_accounts TO service_role;

CREATE POLICY "instagram_accounts_select_own"
    ON public.instagram_accounts
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = owner_id);

CREATE TRIGGER set_instagram_accounts_updated_at
    BEFORE UPDATE ON public.instagram_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 3. INSTAGRAM ACCOUNT TOKENS TABLE (Isolated, Server-Only Secret Vault)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instagram_account_tokens (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    instagram_account_id UUID NOT NULL UNIQUE REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    encrypted_access_token TEXT NOT NULL,
    token_type TEXT DEFAULT 'BEARER' NOT NULL,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[] DEFAULT '{}'::TEXT[] NOT NULL,
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    -- Compound foreign key ensures token row cannot mismatch the account's owner
    CONSTRAINT fk_account_tokens_owner 
        FOREIGN KEY (instagram_account_id, owner_id) 
        REFERENCES public.instagram_accounts(id, owner_id) 
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_instagram_account_tokens_account ON public.instagram_account_tokens (instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_instagram_account_tokens_owner ON public.instagram_account_tokens (owner_id);

-- CRITICAL PRIVILEGE HARDENING:
-- RLS is enabled with ZERO policies for authenticated or anon roles.
-- Table permissions are completely revoked from PUBLIC, authenticated, and anon.
-- Only service_role (createAdminClient on the server) has access.
ALTER TABLE public.instagram_account_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.instagram_account_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.instagram_account_tokens TO service_role;

CREATE TRIGGER set_instagram_account_tokens_updated_at
    BEFORE UPDATE ON public.instagram_account_tokens
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 4. AUTOMATIONS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automations (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    instagram_account_id UUID NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    automation_type TEXT NOT NULL 
        CHECK (automation_type IN ('COMMENT_TO_DM', 'DM_KEYWORD')),
    status TEXT DEFAULT 'ACTIVE' NOT NULL 
        CHECK (status IN ('ACTIVE', 'PAUSED')),
    target_post_id TEXT,
    target_post_url TEXT,
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    -- Compound unique anchor for triggers, actions, and activity logs
    CONSTRAINT unique_automation_owner UNIQUE (id, owner_id),
    -- STRICT DATABASE-LEVEL ENFORCEMENT:
    -- Compound foreign key ensures an automation can NEVER be attached to an
    -- Instagram account owned by a different user.
    CONSTRAINT fk_automations_account_ownership 
        FOREIGN KEY (instagram_account_id, owner_id) 
        REFERENCES public.instagram_accounts(id, owner_id) 
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_automations_owner ON public.automations (owner_id);
CREATE INDEX IF NOT EXISTS idx_automations_account ON public.automations (instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_automations_status ON public.automations (status);
CREATE INDEX IF NOT EXISTS idx_automations_type ON public.automations (automation_type);
CREATE INDEX IF NOT EXISTS idx_automations_post_lookup ON public.automations (instagram_account_id, target_post_id) 
    WHERE status = 'ACTIVE';

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.automations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automations TO authenticated;
GRANT ALL ON TABLE public.automations TO service_role;

CREATE POLICY "automations_select_own"
    ON public.automations
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "automations_insert_own"
    ON public.automations
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT auth.uid()) = owner_id
        AND EXISTS (
            SELECT 1 FROM public.instagram_accounts acc
            WHERE acc.id = instagram_account_id
              AND acc.owner_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "automations_update_own"
    ON public.automations
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = owner_id)
    WITH CHECK (
        (SELECT auth.uid()) = owner_id
        AND EXISTS (
            SELECT 1 FROM public.instagram_accounts acc
            WHERE acc.id = instagram_account_id
              AND acc.owner_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "automations_delete_own"
    ON public.automations
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = owner_id);

CREATE TRIGGER set_automations_updated_at
    BEFORE UPDATE ON public.automations
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 5. AUTOMATION TRIGGERS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_triggers (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL 
        CHECK (trigger_type IN ('COMMENT_KEYWORD', 'DM_KEYWORD')),
    keyword TEXT NOT NULL,
    match_type TEXT DEFAULT 'CONTAINS' NOT NULL 
        CHECK (match_type IN ('EXACT', 'CONTAINS')),
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_triggers_automation ON public.automation_triggers (automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_triggers_keyword ON public.automation_triggers (pg_catalog.lower(keyword));

ALTER TABLE public.automation_triggers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.automation_triggers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automation_triggers TO authenticated;
GRANT ALL ON TABLE public.automation_triggers TO service_role;

CREATE POLICY "automation_triggers_select_own"
    ON public.automation_triggers
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "automation_triggers_insert_own"
    ON public.automation_triggers
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "automation_triggers_update_own"
    ON public.automation_triggers
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "automation_triggers_delete_own"
    ON public.automation_triggers
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    );

-- ------------------------------------------------------------------------------
-- 6. AUTOMATION ACTIONS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_actions (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL 
        CHECK (action_type IN ('SEND_DM', 'REPLY_COMMENT', 'SEND_DM_AND_REPLY_COMMENT')),
    message_text TEXT NOT NULL,
    public_comment_reply_text TEXT,
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_actions_automation ON public.automation_actions (automation_id);

ALTER TABLE public.automation_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.automation_actions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automation_actions TO authenticated;
GRANT ALL ON TABLE public.automation_actions TO service_role;

CREATE POLICY "automation_actions_select_own"
    ON public.automation_actions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "automation_actions_insert_own"
    ON public.automation_actions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "automation_actions_update_own"
    ON public.automation_actions
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "automation_actions_delete_own"
    ON public.automation_actions
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.automations a
            WHERE a.id = automation_id
              AND a.owner_id = (SELECT auth.uid())
        )
    );

CREATE TRIGGER set_automation_actions_updated_at
    BEFORE UPDATE ON public.automation_actions
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 7. WEBHOOK EVENTS TABLE (Deduplication, Queue Ingestion, Server-Only)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    instagram_account_id UUID REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
    external_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_payload JSONB NOT NULL,
    processing_status TEXT DEFAULT 'PENDING' NOT NULL 
        CHECK (processing_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DUPLICATE', 'IGNORED')),
    attempts INTEGER DEFAULT 0 NOT NULL,
    error_message TEXT,
    received_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    processed_at TIMESTAMPTZ,
    -- IDEMPOTENCY: Meta external_event_id (comment ID or message mid) is globally unique
    -- per event type. This guarantees duplicate webhook deliveries cannot be queued.
    CONSTRAINT unique_external_event_per_type UNIQUE (external_event_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON public.webhook_events (processing_status, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_account ON public.webhook_events (instagram_account_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_dedup ON public.webhook_events (external_event_id, event_type);

-- CRITICAL PRIVILEGE HARDENING:
-- RLS enabled with ZERO policies for authenticated or anon.
-- Permissions completely revoked from PUBLIC, anon, and authenticated.
-- Webhook ingestion & background worker run exclusively via service_role.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;

-- ------------------------------------------------------------------------------
-- 8. ACTIVITY LOGS TABLE (Customer Audit Trail & Execution History)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    instagram_account_id UUID,
    automation_id UUID,
    webhook_event_id UUID REFERENCES public.webhook_events(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL 
        CHECK (status IN ('RECEIVED', 'PROCESSING', 'MATCHED', 'SENT', 'FAILED', 'SKIPPED')),
    trigger_keyword TEXT,
    recipient_id TEXT,
    error_code TEXT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    -- COLUMN-SPECIFIC ON DELETE SET NULL (PostgreSQL 15+ compatible):
    -- Explicitly nulls ONLY instagram_account_id and automation_id when an account
    -- or automation is deleted, leaving owner_id intact and preserving audit history.
    CONSTRAINT fk_activity_logs_account_ownership
        FOREIGN KEY (instagram_account_id, owner_id)
        REFERENCES public.instagram_accounts(id, owner_id)
        ON DELETE SET NULL (instagram_account_id),
    CONSTRAINT fk_activity_logs_automation_ownership
        FOREIGN KEY (automation_id, owner_id)
        REFERENCES public.automations(id, owner_id)
        ON DELETE SET NULL (automation_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_owner_time ON public.activity_logs (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_automation ON public.activity_logs (automation_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_status ON public.activity_logs (status);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- CRITICAL AUDIT LOG HARDENING:
-- Authenticated customers can ONLY SELECT their own activity logs.
-- Customer INSERT, UPDATE, and DELETE are strictly disallowed.
-- Activity records are append-only, written solely by server-side workers via service_role.
REVOKE ALL ON TABLE public.activity_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.activity_logs TO authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;

CREATE POLICY "activity_logs_select_own"
    ON public.activity_logs
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = owner_id);
