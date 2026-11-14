import { getCreationEnv } from "@/lib/creation/access";
import { AGENT_PIPELINE_VERSION, AGENT_SCHEDULER_HEARTBEAT, AGENT_LANGUAGE_HEARTBEAT } from "@/lib/creation/contracts/agent";
import { HTML_PIPELINE_VERSION, HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT } from "@/lib/creation/contracts/html-runtime";
import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { creationLanguageConfig } from "@/lib/domain/creation/language-jobs";
import { prisma } from "@/lib/prisma";
import { posterImageQuote, posterImageModels } from "@/lib/domain/creation/poster-images";
import { getCreationLauncherVisibility } from "@/lib/creation/launcher-visibility";
import { POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT, posterImageWorkersReady } from "@/lib/creation/contracts/poster-runtime";

const runtimes = {
  agent: { enabled: "CREATION_AGENT_ENABLED", workers: ["worker", AGENT_SCHEDULER_HEARTBEAT, AGENT_LANGUAGE_HEARTBEAT], version: AGENT_PIPELINE_VERSION },
  slides: { enabled: "CREATION_SLIDES_ENABLED", workers: ["worker", HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT], version: HTML_PIPELINE_VERSION },
};

export async function GET() {
  try {
    const user = await requireUser();
    const env = await getCreationEnv(user.id);
    const baseEnabled = env.CREATION_RUNS_ENABLED === "true" && env.CREATION_WORKSPACE_ENABLED === "true";
    const configuredKinds = Object.entries(runtimes).filter(([, value]) => baseEnabled && env[value.enabled] === "true");
    const workerIds = [...new Set(configuredKinds.flatMap(([, value]) => value.workers))];
    if (configuredKinds.some(([kind]) => kind === "slides")) workerIds.push(POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT);
    const rows = workerIds.length ? await prisma.serviceHeartbeat.findMany({
      where: { id: { in: workerIds }, updatedAt: { gt: new Date(Date.now() - 90000) } },
      select: { id: true, details: true },
    }) : [];
    const config = configuredKinds.length ? await creationLanguageConfig() : null;
    const configured = Boolean(config?.visionApiKey && config?.chatModel);
    const workers = new Map(rows.map(row => [row.id, row]));
    const available = Object.fromEntries(Object.entries(runtimes).map(([kind, runtime]) => {
      const enabled = baseEnabled && env[runtime.enabled] === "true";
      const ready = runtime.workers.every(id => workers.has(id))
        && (runtime.version === undefined || runtime.workers.filter(id => id !== "worker").every(id => workers.get(id)?.details?.version === runtime.version));
      return [kind, Boolean(enabled && configured && ready)];
    }));
    // 配图通道可选：不可用时 PPT 仍可只用文字与图形生成。
    const imageReady = available.slides && posterImageWorkersReady(rows);
    const posterImage = imageReady ? await posterImageQuote().catch(() => null) : null;
    const imageModels = imageReady ? await posterImageModels().catch(() => []) : [];
    // No editor code, credentials or document contents are returned here.
    const launcherVisibility = await getCreationLauncherVisibility();
    return Response.json({ ...available, launcherVisibility, video: env.CREATION_WORKSPACE_ENABLED === "true" && env.CREATION_VIDEO_ENABLED === "true", motion: env.CREATION_WORKSPACE_ENABLED === "true" && env.CREATION_MOTION_ENABLED === "true",
      languageUnitCost: configured ? config.plannerCreditCost ?? 1 : null,
      maxPages: 100, maxReferenceAssets: 8,
      posterImage, imageModels,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
