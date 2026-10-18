import test from "node:test";
import assert from "node:assert/strict";
const module = await import("../../scripts/selfhost/cloudflare.mjs").catch(
  () => null,
);
test("Adding Mailflare tunnel ingress preserves Umami, catch-all, and existing settings", () => {
  assert.ok(
    module?.addMailflareIngress,
    "Cloudflare setup helper is implemented",
  );
  const config = {
    originRequest: { connectTimeout: 30 },
    ingress: [
      { hostname: "analytics.example.test", service: "http://localhost:3000" },
      { service: "http_status:404" },
    ],
  };
  const next = module.addMailflareIngress(config, "mail.example.test", 3100);
  assert.deepEqual(
    next.ingress.map((x) => x.service),
    ["http://localhost:3000", "http://127.0.0.1:3100", "http_status:404"],
  );
  assert.deepEqual(next.originRequest, config.originRequest);
  assert.equal(config.ingress.length, 2);
  assert.deepEqual(
    module.addMailflareIngress(next, "mail.example.test", 3100),
    next,
  );
  assert.throws(
    () =>
      module.addMailflareIngress(
        {
          ingress: [
            { hostname: "mail.example.test", service: "http://other:9999" },
            { service: "http_status:404" },
          ],
        },
        "mail.example.test",
        3100,
      ),
    /already/,
  );
});
