import { createAutomationDraftApi } from "@/lib/automations/drafts";
import { createSupabaseAutomationDraftRepository } from "@/lib/automations/supabase-drafts";
import { createClient } from "@/lib/supabase/server";

async function getApi() {
  const supabase = await createClient();
  return createAutomationDraftApi({
    getUserId: async () => {
      const { data, error } = await supabase.auth.getUser();
      return error ? null : (data.user?.id ?? null);
    },
    repository: createSupabaseAutomationDraftRepository(supabase),
  });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  return (await getApi()).get(id);
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return (await getApi()).save(request, id);
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return (await getApi()).delete(request, id);
}
