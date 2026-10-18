import { hasValidSessionMutationOrigin } from "../auth/origin";
import { readJsonBody } from "../http/request";
import { validWhatsAppJid, type WhatsAppService } from "./types";
export async function handleWhatsAppMessages(
  request: Request,
  userId: string,
  service: WhatsAppService | undefined,
  resource: "chats" | "messages" | "history",
) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers });
  if (request.method !== "GET" && !hasValidSessionMutationOrigin(request))
    return fail("Invalid origin", 403);
  if (!service) return fail("WhatsApp is not enabled on this server", 503);
  if (!["GET", "POST"].includes(request.method))
    return fail("Method not allowed", 405);
  try {
    if (request.method === "GET") {
      if (resource === "chats")
        return Response.json(
          { chats: await service.chats(userId) },
          { headers },
        );
      const url = new URL(request.url),
        jid = url.searchParams.get("jid") || "";
      const before = url.searchParams.has("before")
        ? Number(url.searchParams.get("before"))
        : undefined;
      if (
        !validWhatsAppJid(jid) ||
        (before !== undefined && (!Number.isSafeInteger(before) || before < 0))
      )
        return fail("Invalid chat or history cursor", 400);
      return Response.json(
        { messages: await service.messages(userId, jid, before) },
        { headers },
      );
    }
    let input: unknown;
    try {
      input = await readJsonBody(request, 24576);
    } catch {
      return fail("Invalid or oversized message", 400);
    }
    const body = input as { jid?: unknown; text?: unknown; full?: unknown };
    if (resource === "history" && body?.full === true) {
      await service.history(userId);
      return Response.json({ ok: true }, { headers });
    }
    if (!body || typeof body.jid !== "string" || !validWhatsAppJid(body.jid))
      return fail("Choose a valid WhatsApp chat", 400);
    if (resource === "history") {
      await service.history(userId, body.jid);
      return Response.json({ ok: true }, { headers });
    }
    if (
      resource !== "messages" ||
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.length > 4096
    )
      return fail("Enter a message of 1–4096 characters", 400);
    await service.sendText(userId, body.jid, body.text.trim());
    return Response.json({ ok: true }, { headers });
  } catch {
    return fail(
      resource === "history"
        ? "History could not be requested. Keep your phone connected and try again."
        : "WhatsApp could not complete the request. Check your connection before retrying.",
      503,
    );
  }
}
