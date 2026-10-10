import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { handleWhatsAppRequest } from "@/lib/whatsapp/api";
import { getWhatsAppRegistry } from "@/lib/whatsapp/runtime";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
	const { user, error } = await requireSessionUser(getEnv(), request);
	if (error) return error;
	return handleWhatsAppRequest(request, user.id, getWhatsAppRegistry());
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
