import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../services/image-tools", import.meta.url));
const python = process.env.STUDIO_PYTHON || `${directory}/.venv/${process.platform === "win32" ? "Scripts/python.exe" : "bin/python"}`;
if (!existsSync(python)) throw new Error("Create services/image-tools/.venv and install its requirements first; see the service README.");
const child = spawn(python, ["-m", "uvicorn", "app:app", "--app-dir", directory, "--host", "127.0.0.1", "--port", "8090", "--workers", "1"], { env: process.env, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
child.on("exit", code => { process.exitCode = code || 0; });
