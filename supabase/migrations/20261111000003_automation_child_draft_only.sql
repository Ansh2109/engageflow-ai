-- Limit authenticated child-row mutations to owner-owned draft automations.
BEGIN;

DROP POLICY IF EXISTS "automation_triggers_insert_own"
    ON public.automation_triggers;
CREATE POLICY "automation_triggers_insert_own"
    ON public.automation_triggers
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.automations AS automation
            WHERE automation.id = automation_id
              AND automation.owner_id = (SELECT auth.uid())
              AND automation.status = 'DRAFT'
        )
    );

DROP POLICY IF EXISTS "automation_triggers_update_own"
    ON public.automation_triggers;
CREATE POLICY "automation_triggers_update_own"
    ON public.automation_triggers
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.automations AS automation
            WHERE automation.id = automation_id
              AND automation.owner_id = (SELECT auth.uid())
              AND automation.status = 'DRAFT'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.automations AS automation
            WHERE automation.id = automation_id
              AND automation.owner_id = (SELECT auth.uid())
              AND automation.status = 'DRAFT'
        )
    );

DROP POLICY IF EXISTS "automation_triggers_delete_own"
    ON public.automation_triggers;
CREATE POLICY "automation_triggers_delete_own"
    ON public.automation_triggers
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.automations AS automation
            WHERE automation.id = automation_id
              AND automation.owner_id = (SELECT auth.uid())
              AND automation.status = 'DRAFT'
        )
    );

DROP POLICY IF EXISTS "automation_actions_insert_own"
    ON public.automation_actions;
CREATE POLICY "automation_actions_insert_own"
    ON public.automation_actions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.automations AS automation
            WHERE automation.id = automation_id
              AND automation.owner_id = (SELECT auth.uid())
              AND automation.status = 'DRAFT'
        )
    );

DROP POLICY IF EXISTS "automation_actions_update_own"
    ON public.automation_actions;
CREATE POLICY "automation_actions_update_own"
    ON public.automation_actions
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.automations AS automation
            WHERE automation.id = automation_id
              AND automation.owner_id = (SELECT auth.uid())
              AND automation.status = 'DRAFT'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.automations AS automation
            WHERE automation.id = automation_id
              AND automation.owner_id = (SELECT auth.uid())
              AND automation.status = 'DRAFT'
        )
    );

DROP POLICY IF EXISTS "automation_actions_delete_own"
    ON public.automation_actions;
CREATE POLICY "automation_actions_delete_own"
    ON public.automation_actions
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.automations AS automation
            WHERE automation.id = automation_id
              AND automation.owner_id = (SELECT auth.uid())
              AND automation.status = 'DRAFT'
        )
    );

COMMIT;
