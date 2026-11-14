import { z } from "zod";
import { getSiteConfig } from "../site-config.js";
import { CREATION_LAUNCHER_ITEMS } from "./launcher-items.js";
export { CREATION_LAUNCHER_ITEMS } from "./launcher-items.js";

export const creationLauncherVisibilitySchema = z.object(Object.fromEntries(
  CREATION_LAUNCHER_ITEMS.map(({ key }) => [key, z.boolean()]),
));  // 默认剥离未知键：已下线入口的旧配置不应让整份设置失效

export const DEFAULT_CREATION_LAUNCHER_VISIBILITY = Object.fromEntries(
  CREATION_LAUNCHER_ITEMS.map(({ key }) => [key, true]),
);

export async function getCreationLauncherVisibility(db) {
  const raw = await getSiteConfig("creation_launcher_visibility", db);
  if (!raw) return DEFAULT_CREATION_LAUNCHER_VISIBILITY;
  try {
    return creationLauncherVisibilitySchema.parse({ ...DEFAULT_CREATION_LAUNCHER_VISIBILITY, ...JSON.parse(raw) });
  } catch {
    return DEFAULT_CREATION_LAUNCHER_VISIBILITY;
  }
}
