import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { embedForQuery, chat, Message } from "./gemini";
import { qdrant, COLLECTION, ensureCollection } from "./qdrant";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

interface Session {
  messages: Message[];
  lastActive: number;
}

interface ChunkPayload {
  file?: string;
  text?: string;
}

type Intent = "error" | "audit" | "navigate" | "explain" | "debug";

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSION_MESSAGES = 10;
const sessions = new Map<string, Session>();

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
- If you found relevant code context, reference it naturally`;

const INTENT_PROMPT_ADDONS: Record<Intent, string> = {
  error:
    "Focus on identifying the root cause. Reference the specific file and function from context if found. Ask one follow-up question if needed.",
  audit:
    "You are doing a code audit. List the top 3 issues you find in the provided context. Be specific about file names.",
  navigate:
    "Help the developer find where something lives in the codebase. Reference exact file names from context.",
  explain:
    "Explain clearly how this works. Reference the actual code from context.",
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

function getSession(callId: string): Session {
  const existing = sessions.get(callId);
  if (existing) {
    existing.lastActive = Date.now();
    return existing;
  }
  const created: Session = { messages: [], lastActive: Date.now() };
  sessions.set(callId, created);
  return created;
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
): Promise<{ context: string; resultsCount: number }> {
  const queryVector = await embedForQuery(userMessage);
  const searchResults = await qdrant.search(COLLECTION, {
    vector: queryVector,
    limit: 3,
    score_threshold: 0.5,
  });
  return {
    context: formatContextFromResults(searchResults),
    resultsCount: searchResults.length,
  };
}

// Health check
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "HackBLR Dev Agent running 🚀" });
});

app.post("/llm", async (req: Request, res: Response) => {
  try {
    cleanupExpiredSessions();

    const requestMessages = (req.body?.messages || []) as {
      role: string;
      content: string;
    }[];
    const userMessage =
      [...requestMessages].reverse().find((m) => m.role === "user")?.content ||
      "";
    const callId = String(req.body?.call?.id || "default-session");
    const session = getSession(callId);
    const intent = detectIntent(userMessage);

    console.log(`🎯 Intent: ${intent}`);
    console.log(
      `🧠 Session: ${callId} — ${session.messages.length} messages in history`,
    );

    console.log(`\n🎤 User said: "${userMessage}"`);

    let context = "No specific codebase context found.";
    let searchResultsCount = 0;
    let intentInstruction = INTENT_PROMPT_ADDONS[intent];

    try {
      if (intent === "audit") {
        const scrolled = await qdrant.scroll(COLLECTION, {
          limit: 50,
          with_payload: true,
          with_vector: false,
        });
        const points = scrolled.points || [];
        context = formatContextFromResults(points);
        searchResultsCount = points.length;
        console.log(`📊 Audit mode: fetched ${points.length} chunks`);
      } else if (intent === "error") {
        const keywords = extractErrorKeywords(userMessage);
        console.log(`🐛 Error interpreter: extracted keywords "${keywords}"`);

        const [standardVector, keywordVector] = await Promise.all([
          embedForQuery(userMessage),
          keywords
            ? embedForQuery(keywords)
            : Promise.resolve<number[] | null>(null),
        ]);

        const [standardResults, keywordResults] = await Promise.all([
          qdrant.search(COLLECTION, {
            vector: standardVector,
            limit: 3,
            score_threshold: 0.5,
          }),
          keywordVector
            ? qdrant.search(COLLECTION, {
                vector: keywordVector,
                limit: 2,
                score_threshold: 0.3,
              })
            : Promise.resolve([]),
        ]);

        const seen = new Set<string>();
        const mergedResults = [...standardResults, ...keywordResults].filter(
          (item) => {
            const text = ((item.payload || {}) as ChunkPayload).text || "";
            if (seen.has(text)) return false;
            seen.add(text);
            return true;
          },
        );

        searchResultsCount = mergedResults.length;
        context = formatContextFromResults(mergedResults);

        const firstFile = ((mergedResults[0]?.payload || {}) as ChunkPayload)
          .file;
        const fileHint = firstFile
          ? ` The error appears to originate in ${firstFile}.`
          : "";
        intentInstruction +=
          " Identify which file and function this error likely originates from based on the context provided." +
          fileHint;
      } else {
        const basic = await basicRagResponse(userMessage);
        context = basic.context;
        searchResultsCount = basic.resultsCount;
      }
    } catch (featureErr) {
      console.error("⚠️ Feature fallback to basic RAG:", featureErr);
      try {
        const fallback = await basicRagResponse(userMessage);
        context = fallback.context;
        searchResultsCount = fallback.resultsCount;
      } catch (fallbackErr) {
        console.error("⚠️ Basic RAG fallback failed:", fallbackErr);
        context = "No specific codebase context found.";
        searchResultsCount = 0;
      }
    }

    console.log(`📚 Found ${searchResultsCount} relevant chunk(s)`);

    const dynamicSystemPrompt = `${SYSTEM_PROMPT}\n\n${intentInstruction}`;

    const promptWithContext =
      intent === "audit"
        ? `${AUDIT_PROMPT}\n\nCodebase context:\n${context}`
        : `Context:\n${context}\n\nQuestion: ${userMessage}`;

    const llmMessages: Message[] = [
      ...session.messages,
      { role: "user", content: promptWithContext },
    ];
    const maxTokens = intent === "audit" ? 300 : intent === "debug" ? 120 : 150;

    let answer = "";
    try {
      answer = await chat(dynamicSystemPrompt, llmMessages, maxTokens);
    } catch (chatErr) {
      console.error("⚠️ Chat failed, retrying basic response:", chatErr);
      answer =
        "I hit an issue while analyzing that. Can you rephrase the question?";
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

    res.json({
      id: "chatcmpl-hackblr",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: answer },
        finish_reason: "stop"
      }]
    });
  } catch (err) {
    console.error("❌ Error:", err);
    res.json({
      id: "chatcmpl-error",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Something went wrong, try again." },
        finish_reason: "stop"
      }]
    });
  }
});

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
        return res.json({ result: "ok" });
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
    }

    res.json({ result: "ok" });
  } catch (err) {
    console.error("❌ Error:", err);
    res.json({ result: "ok" });
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
