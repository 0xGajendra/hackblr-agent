import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const groq = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY!,
});

export async function embedForStorage(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  const result = await model.embedContent({
    content: { parts: [{ text }], role: "user" },
    taskType: TaskType.RETRIEVAL_DOCUMENT,
  });
  return result.embedding.values;
}

export async function embedForQuery(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  const result = await model.embedContent({
    content: { parts: [{ text }], role: "user" },
    taskType: TaskType.RETRIEVAL_QUERY,
  });
  return result.embedding.values;
}

export async function chat(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  console.log(`🤖 Calling Groq...`);
  const response = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 150,
  });
  const answer = response.choices[0].message.content || "";
  console.log(`✅ Got response from Groq`);
  return answer;
}
