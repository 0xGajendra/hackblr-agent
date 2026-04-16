import { v4 as uuid } from "uuid";
import { deleteSession } from "./qdrant";
import { SessionMeta } from "./types";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

const sessionStore = new Map<string, SessionMeta>();

export function createSession(
  source: SessionMeta["source"],
  label: string,
): string {
  const sessionId = uuid();
  sessionStore.set(sessionId, {
    sessionId,
    createdAt: Date.now(),
    source,
    label,
    chunkCount: 0,
    ready: false,
  });
  return sessionId;
}

export function getSession(sessionId: string): SessionMeta | undefined {
  return sessionStore.get(sessionId);
}

export function markReady(sessionId: string, chunkCount: number): void {
  const existing = sessionStore.get(sessionId);
  if (!existing) {
    return;
  }
  existing.chunkCount = chunkCount;
  existing.ready = true;
  sessionStore.set(sessionId, existing);
}

export function deleteSessionMeta(sessionId: string): void {
  sessionStore.delete(sessionId);
}

export function listSessions(): SessionMeta[] {
  return [...sessionStore.values()].sort((a, b) => b.createdAt - a.createdAt);
}

async function cleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  const expired = [...sessionStore.values()].filter(
    (session) => now - session.createdAt > SESSION_TTL_MS,
  );

  for (const session of expired) {
    try {
      await deleteSession(session.sessionId);
    } catch (err) {
      console.error(
        `Failed deleting expired session ${session.sessionId}:`,
        err,
      );
    } finally {
      sessionStore.delete(session.sessionId);
    }
  }
}

const interval = setInterval(() => {
  cleanupExpiredSessions().catch((err) => {
    console.error("Session cleanup interval failed:", err);
  });
}, CLEANUP_INTERVAL_MS);

interval.unref();
