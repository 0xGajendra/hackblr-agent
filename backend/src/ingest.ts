import * as fs from "fs";
import * as path from "path";
import { v4 as uuid } from "uuid";
import { embedForStorage } from "./gemini";
import { qdrant, COLLECTION, ensureCollection } from "./qdrant";

const CODEBASE_DIR = path.join(__dirname, "demo-codebase");
const SUPPORTED_EXTS = [".ts", ".js", ".py", ".md", ".txt", ".json"];

function chunkText(text: string, maxWords = 400): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunk = words.slice(i, i + maxWords).join(" ").trim();
    if (chunk.length > 20) chunks.push(chunk);
  }
  return chunks;
}

async function ingest() {
  await ensureCollection();

  const files = fs
    .readdirSync(CODEBASE_DIR)
    .filter((f) => SUPPORTED_EXTS.includes(path.extname(f)));

  if (files.length === 0) {
    console.log("⚠️  No files found in src/demo-codebase/");
    console.log("   Add .ts/.js/.py/.md files there and re-run.");
    return;
  }

  console.log(`📂 Found ${files.length} file(s) to ingest...\n`);

  for (const file of files) {
    const content = fs.readFileSync(path.join(CODEBASE_DIR, file), "utf-8");
    const chunks = chunkText(content);
    process.stdout.write(`  Ingesting ${file} (${chunks.length} chunks)...`);

    for (const chunk of chunks) {
      const vector = await embedForStorage(chunk);
      await qdrant.upsert(COLLECTION, {
        points: [{ id: uuid(), vector, payload: { text: chunk, file } }],
      });
    }
    console.log(" ✅");
  }

  console.log("\n🎉 Codebase ingested into Qdrant successfully!");
}

ingest().catch(console.error);
