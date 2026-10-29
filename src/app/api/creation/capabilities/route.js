import { getCreationEnv } from "@/lib/creation/access";
import { AGENT_PIPELINE_VERSION, AGENT_SCHEDULER_HEARTBEAT, AGENT_LANGUAGE_HEARTBEAT } from "@/lib/creation/contracts/agent";
import { HTML_PIPELINE_VERSION, HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT } from "@/lib/creation/contracts/html-runtime";
import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { creationLanguageConfig } from "@/lib/domain/creation/language-jobs";
import { prisma } from "@/lib/prisma";
import { DOCUMENT_PIPELINE_VERSION, DOCUMENT_SCHEDULER_HEARTBEAT, DOCUMENT_LANGUAGE_HEARTBEAT } from "@/lib/creation/contracts/document-runtime";
import { SHEET_PIPELINE_VERSION, SHEET_SCHEDULER_HEARTBEAT, SHEET_LANGUAGE_HEARTBEAT } from "@/lib/creation/contracts/sheet-runtime";
import { WEB_PIPELINE_VERSION, WEB_SCHEDULER_HEARTBEAT, WEB_LANGUAGE_HEARTBEAT } from "@/lib/creation/contracts/web-runtime";
import { posterImageQuote, posterImageModels } from "@/lib/domain/creation/poster-images";
import { getCreationLauncherVisibility } from "@/lib/creation/launcher-visibility";
import { POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT, posterImageWorkersReady } from "@/lib/creation/contracts/poster-runtime";

const runtimes = {
  agent: { enabled: "CREATION_AGENT_ENABLED", workers: ["worker", AGENT_SCHEDULER_HEARTBEAT, AGENT_LANGUAGE_HEARTBEAT], version: AGENT_PIPELINE_VERSION },
  poster: { enabled: "CREATION_POSTER_ENABLED", workers: ["worker", HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT], version: HTML_PIPELINE_VERSION },
  slides: { enabled: "CREATION_SLIDES_ENABLED", workers: ["worker", HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT], version: HTML_PIPELINE_VERSION },
  document: { enabled: "CREATION_DOCUMENT_ENABLED", workers: ["worker", DOCUMENT_SCHEDULER_HEARTBEAT, DOCUMENT_LANGUAGE_HEARTBEAT], version: DOCUMENT_PIPELINE_VERSION },
  sheet: { enabled: "CREATION_SHEET_ENABLED", workers: ["worker", SHEET_SCHEDULER_HEARTBEAT, SHEET_LANGUAGE_HEARTBEAT], version: SHEET_PIPELINE_VERSION },
  web: { enabled: "CREATION_WEB_ENABLED", workers: ["worker", WEB_SCHEDULER_HEARTBEAT, WEB_LANGUAGE_HEARTBEAT], version: WEB_PIPELINE_VERSION },
};

export async function GET() {
  try {
    const user = await requireUser();
    const env = await getCreationEnv(user.id);
    const baseEnabled = env.CREATION_RUNS_ENABLED === "true" && env.CREATION_WORKSPACE_ENABLED === "true";
    const configuredKinds = Object.entries(runtimes).filter(([, value]) => baseEnabled && env[value.enabled] === "true");
    const workerIds = [...new Set(configuredKinds.flatMap(([, value]) => value.workers))];
    if (configuredKinds.some(([kind]) => ["poster", "slides"].includes(kind))) workerIds.push(POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT);
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
    // Image availability is optional: an unavailable image channel must not
    // hide typography-only posters or prevent existing artwork from opening.
    const imageReady = (available.poster || available.slides) && posterImageWorkersReady(rows);
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
