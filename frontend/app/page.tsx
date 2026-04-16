"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Intent = "error" | "audit" | "debug" | "explain" | "navigate";
type Role = "user" | "assistant";

interface TranscriptLine {
  id: string;
  role: Role;
  text: string;
}

const DEMO_CODEBASES = [
  {
    label: "Node API Crash (TypeScript)",
    filename: "server.ts",
    code: `import express from "express";\nconst app = express();\napp.get("/", async (_req, res) => {\n  const data: any = null;\n  res.json({ value: data.value });\n});\napp.listen(3000);`,
  },
  {
    label: "Auth Middleware Bug",
    filename: "auth.js",
    code: `export function requireAuth(req, res, next) {\n  const token = req.headers.authorization;\n  if (token == "admin") {\n    return next();\n  }\n  return res.status(401).json({ error: "unauthorized" });\n}`,
  },
  {
    label: "Python Job Runner",
    filename: "worker.py",
    code: `def run_job(job):\n    result = 10 / job.get("divider", 0)\n    return {"result": result}\n\nprint(run_job({"divider": 0}))`,
  },
];

function detectIntent(text: string): Intent {
  const lower = text.toLowerCase();
  if (/error|exception|crash|stacktrace|undefined|null/.test(lower)) {
    return "error";
  }
  if (/audit|review|health check|security|vulnerab/.test(lower)) {
    return "audit";
  }
  if (/bug|not working|fails|failing|issue|debug/.test(lower)) {
    return "debug";
  }
  if (/where|which file|located|navigate|find/.test(lower)) {
    return "navigate";
  }
  return "explain";
}

function intentColor(intent: Intent): string {
  if (intent === "error") return "oklch(0.6271 0.1936 33.3390)";
  if (intent === "audit") return "oklch(0.9200 0.0651 74.3695)";
  if (intent === "debug") return "oklch(0.4341 0.0392 41.9938)";
  if (intent === "navigate") return "oklch(0.9200 0.0651 74.3695)";
  return "oklch(0.5775 0.1548 131.7671)";
}

function extractVapiErrorMessage(event: unknown): string {
  const fallback = "Unknown Vapi error";

  if (typeof event === "string") {
    return event;
  }

  if (!event || typeof event !== "object") {
    return fallback;
  }

  const e = event as {
    message?: string;
    error?: {
      message?: string;
      errorMsg?: string;
      msg?: string;
      error?: string;
      details?: unknown;
      reason?: string;
    };
    reason?: string;
    type?: string;
  };

  const candidates = [
    e.error?.message,
    e.error?.errorMsg,
    e.error?.msg,
    e.error?.error,
    e.reason,
    e.error?.reason,
    e.message,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  if (candidates.length) {
    return candidates[0];
  }

  if (e.error) {
    try {
      return JSON.stringify(e.error);
    } catch {
      // fall through to generic event stringify
    }
  }

  try {
    return JSON.stringify(event);
  } catch {
    return e.type ? `${fallback} (${e.type})` : fallback;
  }
}

export default function HomePage() {
  const [code, setCode] = useState("");
  const [filename, setFilename] = useState("pasted-code.ts");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState("No code ingested yet");
  const [loading, setLoading] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [latestUserText, setLatestUserText] = useState("");
  const [vapiDebug, setVapiDebug] = useState("Idle");
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null);
  const [activeSessionsCount, setActiveSessionsCount] = useState(0);
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const [sessionChunkCount, setSessionChunkCount] = useState<number | null>(
    null,
  );
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const vapiRef = useRef<any>(null);
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
  const vapiPublicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const vapiAssistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;

  const currentIntent = useMemo(
    () => detectIntent(latestUserText || "explain this code"),
    [latestUserText],
  );

  useEffect(() => {
    let isMounted = true;

    async function checkBackendHealth() {
      try {
        const [healthRes, sessionsRes] = await Promise.all([
          fetch(`${backendUrl}/`),
          fetch(`${backendUrl}/sessions`),
        ]);

        if (!isMounted) {
          return;
        }

        setBackendHealthy(healthRes.ok);

        if (sessionsRes.ok) {
          const data = await sessionsRes.json();
          const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
          setActiveSessionsCount(sessions.length);
        } else {
          setActiveSessionsCount(0);
        }
      } catch (_error) {
        if (isMounted) {
          setBackendHealthy(false);
          setActiveSessionsCount(0);
        }
      }
    }

    checkBackendHealth();
    const interval = window.setInterval(checkBackendHealth, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [backendUrl]);

  useEffect(() => {
    let cancelled = false;

    async function checkSessionStatus() {
      if (!sessionId) {
        setSessionReady(null);
        setSessionChunkCount(null);
        return;
      }

      try {
        const res = await fetch(`${backendUrl}/ingest/status/${sessionId}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setSessionReady(Boolean(data?.ready));
          setSessionChunkCount(
            typeof data?.chunkCount === "number" ? data.chunkCount : null,
          );
        }
      } catch (_error) {
        if (!cancelled) {
          setSessionReady(false);
        }
      }
    }

    checkSessionStatus();

    return () => {
      cancelled = true;
    };
  }, [backendUrl, sessionId, ingestStatus]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  async function ingestPaste() {
    try {
      setLoading(true);
      const res = await fetch(`${backendUrl}/ingest/paste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          filename,
          sessionId: sessionId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setIngestStatus(data?.error || "Paste ingestion failed");
        return;
      }

      setSessionId(data.sessionId);
      setIngestStatus(
        `Ready: ${data.chunks} chunks ingested from ${data.filename}`,
      );
    } catch (error) {
      console.error(error);
      setIngestStatus("Paste ingestion failed");
    } finally {
      setLoading(false);
    }
  }

  async function ingestGithub() {
    try {
      setLoading(true);
      const res = await fetch(`${backendUrl}/ingest/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, branch }),
      });
      const data = await res.json();

      if (!res.ok) {
        setIngestStatus(data?.error || "GitHub ingestion failed");
        return;
      }

      setSessionId(data.sessionId);
      setIngestStatus(
        `Ready: ${data.totalChunks} chunks from ${data.filesIngested} files (${data.repo})`,
      );
    } catch (error) {
      console.error(error);
      setIngestStatus("GitHub ingestion failed");
    } finally {
      setLoading(false);
    }
  }

  async function ingestDemo(index: number) {
    const selected = DEMO_CODEBASES[index];
    setCode(selected.code);
    setFilename(selected.filename);

    try {
      setLoading(true);
      const res = await fetch(`${backendUrl}/ingest/paste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: selected.code,
          filename: selected.filename,
          sessionId: sessionId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIngestStatus(data?.error || "Demo ingestion failed");
        return;
      }
      setSessionId(data.sessionId);
      setIngestStatus(`Demo loaded: ${selected.label} (${data.chunks} chunks)`);
    } catch (error) {
      console.error(error);
      setIngestStatus("Demo ingestion failed");
    } finally {
      setLoading(false);
    }
  }

  async function ingestUpload() {
    if (!uploadedFiles.length) {
      setIngestStatus("Choose one or more files first");
      return;
    }

    try {
      setLoading(true);

      const files = await Promise.all(
        uploadedFiles.map(async (file) => ({
          filename: file.name,
          content: await file.text(),
        })),
      );

      const res = await fetch(`${backendUrl}/ingest/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files,
          sessionId: sessionId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setIngestStatus(data?.error || "Upload ingestion failed");
        return;
      }

      setSessionId(data.sessionId);
      setIngestStatus(
        `Ready: ${data.totalChunks} chunks from ${data.filesIngested} uploaded files`,
      );
      setUploadedFiles([]);
    } catch (error) {
      console.error(error);
      setIngestStatus("Upload ingestion failed");
    } finally {
      setLoading(false);
    }
  }

  async function startCall() {
    if (!sessionId) {
      setIngestStatus("Ingest code first, then start call");
      return;
    }
    if (!vapiPublicKey || !vapiAssistantId) {
      setIngestStatus("Missing Vapi public key or assistant id");
      return;
    }

    try {
      const sdk = await import("@vapi-ai/web");
      const Vapi = (sdk as any).default;

      if (!vapiRef.current) {
        const client = new Vapi(vapiPublicKey);

        client.on("message", (message: any) => {
          if (message?.type === "transcript") {
            const role = message?.role === "assistant" ? "assistant" : "user";
            const text = String(message?.transcript || "").trim();
            if (!text) return;
            setTranscript((prev) => [
              ...prev,
              { id: crypto.randomUUID(), role, text },
            ]);
            if (role === "user") {
              setLatestUserText(text);
            }
          }

          if (
            message?.type === "conversation-update" &&
            Array.isArray(message?.conversation)
          ) {
            const lines: TranscriptLine[] = message.conversation
              .filter((item: any) => item?.role && item?.content)
              .map((item: any) => ({
                id: crypto.randomUUID(),
                role: item.role === "assistant" ? "assistant" : "user",
                text: String(item.content),
              }));

            if (lines.length) {
              setTranscript(lines);
              const user = [...lines]
                .reverse()
                .find((line) => line.role === "user");
              if (user) setLatestUserText(user.text);
            }
          }
        });

        client.on("call-start", () => setIsCallActive(true));
        client.on("call-end", () => {
          setIsCallActive(false);
          setVapiDebug("Call ended");
        });
        client.on(
          "call-start-progress",
          (event: { stage?: string; status?: string }) => {
            setVapiDebug(
              `Start: ${event?.stage || "unknown"} (${event?.status || "pending"})`,
            );
          },
        );
        client.on("call-start-failed", (event: { error?: string }) => {
          const msg = extractVapiErrorMessage(event);
          setVapiDebug(`Call start failed: ${msg}`);
          setIngestStatus(`Vapi error: ${msg}`);
        });
        client.on("error", (event: unknown) => {
          console.error("Vapi error event", event);
          const msg = extractVapiErrorMessage(event);
          setVapiDebug(`Error: ${msg}`);
          setIngestStatus(`Vapi error: ${msg}`);
        });

        vapiRef.current = client;
      }

      setVapiDebug("Starting call...");
      await vapiRef.current.start(vapiAssistantId, {
        metadata: { sessionId },
      });
      setIsCallActive(true);
      setVapiDebug("Call started");
      setIngestStatus(`Call started with session ${sessionId}`);
    } catch (error) {
      console.error(error);
      const msg =
        error instanceof Error ? error.message : "Failed to start Vapi call";
      setVapiDebug(`Start failed: ${msg}`);
      setIngestStatus(`Failed to start Vapi call: ${msg}`);
    }
  }

  async function stopCall() {
    try {
      if (vapiRef.current) {
        await vapiRef.current.stop();
      }
      setIsCallActive(false);
    } catch (error) {
      console.error(error);
      setIngestStatus("Failed to stop call");
    }
  }

  return (
    <main className="page">
      <header className="header">
        <div className="header-left">
          <h1>HackBLR</h1>
          <p className="subtitle">Voice-first developer assistant</p>
        </div>
        <div className="header-right">
          <Link href="/docs" className="nav-link">
            Docs
          </Link>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <div className="status">
        <div className="statusItem">
          <span>Backend</span>
          <span className={`value ${backendHealthy ? "ok" : "bad"}`}>
            {backendHealthy === null
              ? "Checking..."
              : backendHealthy
              ? "Online"
              : "Offline"}
          </span>
        </div>
        <div className="statusItem">
          <span>Active Sessions</span>
          <span className="value">{activeSessionsCount}</span>
        </div>
        <div className="statusItem">
          <span>Current Session</span>
          <span className="value">{sessionId ? sessionId.slice(0, 8) + "..." : "None"}</span>
        </div>
        <div className="statusItem">
          <span>Status</span>
          <span className={`value ${sessionReady ? "ok" : ""}`}>
            {sessionReady === null
              ? "Unknown"
              : sessionReady
              ? `${sessionChunkCount} chunks`
              : "Not ready"}
          </span>
        </div>
      </div>

      <section className="hero">
        <h2>Talk to your code</h2>
        <p>Ask about errors, audit code, or explain how anything works</p>
        <div className="intentBadge">
          <span>Intent:</span>
          <span>{currentIntent.toUpperCase()}</span>
        </div>
        <div className="buttons">
          <button onClick={startCall} disabled={loading || isCallActive}>
            {isCallActive ? "Call Active" : "Start Call"}
          </button>
          <button className="secondary" onClick={stopCall} disabled={!isCallActive}>
            End Call
          </button>
        </div>
        <small>{ingestStatus}</small>
      </section>

      <div className="grid">
        <div className="card">
          <h3>Demo Codebases</h3>
          <div className="demoRow">
            {DEMO_CODEBASES.map((item, i) => (
              <button key={item.label} className="secondary" onClick={() => ingestDemo(i)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Paste Code</h3>
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="Filename"
          />
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste your code here..."
          />
          <button onClick={ingestPaste} disabled={loading || !code.trim()}>
            Ingest Code
          </button>
        </div>

        <div className="card">
          <h3>GitHub Repository</h3>
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/user/repo"
          />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Branch (default: main)"
          />
          <button onClick={ingestGithub} disabled={loading || !repoUrl.trim()}>
            Ingest Repo
          </button>
        </div>

        <div className="card">
          <h3>Upload Files</h3>
          <div className="fileInput">
            <input
              type="file"
              multiple
              onChange={(e) =>
                setUploadedFiles(e.target.files ? Array.from(e.target.files) : [])
              }
            />
          </div>
          {uploadedFiles.length > 0 && (
            <p className="selectedFiles">
              {uploadedFiles.length} file(s): {uploadedFiles.map((f) => f.name).join(", ")}
            </p>
          )}
          <button
            onClick={ingestUpload}
            disabled={loading || uploadedFiles.length === 0}
          >
            Upload Files
          </button>
        </div>

        <div className="card transcript">
          <h3>Live Transcript</h3>
          {transcript.length === 0 ? (
            <p className="empty">No transcript yet. Start a call and speak.</p>
          ) : (
            <div className="transcriptList">
              {transcript.map((line) => (
                <div key={line.id} className={`transcriptLine ${line.role}`}>
                  <strong>{line.role === "user" ? "You" : "Agent"}</strong>
                  {line.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
