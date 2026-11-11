-- Additive storage and RLS enforcement for Comment-to-DM draft editing.
BEGIN;
ALTER TABLE public.automations
    ADD COLUMN IF NOT EXISTS target_media_type TEXT;

ALTER TABLE public.automations
    DROP CONSTRAINT IF EXISTS automations_target_media_type_check;

ALTER TABLE public.automations
    ADD CONSTRAINT automations_target_media_type_check
    CHECK (
        target_media_type IS NULL
        OR target_media_type IN ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')
    );

ALTER TABLE public.automations
    DROP CONSTRAINT IF EXISTS automations_status_check;

ALTER TABLE public.automations
    ALTER COLUMN status SET DEFAULT 'DRAFT',
    ADD CONSTRAINT automations_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED'));

ALTER TABLE public.automation_actions
    ADD COLUMN IF NOT EXISTS public_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.automation_actions
SET public_reply_enabled = TRUE
WHERE public_comment_reply_text IS NOT NULL;

DROP POLICY IF EXISTS "automations_insert_own" ON public.automations;
CREATE POLICY "automations_insert_own"
    ON public.automations
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT auth.uid()) = owner_id
        AND status = 'DRAFT'
        AND EXISTS (
            SELECT 1
            FROM public.instagram_accounts AS account
            WHERE account.id = instagram_account_id
              AND account.owner_id = (SELECT auth.uid())
              AND account.connection_status = 'CONNECTED'
        )
    );

DROP POLICY IF EXISTS "automations_update_own" ON public.automations;
CREATE POLICY "automations_update_own"
    ON public.automations
    FOR UPDATE
    TO authenticated
    USING (
        (SELECT auth.uid()) = owner_id
        AND status = 'DRAFT'
    )
    WITH CHECK (
        (SELECT auth.uid()) = owner_id
        AND status = 'DRAFT'
        AND EXISTS (
            SELECT 1
            FROM public.instagram_accounts AS account
            WHERE account.id = instagram_account_id
              AND account.owner_id = (SELECT auth.uid())
              AND account.connection_status = 'CONNECTED'
        )
    );

CREATE OR REPLACE FUNCTION public.save_comment_to_dm_draft(
    p_automation_id UUID,
    p_instagram_account_id UUID,
    p_name TEXT,
    p_media_id TEXT,
    p_media_type TEXT,
    p_match_type TEXT,
    p_keywords TEXT[],
    p_message_text TEXT,
    p_public_reply_enabled BOOLEAN,
    p_public_comment_reply_text TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID := auth.uid();
    v_automation_id UUID;
    v_keyword TEXT;
BEGIN
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF p_name IS NULL
       OR pg_catalog.char_length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120
       OR p_media_id IS NULL
       OR p_media_id !~ '^[0-9]{1,32}$'
       OR p_media_type IS NULL
       OR p_media_type NOT IN ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')
       OR p_match_type IS NULL
       OR p_match_type NOT IN ('EXACT', 'CONTAINS')
       OR p_keywords IS NULL
       OR pg_catalog.cardinality(p_keywords) NOT BETWEEN 1 AND 20
       OR p_message_text IS NULL
       OR pg_catalog.char_length(pg_catalog.btrim(p_message_text)) NOT BETWEEN 1 AND 2200
       OR p_public_reply_enabled IS NULL
       OR (
           p_public_comment_reply_text IS NOT NULL
           AND pg_catalog.char_length(p_public_comment_reply_text) > 2200
       )
       OR (
           p_public_reply_enabled
           AND (
               p_public_comment_reply_text IS NULL
               OR pg_catalog.char_length(
                   pg_catalog.btrim(p_public_comment_reply_text)
               ) NOT BETWEEN 1 AND 2200
           )
       )
    THEN
        RAISE EXCEPTION 'Invalid Comment-to-DM draft' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(p_keywords) AS keyword(value)
        WHERE keyword.value IS NULL
           OR pg_catalog.char_length(pg_catalog.btrim(keyword.value)) NOT BETWEEN 1 AND 64
    ) OR (
        SELECT pg_catalog.count(DISTINCT pg_catalog.lower(pg_catalog.btrim(keyword.value)))
        FROM pg_catalog.unnest(p_keywords) AS keyword(value)
    ) <> pg_catalog.cardinality(p_keywords) THEN
        RAISE EXCEPTION 'Invalid Comment-to-DM keywords' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.instagram_accounts AS account
        WHERE account.id = p_instagram_account_id
          AND account.owner_id = v_owner_id
          AND account.connection_status = 'CONNECTED'
    ) THEN
        RAISE EXCEPTION 'Connected Instagram account not found' USING ERRCODE = 'P0002';
    END IF;

    IF p_automation_id IS NULL THEN
        INSERT INTO public.automations (
            owner_id,
            instagram_account_id,
            name,
            automation_type,
            status,
            target_post_id,
            target_media_type
        )
        VALUES (
            v_owner_id,
            p_instagram_account_id,
            pg_catalog.btrim(p_name),
            'COMMENT_TO_DM',
            'DRAFT',
            p_media_id,
            p_media_type
        )
        RETURNING id INTO v_automation_id;
    ELSE
        UPDATE public.automations
        SET
            instagram_account_id = p_instagram_account_id,
            name = pg_catalog.btrim(p_name),
            automation_type = 'COMMENT_TO_DM',
            status = 'DRAFT',
            target_post_id = p_media_id,
            target_media_type = p_media_type
        WHERE id = p_automation_id
          AND owner_id = v_owner_id
          AND automation_type = 'COMMENT_TO_DM'
          AND status = 'DRAFT'
        RETURNING id INTO v_automation_id;

        IF v_automation_id IS NULL THEN
            RAISE EXCEPTION 'Draft not found' USING ERRCODE = 'P0002';
        END IF;

        DELETE FROM public.automation_triggers
        WHERE automation_id = v_automation_id;

        DELETE FROM public.automation_actions
        WHERE automation_id = v_automation_id;
    END IF;

    FOREACH v_keyword IN ARRAY p_keywords LOOP
        INSERT INTO public.automation_triggers (
            automation_id,
            trigger_type,
            keyword,
            match_type
        )
        VALUES (
            v_automation_id,
            'COMMENT_KEYWORD',
            pg_catalog.btrim(v_keyword),
            p_match_type
        );
    END LOOP;

    INSERT INTO public.automation_actions (
        automation_id,
        action_type,
        message_text,
        public_comment_reply_text,
        public_reply_enabled
    )
    VALUES (
        v_automation_id,
        CASE
            WHEN p_public_reply_enabled THEN 'SEND_DM_AND_REPLY_COMMENT'
            ELSE 'SEND_DM'
        END,
        p_message_text,
        p_public_comment_reply_text,
        p_public_reply_enabled
    );

    RETURN v_automation_id;
END;
$$;

REVOKE ALL PRIVILEGES ON TABLE
    public.automations,
    public.automation_triggers,
    public.automation_actions
FROM PUBLIC, anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
    public.automations,
    public.automation_triggers,
    public.automation_actions
FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.automations,
    public.automation_triggers,
    public.automation_actions
TO authenticated;

REVOKE EXECUTE ON FUNCTION public.save_comment_to_dm_draft(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_comment_to_dm_draft(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, TEXT
) TO authenticated;
COMMIT;