import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { embedForQuery, chat } from "./gemini";
import {
  qdrant,
  COLLECTION,
  ensureCollection,
  searchBySession,
  scrollBySession,
} from "./qdrant";
import { ingestChunks } from "./ingestion";
import {
  createSession as createIngestionSession,
  getSession as getIngestionSession,
  listSessions,
  markReady,
} from "./sessions";
import { Message, Session, SessionMeta } from "./types";
dotenv.config();

const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      process.env.FRONTEND_URL || "*",
    ],
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "10mb" }));

interface ChunkPayload {
  file?: string;
  text?: string;
}

interface GithubTreeEntry {
  path: string;
  type: string;
  size?: number;
}

interface GithubTreeResponse {
  tree?: GithubTreeEntry[];
}

interface UploadFileInput {
  filename?: string;
  content?: string;
}

type Intent = "error" | "audit" | "navigate" | "explain" | "debug";

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSION_MESSAGES = 10;
const sessions = new Map<string, Session>();
const callToRagSession = new Map<string, string>();

const DEBUG_FOLLOW_UPS = [
  "Can you tell me when this started happening?",
  "Does this happen every time or only sometimes?",
  "What does the data look like just before this fails?",
  "Have you made any recent changes to this part of the code?",
];

const SYSTEM_PROMPT = `You are a voice-first developer assistant. 
Your responses will be spoken aloud via text-to-speech, so:
- Keep answers concise and conversational (2-4 sentences max)
- No markdown, no bullet points, no code blocks
- Speak like a senior dev helping a teammate
- Only describe what you actually found in the provided code context - NEVER make up file names, functions, or implementation details that aren't in the context
- If the context doesn't contain enough information to answer a question, say "I don't see that in the provided code" rather than guessing`;

const INTENT_PROMPT_ADDONS: Record<Intent, string> = {
  error:
    "Focus on identifying the root cause. Reference the specific file and function from context if found. Ask one follow-up question if needed.",
  audit:
    "You are doing a code audit. List the top 3 issues you find in the provided context. Be specific about file names.",
  navigate:
    "Help the developer find where something lives in the codebase. Reference exact file names from context.",
  explain:
    "When explaining HOW the code was built: describe the actual code structure, functions, and logic you found in the context. Be specific - mention actual file names, function names, and how they work together. Don't make up details that aren't in the provided code.",
  debug:
    "You are pair debugging. Ask targeted questions to narrow down the issue. Reference relevant code from context.",
};

const AUDIT_PROMPT = `You are auditing this codebase. Analyze ALL the code provided and identify:
1. Missing error handling (try/catch)
2. Security issues (hardcoded secrets, unsafe comparisons, SQL injection risks)
3. TODO or FIXME comments
4. Stub functions that aren't implemented
5. Any other serious issues

Respond conversationally in 4-5 sentences as if speaking aloud. Start with the most critical issue.`;

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [callId, session] of sessions.entries()) {
    if (now - session.lastActive > SESSION_TTL_MS) {
      sessions.delete(callId);
    }
  }
}

function getConversationSession(callId: string): Session {
  const existing = sessions.get(callId);
  if (existing) {
    existing.lastActive = Date.now();
    return existing;
  }
  const created: Session = { messages: [], lastActive: Date.now() };
  sessions.set(callId, created);
  return created;
}

function setRagSession(callId: string, ragSessionId: string): void {
  callToRagSession.set(callId, ragSessionId);
}

function getRagSession(callId: string): string | undefined {
  return callToRagSession.get(callId);
}

function parseGithubRepo(
  repoUrl: string,
): { owner: string; repo: string } | null {
  const match = repoUrl
    .trim()
    .match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/#?]+)(?:[\/#?].*)?$/i);
  if (!match) {
    return null;
  }

  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");

  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function isIngestionSessionReady(sessionId?: string): boolean {
  if (!sessionId) {
    return false;
  }
  const session = getIngestionSession(sessionId);
  return Boolean(session?.ready);
}

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= MAX_SESSION_MESSAGES) {
    return messages;
  }
  return messages.slice(-MAX_SESSION_MESSAGES);
}

function detectIntent(message: string): Intent {
  const text = message.toLowerCase();

  if (/error|exception|crash|stacktrace|undefined|null/.test(text))
    return "error";
  if (/audit|review|check my code|health check|what'?s wrong/.test(text))
    return "audit";
  if (/where|find the function|which file|where is|located/.test(text))
    return "navigate";
  if (/how|what does|explain|works/.test(text)) return "explain";
  if (/not working|bug|unexpected|fails|failing|issue/.test(text))
    return "debug";

  return "explain";
}

function extractErrorKeywords(message: string): string {
  const matches = message.match(/[a-z][a-zA-Z]+/g) || [];
  return matches.filter((w) => w.length > 3).join(" ");
}

function formatContextFromResults(
  results: Array<{ payload?: unknown }>,
): string {
  if (!results.length) {
    return "No specific codebase context found.";
  }

  return results
    .map((r) => {
      const payload = (r.payload || {}) as ChunkPayload;
      const file = payload.file || "unknown-file";
      const text = payload.text || "";
      return `[${file}]\n${text}`;
    })
    .join("\n\n---\n\n");
}

async function basicRagResponse(
  userMessage: string,
  sessionId?: string,
): Promise<{ context: string; resultsCount: number }> {
  const queryVector = await embedForQuery(userMessage);
  const searchResults = sessionId
    ? await searchBySession(sessionId, queryVector, 3, 0.5)
    : await qdrant.search(COLLECTION, {
        vector: queryVector,
        limit: 3,
        score_threshold: 0.5,
      });

  return {
    context: formatContextFromResults(searchResults),
    resultsCount: searchResults.length,
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }) as Promise<T>;
}

function fallbackAssistantMessage(userMessage: string): string {
  const safeMessage = userMessage?.trim();
  if (!safeMessage) {
    return "I’m here and ready. Share the code issue and I’ll help step by step.";
  }

  return "I hit a temporary provider issue while processing that. Please repeat your question once and I’ll continue.";
}

app.post("/ingest/paste", async (req: Request, res: Response) => {
  try {
    const code = req.body?.code;
    const filenameRaw = req.body?.filename;
    const existingSessionId = req.body?.sessionId;

    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ error: "code must be a non-empty string" });
    }

    if (code.length > 500000) {
      return res
        .status(400)
        .json({ error: "code exceeds max length of 500000 characters" });
    }

    const filename =
      typeof filenameRaw === "string" && filenameRaw.trim()
        ? filenameRaw.trim()
        : "pasted-code.ts";

    let sessionId =
      typeof existingSessionId === "string" && existingSessionId.trim()
        ? existingSessionId.trim()
        : "";

    let meta = sessionId ? getIngestionSession(sessionId) : undefined;
    if (!meta) {
      sessionId = createIngestionSession("paste", filename);
      meta = getIngestionSession(sessionId);
    }

    const chunks = await ingestChunks(sessionId, code, filename);
    const totalChunks = (meta?.chunkCount || 0) + chunks;
    markReady(sessionId, totalChunks);

    console.log(
      `🎉 Session ${sessionId} ready: ${totalChunks} total chunks from 1 files`,
    );

    return res.json({
      sessionId,
      filename,
      chunks,
      ready: true,
    });
  } catch (err) {
    console.error("❌ /ingest/paste failed:", err);
    return res.status(500).json({ error: "Failed to ingest pasted code" });
  }
});

app.post("/ingest/upload", async (req: Request, res: Response) => {
  try {
    const files = Array.isArray(req.body?.files)
      ? (req.body.files as UploadFileInput[])
      : [];
    const existingSessionId = req.body?.sessionId;

    if (!files.length) {
      return res.status(400).json({ error: "files must be a non-empty array" });
    }

    if (files.length > 30) {
      return res.status(400).json({ error: "Maximum 30 files per upload" });
    }

    let sessionId =
      typeof existingSessionId === "string" && existingSessionId.trim()
        ? existingSessionId.trim()
        : "";

    let meta = sessionId ? getIngestionSession(sessionId) : undefined;
    if (!meta) {
      sessionId = createIngestionSession("upload", "Uploaded Files");
      meta = getIngestionSession(sessionId);
    }

    let totalChunks = meta?.chunkCount || 0;
    let filesIngested = 0;

    for (const file of files) {
      const filename =
        typeof file.filename === "string" && file.filename.trim()
          ? file.filename.trim()
          : `upload-${filesIngested + 1}.txt`;
      const content = typeof file.content === "string" ? file.content : "";

      if (!content.trim()) {
        continue;
      }

      if (content.length > 500000) {
        return res.status(400).json({
          error: `File ${filename} exceeds max length of 500000 characters`,
        });
      }

      const chunks = await ingestChunks(sessionId, content, filename);
      totalChunks += chunks;
      filesIngested += 1;
    }

    markReady(sessionId, totalChunks);
    console.log(
      `🎉 Session ${sessionId} ready: ${totalChunks} total chunks from ${filesIngested} files`,
    );

    return res.json({
      sessionId,
      filesIngested,
      totalChunks,
      ready: true,
    });
  } catch (err) {
    console.error("❌ /ingest/upload failed:", err);
    return res.status(500).json({ error: "Failed to ingest uploaded files" });
  }
});

app.post("/ingest/github", async (req: Request, res: Response) => {
  try {
    const repoUrl = String(req.body?.repoUrl || "").trim();
    const requestedBranch = String(req.body?.branch || "main").trim() || "main";

    if (!repoUrl) {
      return res.status(400).json({ error: "repoUrl is required" });
    }

    const parsed = parseGithubRepo(repoUrl);
    if (!parsed) {
      return res.status(400).json({ error: "Invalid GitHub repository URL" });
    }

    const { owner, repo } = parsed;
    const branches = [...new Set([requestedBranch, "main", "master"])];

    let resolvedBranch: string | null = null;
    let treeData: GithubTreeResponse | null = null;

    for (const branch of branches) {
      console.log(
        `🐙 Fetching GitHub repo: ${owner}/${repo} branch: ${branch}`,
      );
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        {
          headers: { "User-Agent": "hackblr-dev-agent" },
        },
      );

      if (treeRes.status === 403) {
        return res
          .status(429)
          .json({ error: "GitHub rate limit hit, try again in a minute" });
      }

      if (treeRes.status === 404) {
        continue;
      }

      if (!treeRes.ok) {
        return res.status(502).json({
          error: `GitHub API request failed with status ${treeRes.status}`,
        });
      }

      treeData = (await treeRes.json()) as GithubTreeResponse;
      resolvedBranch = branch;
      break;
    }

    if (!treeData || !resolvedBranch) {
      return res
        .status(404)
        .json({ error: "Repository not found or is private" });
    }

    const allowedExtensions = new Set([
      ".ts",
      ".js",
      ".py",
      ".go",
      ".java",
      ".cpp",
      ".c",
      ".md",
      ".json",
    ]);

    const files = (treeData.tree || [])
      .filter((entry) => entry.type === "blob")
      .filter((entry) => {
        const lowerPath = entry.path.toLowerCase();
        if (lowerPath.endsWith(".env.example")) {
          return true;
        }

        const dotIndex = lowerPath.lastIndexOf(".");
        if (dotIndex < 0) {
          return false;
        }

        const ext = lowerPath.slice(dotIndex);
        return allowedExtensions.has(ext);
      })
      .filter((entry) => (entry.size || 0) <= 100 * 1024)
      .slice(0, 30);

    console.log(`📁 Found ${files.length} files to ingest`);

    const sessionId = createIngestionSession("github", repoUrl);
    let totalChunks = 0;
    let filesIngested = 0;

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      console.log(`📥 [${i + 1}/${files.length}] Ingesting ${file.path}...`);

      try {
        const rawRes = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${resolvedBranch}/${file.path}`,
          {
            headers: { "User-Agent": "hackblr-dev-agent" },
          },
        );

        if (rawRes.status === 403) {
          return res
            .status(429)
            .json({ error: "GitHub rate limit hit, try again in a minute" });
        }

        if (!rawRes.ok) {
          console.warn(`⚠️ Skipping ${file.path}: HTTP ${rawRes.status}`);
          continue;
        }

        const content = await rawRes.text();
        if (!content.trim()) {
          continue;
        }

        const chunks = await ingestChunks(sessionId, content, file.path);
        totalChunks += chunks;
        filesIngested += 1;
      } catch (fileErr) {
        console.error(`⚠️ Failed to ingest ${file.path}:`, fileErr);
      }
    }

    markReady(sessionId, totalChunks);
    console.log(
      `🎉 Session ${sessionId} ready: ${totalChunks} total chunks from ${filesIngested} files`,
    );

    return res.json({
      sessionId,
      repo: `${owner}/${repo}`,
      filesIngested,
      totalChunks,
      ready: true,
    });
  } catch (err) {
    console.error("❌ /ingest/github failed:", err);
    return res
      .status(500)
      .json({ error: "Failed to ingest GitHub repository" });
  }
});

app.get("/ingest/status/:sessionId", (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();
    const session = getIngestionSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    return res.json({
      sessionId: session.sessionId,
      ready: session.ready,
      source: session.source,
      label: session.label,
      chunkCount: session.chunkCount,
      createdAt: session.createdAt,
    });
  } catch (err) {
    console.error("❌ /ingest/status failed:", err);
    return res.status(500).json({ error: "Failed to fetch session status" });
  }
});

app.get("/sessions", (_req: Request, res: Response) => {
  try {
    const activeSessions = listSessions();
    return res.json({ sessions: activeSessions });
  } catch (err) {
    console.error("❌ /sessions failed:", err);
    return res.status(500).json({ error: "Failed to list sessions" });
  }
});

// Health check
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "HackBLR Dev Agent running 🚀" });
});

const handleLlmRequest = async (req: Request, res: Response) => {
  try {
    console.log("🔥 /llm request received:", JSON.stringify(req.body).slice(0, 200));
    const startedAt = Date.now();
    cleanupExpiredSessions();

    const requestMessages = (req.body?.messages || []) as {
      role: string;
      content: string;
    }[];
    const userMessage =
      [...requestMessages].reverse().find((m) => m.role === "user")?.content ||
      "";
    const callId = String(req.body?.call?.id || "default-session");
    const session = getConversationSession(callId);
    const intent = detectIntent(userMessage);
    const incomingSessionId = req.body?.call?.metadata?.sessionId as
      | string
      | undefined;
    const mappedSessionId = getRagSession(callId);
    const ragSessionId = isIngestionSessionReady(incomingSessionId)
      ? incomingSessionId
      : isIngestionSessionReady(mappedSessionId)
      ? mappedSessionId
      : undefined;

    console.log(`🎯 Intent: ${intent}`);
    console.log(`🔑 Session: ${ragSessionId ?? "global"}`);
    console.log(
      `🧠 Session: ${callId} — ${session.messages.length} messages in history`,
    );

    console.log(`\n🎤 User said: "${userMessage}"`);

    let context = "No specific codebase context found.";
    let searchResultsCount = 0;
    let intentInstruction = INTENT_PROMPT_ADDONS[intent];

    try {
      if (!ragSessionId) {
        console.log("⚠️ No RAG session - skipping context");
        context = "No codebase context available.";
        searchResultsCount = 0;
      } else if (intent === "audit") {
        const points = await scrollBySession(ragSessionId, 50);
        context = formatContextFromResults(points);
        searchResultsCount = points.length;
        console.log(`📊 Audit mode: fetched ${points.length} chunks`);
      } else if (intent === "error") {
        const keywords = extractErrorKeywords(userMessage);
        console.log(`🐛 Error interpreter: extracted keywords "${keywords}"`);
        const [standardVector, keywordVector] = await Promise.all([
          embedForQuery(userMessage),
          keywords ? embedForQuery(keywords) : Promise.resolve<number[] | null>(null),
        ]);
        const [standardResults, keywordResults] = await Promise.all([
          searchBySession(ragSessionId, standardVector, 3, 0.5),
          keywordVector ? searchBySession(ragSessionId, keywordVector, 2, 0.3) : Promise.resolve([]),
        ]);
        const seen = new Set<string>();
        const mergedResults = [...standardResults, ...keywordResults].filter((item) => {
          const text = ((item.payload || {}) as ChunkPayload).text || "";
          if (seen.has(text)) return false;
          seen.add(text);
          return true;
        });
        searchResultsCount = mergedResults.length;
        context = formatContextFromResults(mergedResults);
        const firstFile = ((mergedResults[0]?.payload || {}) as ChunkPayload).file;
        if (firstFile) {
          intentInstruction += ` The error appears to originate in ${firstFile}.`;
        }
      } else {
        const basic = await withTimeout(basicRagResponse(userMessage, ragSessionId), 4500, "basicRagResponse");
        context = basic.context;
        searchResultsCount = basic.resultsCount;
      }
    } catch (featureErr) {
      console.error("⚠️ RAG error:", featureErr);
      context = "No codebase context available.";
      searchResultsCount = 0;
    }

    console.log(`📚 Found ${searchResultsCount} relevant chunk(s)`);

    const dynamicSystemPrompt = `${SYSTEM_PROMPT}\n\n${intentInstruction}`;

    const promptWithContext =
      intent === "audit"
        ? `${AUDIT_PROMPT}\n\nCodebase context:\n${context}`
        : `IMPORTANT: Only answer based on the EXACT code below. If the question cannot be answered from this code, say "I don't see that in the provided code." Do not guess or infer.\n\nCodebase context:\n${context}\n\nQuestion: ${userMessage}`;

    const llmMessages: Message[] = [
      ...session.messages,
      { role: "user", content: promptWithContext },
    ];
    const maxTokens = intent === "audit" ? 300 : intent === "debug" ? 120 : 150;

    let answer = "";
    try {
      answer = await withTimeout(
        chat(dynamicSystemPrompt, llmMessages, maxTokens),
        6000,
        "chat",
      );
    } catch (chatErr) {
      console.error("⚠️ Chat failed, retrying basic response:", chatErr);
      answer = fallbackAssistantMessage(userMessage);
    }

    if (!answer || !answer.trim()) {
      answer = fallbackAssistantMessage(userMessage);
    }

    if (
      intent === "debug" &&
      !answer.includes("?") &&
      searchResultsCount <= 1
    ) {
      try {
        const followUp =
          DEBUG_FOLLOW_UPS[Math.floor(Math.random() * DEBUG_FOLLOW_UPS.length)];
        answer = `${answer} Also — ${followUp}`;
        console.log("🔁 Multi-turn: appending follow-up question");
      } catch (followErr) {
        console.error("⚠️ Multi-turn follow-up failed:", followErr);
      }
    }

    const updatedHistory = trimHistory([
      ...session.messages,
      { role: "user", content: userMessage },
      { role: "assistant", content: answer },
    ]);

    sessions.set(callId, {
      messages: updatedHistory,
      lastActive: Date.now(),
    });

    console.log(`🤖 Response: ${answer}\n`);
    console.log(`⏱️ /llm latency: ${Date.now() - startedAt}ms`);
    console.log(`📤 Sending response:`, JSON.stringify({ choices: [{ message: { content: answer } }] }).slice(0, 200));

    const stream = req.body?.stream === true;
    
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const chunks = answer.split(" ");
      for (let i = 0; i < chunks.length; i++) {
        const delta = chunks[i] + (i < chunks.length - 1 ? " " : "");
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: "stop" }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.json({
        id: "chatcmpl-hackblr",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: answer },
            finish_reason: "stop",
          },
        ],
      });
    }
  } catch (err) {
    console.error("❌ Error in /llm:", err);
    res.json({
      id: "chatcmpl-error",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Something went wrong, try again.",
          },
          finish_reason: "stop",
        },
      ],
    });
  }
};

app.post("/llm", handleLlmRequest);
app.post("/llm/chat/completions", handleLlmRequest);
app.post("/chat/completions", handleLlmRequest);

// Also handle Vapi's expected format for custom LLM
app.post("/v1/chat/completions", handleLlmRequest);

// Vapi webhook
app.post("/vapi-webhook", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const eventType = body?.message?.type || body?.type;
    const callId = String(body?.call?.id || "");

    if (eventType === "end-of-call-report" && callId) {
      cleanupExpiredSessions();
      const session = sessions.get(callId);
      if (!session) {
        return res.json({ response: "ok" });
      }

      let summary =
        "In this session, we discussed code issues and next steps to continue debugging.";

      try {
        summary = await chat(
          `Summarize this debugging session in exactly 2-3 sentences spoken aloud. 
Cover: what problems were discussed, what was found, and what was recommended.
Start with "In this session,"`,
          session.messages,
          100,
        );
      } catch (summaryErr) {
        console.error("⚠️ Session summary generation failed:", summaryErr);
      }

      console.log(`📝 Session Summary: ${summary}`);

      try {
        const logPath = path.resolve(process.cwd(), "sessions.log");
        const line = `${new Date().toISOString()} | ${callId} | ${summary}\n`;
        await fs.promises.appendFile(logPath, line, "utf8");
        console.log("📝 Session summary saved");
      } catch (fileErr) {
        console.error("⚠️ Failed to write session summary:", fileErr);
      }

      sessions.delete(callId);
      callToRagSession.delete(callId);
      return res.json({ response: "ok" });
    }

    if (eventType === "conversation-update" || eventType === "transcript") {
      const userMessage = String(body?.message?.content || body?.message?.transcript || "").trim();
      const incomingSessionId = body?.call?.metadata?.sessionId as string | undefined;
      const ragSessionId = isIngestionSessionReady(incomingSessionId) ? incomingSessionId : undefined;

      if (callId && ragSessionId) {
        setRagSession(callId, ragSessionId);
        console.log(`🔗 Mapped call ${callId} -> RAG session ${ragSessionId}`);
      }

      if (!userMessage) {
        return res.json({ response: "I didn't catch that. Can you repeat?" });
      }

      console.log(`\n🎤 Vapi User said: "${userMessage}"`);

      const intent = detectIntent(userMessage);
      console.log(`🎯 Intent: ${intent}`);

      let context = "No specific codebase context found.";
      let searchResultsCount = 0;
      let intentInstruction = INTENT_PROMPT_ADDONS[intent];

      try {
        const basic = await withTimeout(
          basicRagResponse(userMessage, ragSessionId),
          4500,
          "basicRagResponse",
        );
        context = basic.context;
        searchResultsCount = basic.resultsCount;
      } catch (featureErr) {
        console.error("⚠️ RAG fallback:", featureErr);
        context = "No specific codebase context found.";
        searchResultsCount = 0;
      }

      console.log(`📚 Found ${searchResultsCount} relevant chunk(s)`);

      const dynamicSystemPrompt = `${SYSTEM_PROMPT}\n\n${intentInstruction}`;
      const promptWithContext = `Context:\n${context}\n\nQuestion: ${userMessage}`;

      const session = getConversationSession(callId);
      const llmMessages: Message[] = [
        ...session.messages,
        { role: "user", content: promptWithContext },
      ];
const maxTokens = intent === "audit" ? 300 : intent === "debug" ? 120 : intent === "explain" ? 200 : 150;

      let answer = "";
      try {
        answer = await withTimeout(
          chat(dynamicSystemPrompt, llmMessages, maxTokens),
          6000,
          "chat",
        );
      } catch (chatErr) {
        console.error("⚠️ Chat failed:", chatErr);
        answer = fallbackAssistantMessage(userMessage);
      }

      if (!answer || !answer.trim()) {
        answer = fallbackAssistantMessage(userMessage);
      }

      const updatedHistory = trimHistory([
        ...session.messages,
        { role: "user", content: userMessage },
        { role: "assistant", content: answer },
      ]);

      sessions.set(callId, {
        messages: updatedHistory,
        lastActive: Date.now(),
      });

      console.log(`🤖 Vapi Response: ${answer}\n`);

      return res.json({ response: answer });
    }

    return res.json({ response: "ok" });
  } catch (err) {
    console.error("❌ Vapi webhook error:", err);
    res.json({ response: "Something went wrong, try again." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    await ensureCollection();
    console.log("✅ Qdrant connection ready");
  } catch (err) {
    console.error(
      "⚠️ Qdrant unavailable at startup. Running in degraded mode without vector search.",
      err,
    );
  }
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📡 Vapi webhook: http://localhost:${PORT}/vapi-webhook`);
  console.log(`💡 Run ngrok: npx ngrok http ${PORT}\n`);
});
