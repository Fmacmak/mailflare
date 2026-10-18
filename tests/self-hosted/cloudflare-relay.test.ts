import test from "node:test";
import assert from "node:assert/strict";
import { getEmailWorkerName } from "../../src/lib/cloudflare-api-utils";
import { shouldBindEmailCatchAllToWorker } from "../../src/lib/domains/provision";
import { ensureEmailRoutingRuleToWorker } from "../../src/lib/cloudflare-api";
test("Self-hosted Cloudflare onboarding routes new addresses to the configured relay", async () => {
  const env = {
    MAILFLARE_RUNTIME: "node",
    CF_TOKEN: "test-token",
    CF_EMAIL_WORKER_NAME: "mailflare-email-relay",
  } as CloudflareEnv;
  assert.equal(getEmailWorkerName(env), "mailflare-email-relay");
  assert.equal(shouldBindEmailCatchAllToWorker(env), true);
  assert.equal(
    shouldBindEmailCatchAllToWorker({ MAILFLARE_RUNTIME: "node" }),
    false,
  );
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      success: true,
      result: init?.method === "POST" ? { id: "created", enabled: true } : [],
    });
  };
  try {
    await ensureEmailRoutingRuleToWorker(env, "zone", "new@example.test");
    assert.equal(
      JSON.parse(calls[1].init!.body as string).actions[0].value[0],
      "mailflare-email-relay",
    );
    assert.equal(
      (calls[0].init!.headers as Record<string, string>).Authorization,
      "Bearer test-token",
    );
  } finally {
    globalThis.fetch = original;
  }
});
