import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { handleWhatsAppMessages } from "@/lib/whatsapp/messages-api";
import { getWhatsAppRegistry } from "@/lib/whatsapp/runtime";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const { user, error } = await requireSessionUser(getEnv(), request);
  if (error) return error;
  return handleWhatsAppMessages(
    request,
    user.id,
    getWhatsAppRegistry(),
    "history",
  );
}
export const POST = handle;
