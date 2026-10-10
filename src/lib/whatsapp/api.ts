import { hasValidSessionMutationOrigin } from "../auth/origin";
import type { WhatsAppService } from "./types";
export async function handleWhatsAppRequest(
	request: Request,
	userId: string,
	service: WhatsAppService | undefined,
): Promise<Response> {
	const headers = { "Cache-Control": "no-store" };
	if (request.method !== "GET" && !hasValidSessionMutationOrigin(request))
		return Response.json({ error: "Invalid origin" }, { status: 403, headers });
	if (!service) {
		return Response.json(
			{
				available: false,
				state: "disconnected",
				qrDataUrl: null,
				account: null,
				error: request.method === "GET" ? null : "Enable WhatsApp in the self-hosted Node server.",
			},
			{ status: request.method === "GET" ? 200 : 503, headers },
		);
	}
	try {
		if (request.method === "POST") return Response.json(await service.connect(userId), { headers });
		if (request.method === "DELETE") {
			await service.disconnect(userId);
			return Response.json(await service.status(userId), { headers });
		}
		return Response.json(await service.status(userId), { headers });
	} catch (error) {
		const limit = error instanceof Error && error.message.includes("limit");
		return Response.json(
			{
				error: limit
					? "WhatsApp connection limit reached. Ask your administrator to raise it."
					: "Unable to update your WhatsApp connection. Try again.",
			},
			{ status: limit ? 429 : 503, headers },
		);
	}
}
