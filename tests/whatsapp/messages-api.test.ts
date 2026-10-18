import test from "node:test";
import assert from "node:assert/strict";
const module = await import("../../src/lib/whatsapp/messages-api").catch(
  () => null,
);
test("Chat API scopes reads and sends to session owner, rejects invalid JIDs and cross-site sends", async () => {
  assert.ok(module?.handleWhatsAppMessages, "chat API is implemented");
  const calls: unknown[] = [];
  const service = {
    chats: async (id: string) => {
      calls.push(id);
      return [];
    },
    messages: async (...args: unknown[]) => {
      calls.push(args);
      return [];
    },
    sendText: async (...args: unknown[]) => {
      calls.push(args);
    },
  } as any;
  const handle = module!.handleWhatsAppMessages;
  assert.equal(
    (
      await handle(
        new Request("http://localhost/api/whatsapp/chats?userId=bob"),
        "alice",
        service,
        "chats",
      )
    ).status,
    200,
  );
  assert.deepEqual(calls, ["alice"]);
  const send = (origin: string, jid: string) =>
    new Request("http://localhost/api/whatsapp/messages", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ jid, text: "hello", userId: "bob" }),
    });
  assert.equal(
    (
      await handle(
        send("https://evil.test", "123@s.whatsapp.net"),
        "alice",
        service,
        "messages",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handle(
        send("http://localhost", "status@broadcast"),
        "alice",
        service,
        "messages",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handle(
        send("http://localhost", "123@s.whatsapp.net"),
        "alice",
        service,
        "messages",
      )
    ).status,
    200,
  );
  assert.deepEqual(calls, ["alice", ["alice", "123@s.whatsapp.net", "hello"]]);
  assert.equal(
    (
      await handle(
        new Request("http://localhost/api/whatsapp/messages?jid=bad"),
        "alice",
        service,
        "messages",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handle(
        new Request("http://localhost/api/whatsapp/chats"),
        "alice",
        undefined,
        "chats",
      )
    ).status,
    503,
  );
});
test('History sync can request recent phone history without inventing a chat or sending contact messages',async()=>{
 assert.ok(module);const owners:unknown[]=[];const service={history:async(...args:unknown[])=>{owners.push(args)}} as any;
 const result=await module!.handleWhatsAppMessages(new Request('http://localhost/api/whatsapp/history',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({full:true})}),'alice',service,'history');
 assert.equal(result.status,200);assert.deepEqual(owners,[['alice']]);
});
