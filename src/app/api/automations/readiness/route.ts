import { createAutomationLifecycleApi } from "@/lib/automations/lifecycle";
import { createSupabaseAutomationLifecycleRepository } from "@/lib/automations/supabase-lifecycle";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const api = createAutomationLifecycleApi({
    getUserId: async () => {
      const { data, error } = await supabase.auth.getUser();
      return error ? null : (data.user?.id ?? null);
    },
    repository: createSupabaseAutomationLifecycleRepository(supabase),
  });
  return api.readiness();
}
