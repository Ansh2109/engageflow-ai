import { createAutomationLifecycleApi } from "@/lib/automations/lifecycle";
import { createSupabaseAutomationLifecycleRepository } from "@/lib/automations/supabase-lifecycle";
import { createClient } from "@/lib/supabase/server";

async function getApi() {
  const supabase = await createClient();
  return createAutomationLifecycleApi({
    getUserId: async () => {
      const { data, error } = await supabase.auth.getUser();
      return error ? null : (data.user?.id ?? null);
    },
    repository: createSupabaseAutomationLifecycleRepository(supabase),
  });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  return (await getApi()).history(id);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return (await getApi()).transition(request, id);
}
