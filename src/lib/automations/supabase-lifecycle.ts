import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AutomationLifecycleAction,
  AutomationLifecycleEventAction,
  AutomationStatus,
  Database,
} from "@/types/database";
import type {
  AutomationExecutionReadiness,
  AutomationLifecycleHistory,
  AutomationLifecycleRepository,
  AutomationLifecycleResult,
} from "./lifecycle";

export function createSupabaseAutomationLifecycleRepository(
  supabase: SupabaseClient<Database>
): AutomationLifecycleRepository {
  return {
    async transition(
      automationId: string,
      action: AutomationLifecycleAction
    ): Promise<AutomationLifecycleResult> {
      const { data, error } = await supabase.rpc(
        "transition_automation_lifecycle",
        {
          p_automation_id: automationId,
          p_action: action,
        }
      );
      if (error) throw error;
      const result = data?.[0];
      if (!result) throw new Error("Lifecycle transition returned no result.");
      return {
        status: result.status,
        updatedAt: result.updated_at,
      };
    },

    async history(
      ownerId: string,
      automationId: string
    ): Promise<AutomationLifecycleHistory | null> {
      const { data: automation, error: automationError } = await supabase
        .from("automations")
        .select("id, status, created_at")
        .eq("id", automationId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (automationError) throw automationError;
      if (!automation) return null;

      const { data: events, error: eventsError } = await supabase
        .from("automation_lifecycle_events")
        .select("id, action, previous_status, new_status, created_at")
        .eq("automation_id", automationId)
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: true });
      if (eventsError) throw eventsError;

      return {
        currentStatus: automation.status as AutomationStatus,
        createdAt: automation.created_at,
        events: (events ?? []).map((event) => ({
          id: event.id,
          action: event.action as AutomationLifecycleEventAction,
          previousStatus: event.previous_status,
          newStatus: event.new_status,
          createdAt: event.created_at,
        })),
      };
    },

    async readiness(): Promise<AutomationExecutionReadiness[]> {
      const { data, error } = await supabase.rpc(
        "get_automation_execution_readiness",
        { p_automation_id: null }
      );
      if (error) throw error;
      return (data ?? []).map((item) => ({
        automationId: item.automation_id,
        ready: item.ready,
        blockers: item.blockers,
      }));
    },
  };
}
