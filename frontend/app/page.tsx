"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  if (intent === "error") return "#ef4444";
  if (intent === "audit") return "#f59e0b";
  if (intent === "debug") return "#8b5cf6";
  if (intent === "navigate") return "#06b6d4";
  return "#10b981";
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
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null);
  const [activeSessionsCount, setActiveSessionsCount] = useState(0);
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const [sessionChunkCount, setSessionChunkCount] = useState<number | null>(
    null,
  );

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
        client.on("call-end", () => setIsCallActive(false));

        vapiRef.current = client;
      }

      await vapiRef.current.start(vapiAssistantId, {
        metadata: { sessionId },
      });
      setIsCallActive(true);
      setIngestStatus(`Call started with session ${sessionId}`);
    } catch (error) {
      console.error(error);
      setIngestStatus("Failed to start Vapi call");
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
      <section className="banner card">
        <div className="bannerItem">
          <span>Backend</span>
          <strong className={backendHealthy ? "ok" : "bad"}>
            {backendHealthy === null
              ? "Checking..."
              : backendHealthy
                ? "Healthy"
                : "Unavailable"}
          </strong>
        </div>
        <div className="bannerItem">
          <span>Active ingestion sessions</span>
          <strong>{activeSessionsCount}</strong>
        </div>
        <div className="bannerItem">
          <span>Current session</span>
          <strong>{sessionId || "Not created"}</strong>
        </div>
        <div className="bannerItem">
          <span>Session status</span>
          <strong>
            {sessionReady === null
              ? "Unknown"
              : sessionReady
                ? `Ready${sessionChunkCount !== null ? ` (${sessionChunkCount} chunks)` : ""}`
                : "Not ready"}
          </strong>
        </div>
      </section>

      <section className="hero card">
        <h1>HackBLR Dev Agent</h1>
        <p>
          Voice-first AI copilot for code debugging, audits, and live repository
          Q&amp;A.
        </p>
        <div className="intentRow">
          <span className="label">Detected intent</span>
          <span
            className="badge"
            style={{ backgroundColor: intentColor(currentIntent) }}
          >
            {currentIntent.toUpperCase()}
          </span>
        </div>
        <div className="buttons">
          <button onClick={startCall} disabled={loading || isCallActive}>
            Talk to Dev Agent
          </button>
          <button
            className="secondary"
            onClick={stopCall}
            disabled={!isCallActive}
          >
            End Call
          </button>
        </div>
        <small>{ingestStatus}</small>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Demo codebase selector</h2>
          <div className="demoRow">
            {DEMO_CODEBASES.map((item, i) => (
              <button
                key={item.label}
                className="secondary"
                onClick={() => ingestDemo(i)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Paste code</h2>
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="Filename"
          />
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste your code here..."
            rows={8}
          />
          <button onClick={ingestPaste} disabled={loading || !code.trim()}>
            Ingest pasted code
          </button>
        </div>

        <div className="card">
          <h2>Ingest GitHub repo</h2>
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/user/repo"
          />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
          />
          <button onClick={ingestGithub} disabled={loading || !repoUrl.trim()}>
            Ingest from GitHub
          </button>
        </div>

        <div className="card">
          <h2>Upload files</h2>
          <input
            type="file"
            multiple
            onChange={(e) =>
              setUploadedFiles(e.target.files ? Array.from(e.target.files) : [])
            }
          />
          {uploadedFiles.length > 0 && (
            <p className="muted uploadMeta">
              {uploadedFiles.length} file(s) selected:{" "}
              {uploadedFiles.map((file) => file.name).join(", ")}
            </p>
          )}
          <button
            onClick={ingestUpload}
            disabled={loading || uploadedFiles.length === 0}
          >
            Ingest uploaded files
          </button>
        </div>

        <div className="card transcript">
          <h2>Live transcript</h2>
          {transcript.length === 0 ? (
            <p className="muted">No transcript yet. Start a call and speak.</p>
          ) : (
            <div className="list">
              {transcript.map((line) => (
                <div key={line.id} className={`line ${line.role}`}>
                  <strong>{line.role === "user" ? "You" : "Agent"}:</strong>{" "}
                  {line.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
