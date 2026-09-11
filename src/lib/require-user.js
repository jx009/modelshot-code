import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "./auth.js";
import { AppError } from "./http.js";

export async function requireUser() {
  const session = await getServerSession(await buildAuthOptions());
  if (!session?.user?.id) throw new AppError("UNAUTHORIZED", 401);
  return session.user;
}
