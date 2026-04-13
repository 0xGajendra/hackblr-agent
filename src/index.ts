import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { embedForQuery, chat } from "./gemini";
import { qdrant, COLLECTION, ensureCollection } from "./qdrant";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const SYSTEM_PROMPT = `You are a voice-first developer assistant. 
Your responses will be spoken aloud via text-to-speech, so:
- Keep answers concise and conversational (2-4 sentences max)
- No markdown, no bullet points, no code blocks
- Speak like a senior dev helping a teammate
- If you found relevant code context, reference it naturally`;

// Health check
app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "HackBLR Dev Agent running 🚀" });
});
app.post("/llm", async (req: Request, res: Response) => {
  try {
    const messages = req.body?.messages as { role: string; content: string }[];
    const userMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";

    console.log(`\n🎤 User said: "${userMessage}"`);

    const queryVector = await embedForQuery(userMessage);
    const searchResults = await qdrant.search(COLLECTION, {
      vector: queryVector,
      limit: 3,
      score_threshold: 0.5,
    });
    const context = searchResults.length > 0
      ? searchResults.map((r) => `[${(r.payload as any).file}]\n${(r.payload as any).text}`).join("\n\n---\n\n")
      : "No specific codebase context found.";

    console.log(`📚 Found ${searchResults.length} relevant chunk(s)`);

    const answer = await chat(SYSTEM_PROMPT, `Context:\n${context}\n\nQuestion: ${userMessage}`);
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
    // Vapi sends different event types — handle the message event
    const body = req.body;
    const messageType = body?.message?.type;

    // Only process user speech messages
    if (messageType !== "transcript" && messageType !== "function-call") {
      return res.json({ result: "ok" });
    }

    const userMessage: string =
      body?.message?.transcript ||
      body?.message?.functionCall?.parameters?.query ||
      "";

    if (!userMessage.trim()) {
      return res.json({ result: "I didn't catch that, could you repeat?" });
    }

    console.log(`\n🎤 User said: "${userMessage}"`);

    // 1. Embed the query
    const queryVector = await embedForQuery(userMessage);

    // 2. Search Qdrant for relevant code context
    const searchResults = await qdrant.search(COLLECTION, {
      vector: queryVector,
      limit: 3,
      score_threshold: 0.5,
    });

    const context =
      searchResults.length > 0
        ? searchResults
            .map((r) => `[${(r.payload as any).file}]\n${(r.payload as any).text}`)
            .join("\n\n---\n\n")
        : "No specific codebase context found.";

    console.log(`📚 Found ${searchResults.length} relevant chunk(s) from Qdrant`);

    // 3. Build prompt with context
    const promptWithContext = `Relevant codebase context:\n${context}\n\nDeveloper's question: ${userMessage}`;

    // 4. Get Gemini response
    const answer = await chat(SYSTEM_PROMPT, promptWithContext);
    console.log(`🤖 Response: ${answer}\n`);

    // 5. Return to Vapi
    res.json({ result: answer });
  } catch (err) {
    console.error("❌ Error:", err);
    res.json({ result: "Something went wrong on my end. Try asking again." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await ensureCollection();
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📡 Vapi webhook: http://localhost:${PORT}/vapi-webhook`);
  console.log(`💡 Run ngrok: npx ngrok http ${PORT}\n`);
});
