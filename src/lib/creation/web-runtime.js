export const WEB_RUNTIME_CHANNEL = "modelshot-web-runtime-v1";
export const WEB_RUNTIME_MAX_CHARACTERS = 12 * 1024 * 1024;

export function webRuntimeHeaders(parentOrigin) {
  return {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${parentOrigin}`,
  };
}

// The shell is public, but accepts a single document only from its configured
// application parent. The outer iframe must never receive allow-same-origin.
export function webRuntimeShell(parentOrigin) {
  const config = JSON.stringify({ parentOrigin, channel: WEB_RUNTIME_CHANNEL, max: WEB_RUNTIME_MAX_CHARACTERS }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Website preview</title></head><body><script>
(() => {
  const config = ${config}, token = location.hash.slice(1);
  if (parent === window || !/^[a-zA-Z0-9_-]{16,128}$/.test(token)) return;
  const send = (type, payload = {}) => parent.postMessage({channel:config.channel, token, type, ...payload}, config.parentOrigin);
  const receive = event => {
    const data = event.data;
    if (event.source !== parent || event.origin !== config.parentOrigin || !data || data.channel !== config.channel || data.token !== token || data.type !== "render" || typeof data.html !== "string" || data.html.length > config.max) return;
    window.removeEventListener("message", receive);
    // Attach to the replacement document after document.open clears listeners.
    // Only bounded local file identities ever reach the parent.
    const navigate = event => {
      const anchor = event.target.closest?.("a[data-cw-preview-path]");
      if (!anchor) return;
      event.preventDefault();
      const path = anchor.getAttribute("data-cw-preview-path");
      if (path && path.length <= 240) send("navigate", {path});
    };
    document.open(); document.write(data.html); document.close();
    document.addEventListener("click", navigate, true);
    send("rendered");
  };
  window.addEventListener("message", receive);
  send("ready");
})();
</script></body></html>`;
}

export function webRuntimeMessage(event, { source, token, paths = [] }) {
  if (event.source !== source || !source || event.origin !== "null") return null;
  const data = event.data;
  if (!data || data.channel !== WEB_RUNTIME_CHANNEL || data.token !== token || !["ready", "rendered", "navigate"].includes(data.type)) return null;
  if (Object.keys(data).some(key => !["channel", "token", "type", "path"].includes(key))) return null;
  if (data.type === "navigate" && (typeof data.path !== "string" || data.path.length > 240 || !paths.includes(data.path))) return null;
  if (data.type !== "navigate" && data.path !== undefined) return null;
  return { type: data.type, ...(data.path ? { path: data.path } : {}) };
}
