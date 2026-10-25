import { expect, it } from "vitest";
import { webDeploymentSource } from "../../src/lib/creation/web-deployment.js";

const site = { entryPath: "pages/home.html", files: ["pages/home.html", "pages/about.html", "styles/main.css", "assets/photo.png", "app.js"].map(path => ({ path })) };
it("rewrites HTML, srcset, inline styles and CSS using the same directory semantics", () => {
  const file = { path: "pages/home.html", kind: "html", content: '<link href="/styles/main.css" rel="stylesheet"><img srcset="/assets/photo.png 1x" style="background:url(/assets/photo.png)"><a href="/">Home</a><a href="about.html#team">Team</a><script src="/app.js"></script>' };
  const result = webDeploymentSource(file, site);
  expect(result).toContain('href="../styles/main.css"');
  expect(result).toContain('srcset="../assets/photo.png 1x"');
  expect(result).toContain('href="home.html"');
  expect(result).toContain('href="about.html#team"');
  expect(result).toContain('src="../app.js"');
  expect(webDeploymentSource({ path: "styles/main.css", kind: "css", content: '/* /assets/photo.png */ .a{background:url("/assets/photo.png")}' }, site)).toBe('/* /assets/photo.png */ .a{background:url("../assets/photo.png")}');
});
it("rejects missing local resources and escaping paths before publication", () => {
  for (const url of ["/missing.png", "../../secret", "/%2fsecret"]) expect(() => webDeploymentSource({ path: "pages/home.html", kind: "html", content: `<img src="${url}">` }, site)).toThrow("WEB_REFERENCE_NOT_FOUND");
});
it("does not leak signed or app-owned URLs into a public source bundle", () => {
  for (const url of ["https://app.test/api/assets/private?token=secret", "//storage.test/image?signature=secret"]) expect(() => webDeploymentSource({ path: "pages/home.html", kind: "html", content: `<img src="${url}">` }, site)).toThrow("WEB_EXTERNAL_REFERENCE_UNSUPPORTED");
});
it("preserves script source and nonlocal/fragment links without textual replacements", () => {
  const content = '<a href="#team">Team</a><script>const value = "/assets/photo.png";</script>';
  expect(webDeploymentSource({ path: "pages/home.html", kind: "html", content }, site)).toBe(content);
});
