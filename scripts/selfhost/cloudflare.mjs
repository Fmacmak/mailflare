/** Native setup helpers. No DNS, Worker or tunnel mutations happen on import. */
export function addMailflareIngress(config, hostname, port) {
  if (!Array.isArray(config?.ingress) || !config.ingress.length)
    throw new Error("Tunnel has no readable ingress configuration.");
  const service = `http://127.0.0.1:${port}`;
  const existing = config.ingress.find((rule) => rule.hostname === hostname);
  if (existing && existing.service !== service)
    throw new Error("Hostname already routes to another service.");
  if (existing) return structuredClone(config);
  const ingress = structuredClone(config.ingress);
  const index = ingress.findIndex(
    (rule) => !rule.hostname || rule.hostname.startsWith("*."),
  );
  ingress.splice(index < 0 ? ingress.length : index, 0, { hostname, service });
  return { ...structuredClone(config), ingress };
}
