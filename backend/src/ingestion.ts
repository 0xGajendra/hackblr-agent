import { embedForStorage } from "./gemini";
import { upsertChunk } from "./qdrant";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkWithOverlap(
  text: string,
  chunkSize = 400,
  overlap = 50,
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;

  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.trim().length > 20) {
      chunks.push(chunk);
    }
    i += chunkSize - overlap;
  }

  return chunks;
}

export async function ingestChunks(
  sessionId: string,
  content: string,
  filename: string,
): Promise<number> {
  console.log(`📥 Ingesting ${filename} for session ${sessionId}...`);

  const chunks = chunkWithOverlap(content);

  for (const chunk of chunks) {
    const vector = await embedForStorage(chunk);
    await upsertChunk(sessionId, vector, chunk, filename);
    await sleep(100);
  }

  console.log(`✅ ${filename}: ${chunks.length} chunks embedded`);
  return chunks.length;
}
