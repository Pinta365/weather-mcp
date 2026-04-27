export function parseWeights(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  const result: Record<string, number> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    if (sep < 0) continue;
    const name = trimmed.slice(0, sep).trim();
    const value = Number(trimmed.slice(sep + 1).trim());
    if (name && Number.isFinite(value) && value >= 0) {
      result[name] = value;
    }
  }
  return result;
}

export function readWeightsFromEnv(envName = "WEATHERMCP_WEIGHTS"): Record<string, number> {
  const status = Deno.permissions.querySync({ name: "env", variable: envName });
  if (status.state !== "granted") return {};
  return parseWeights(Deno.env.get(envName));
}
