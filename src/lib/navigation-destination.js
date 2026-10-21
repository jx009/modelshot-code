const CREATIVE_ROUTES = ["/explore", "/commerce", "/projects", "/assets"];

export function destinationPath(href) {
  const pathname = new URL(href, "https://navigation.local").pathname;
  return pathname.replace(/^\/(?:zh|en)(?=\/|$)/, "").replace(/\/$/, "") || "/";
}

export function destinationSection(href) {
  const pathname = destinationPath(href);
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/" || CREATIVE_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))) return "creative";
  return "root";
}

export function contentTransition(navigation, section) {
  if (!navigation || destinationPath(navigation.href) === destinationPath(navigation.from)) return false;
  const source = destinationSection(navigation.from);
  const target = destinationSection(navigation.href);
  if (section === "root") return source !== target || target === "root";
  return source === section && target === section;
}
