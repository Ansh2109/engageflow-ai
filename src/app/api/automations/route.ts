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

export async function GET() {
  return (await getApi()).list();
}

export async function POST(request: Request) {
  return (await getApi()).save(request);
}
