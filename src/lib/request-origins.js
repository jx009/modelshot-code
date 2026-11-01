import { isIP } from "node:net";

// Only deployment configuration establishes trust; Host and forwarded headers do not.
export function allowedRequestOrigins(requestUrl, env = process.env) {
  const primary = new URL(env.NEXTAUTH_URL || requestUrl);
  const origins = new Set([primary.origin]);
  // The public website may be served with or without its www prefix.
  // Preserve protocol and port, and never infer parent domains of other subdomains.
  if (env.NEXTAUTH_URL && ["http:", "https:"].includes(primary.protocol)
    && primary.hostname.includes(".") && !isIP(primary.hostname.replace(/^\[|\]$/g, ""))
    && !primary.hostname.endsWith(".localhost")) {
    const alias = new URL(primary.origin);
    alias.hostname = primary.hostname.startsWith("www.")
      ? primary.hostname.slice(4) : `www.${primary.hostname}`;
    origins.add(alias.origin);
  }
  for (const entry of (env.ALLOWED_ORIGINS || "").split(",")) {
    if (!entry.trim()) continue;
    try {
      const url = new URL(entry.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*")) continue;
      origins.add(url.origin);
    } catch { /* Invalid entries grant no access. */ }
  }
  return origins;
}
