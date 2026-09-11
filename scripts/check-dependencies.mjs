import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check with npm run check:dependencies");
const result = spawnSync(process.execPath, [npmCli, "audit", "--json"], { encoding: "utf8", timeout: 60_000, maxBuffer: 5 * 1024 * 1024 });
if (result.error) throw result.error;
const report = JSON.parse(result.stdout);
if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities) throw new Error("Dependency audit did not return a valid report");
await mkdir("test-results", { recursive: true });
await writeFile("test-results/dependency-audit.json", JSON.stringify(report, null, 2));
const policy = JSON.parse(await readFile(new URL("./dependency-policy.json", import.meta.url), "utf8"));
const failures = [];
const highCount = report.metadata.vulnerabilities.high || 0;
if (report.metadata.vulnerabilities.critical) failures.push("Critical dependency vulnerabilities are not allowed");
if (highCount && new Date() >= new Date(`${policy.expiresAt}T00:00:00Z`)) failures.push("Temporary development exceptions require a new review");
for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
  for (const advisory of vulnerability.via) {
    if (typeof advisory !== "object" || !["high", "critical"].includes(advisory.severity)) continue;
    if (!policy.exceptions[name]?.advisories.includes(advisory.url)) failures.push(`Unreviewed advisory: ${name} ${advisory.url}`);
  }
}
console.log(`Audit: ${report.metadata.vulnerabilities.critical} critical, ${highCount} high. Report: test-results/dependency-audit.json`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(highCount ? `Reviewed exceptions expire ${policy.expiresAt}.` : "No high-risk advisories. No dependency exceptions are active.");
}
