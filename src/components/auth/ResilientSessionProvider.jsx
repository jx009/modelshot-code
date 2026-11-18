"use client";

import { SessionContext } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

export const SESSION_POLL_MS = 60_000;
export const SESSION_RETRY_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;
const ONLINE_THROTTLE_MS = 30_000;
// How many consecutive identical answers it takes before an inconclusive one is believed.
const REJECTED_LIMIT = 2;
const ERROR_LIMIT = 3;
const INITIAL = { session: undefined, loading: true };

/**
 * Reads /api/auth/session and keeps the distinction next-auth's client discards
 * (it reports every one of these as "no session"):
 * - session:  the server verified the user.
 * - guest:    `{}` — there is no session cookie, so the visitor is signed out.
 * - rejected: `null` — a cookie exists but was refused or could not be verified
 *             (banned, session version changed, or the account lookup failed).
 * - error:    the request failed, timed out or was not 2xx; it says nothing.
 */
async function readSession() {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.timeout?.(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return { kind: "error" };
    const body = await response.json();
    if (body?.user?.id) return { kind: "session", session: body };
    return { kind: body ? "guest" : "rejected" };
  } catch {
    return { kind: "error" };
  }
}

function createSessionSync(publish) {
  let state = INITIAL, active = false, seq = 0, latest = null, timer = 0, startedAt = 0, kind = null, streak = 0;

  async function read(id) {
    clearTimeout(timer);
    startedAt = Date.now();
    const result = await readSession();
    if (!active) return state.session ?? null;
    // A newer read supersedes this one; its caller waits for the newer answer.
    if (id !== seq) return latest;
    streak = result.kind === kind ? streak + 1 : 1;
    kind = result.kind;
    const confirmed = kind === "session" || kind === "guest";
    // An unreachable server never ends an existing session. A refused cookie does,
    // once a second answer agrees. A first load cannot stay "loading" forever.
    const accepted = confirmed || (kind === "rejected" ? streak >= REJECTED_LIMIT : state.loading && streak >= ERROR_LIMIT);
    if (accepted) publish(state = { session: result.session ?? null, loading: false });
    // A guest has nothing to refresh; sign-in arrives through update() or another tab.
    if (kind !== "guest") timer = setTimeout(sync, accepted || streak >= ERROR_LIMIT ? SESSION_POLL_MS : SESSION_RETRY_MS);
    return state.session ?? null;
  }

  function sync() {
    if (!active) return Promise.resolve(state.session ?? null);
    return latest = read(++seq);
  }

  function start() {
    active = true;
    void sync();
    const online = () => {
      if (kind === "guest" || Date.now() - startedAt < (kind === "session" ? ONLINE_THROTTLE_MS : SESSION_RETRY_MS)) return;
      void sync();
    };
    // next-auth announces sign-in and sign-out to other tabs through this key.
    const storage = event => { if (event.key === "nextauth.message") void sync(); };
    window.addEventListener("online", online);
    window.addEventListener("storage", storage);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("storage", storage);
    };
  }

  return { start, sync };
}

/**
 * Feeds next-auth's SessionContext, so useSession() keeps working everywhere.
 * It replaces next-auth's SessionProvider, which stores any failed session read
 * as "signed out" and then stops polling: one slow or failed request logged the
 * UI out until the next full reload.
 */
export function ResilientSessionProvider({ children }) {
  const [state, setState] = useState(INITIAL);
  const [engine] = useState(() => createSessionSync(setState));
  useEffect(() => engine.start(), [engine]);
  const value = useMemo(() => ({
    data: state.session,
    status: state.loading ? "loading" : state.session ? "authenticated" : "unauthenticated",
    update: () => engine.sync(),
  }), [state, engine]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
