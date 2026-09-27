import "dotenv/config";
import { spawn } from "node:child_process";

// Windows/Hyper-V may reserve port 3000. Keep the callback origin consistent
// when using this separate, explicit local preview port.
const port = Number(process.env.STUDIO_PORT || 3210);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid STUDIO_PORT");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, NEXTAUTH_URL: `http://127.0.0.1:${port}` }, stdio: "inherit", windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
child.on("exit", code => { process.exitCode = code || 0; });
