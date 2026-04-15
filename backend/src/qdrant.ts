import { QdrantClient } from "@qdrant/js-client-rest";
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";
import { QdrantChunkPayload } from "./types";
dotenv.config();

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

export const COLLECTION = "codebase";
export const VECTOR_SIZE = 3072; // gemini-embedding-001 output dims

function getQdrantErrorMessage(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }

  if (err && typeof err === "object") {
    const maybeErr = err as {
      message?: string;
      data?: { status?: { error?: string } };
    };
    return maybeErr.data?.status?.error || maybeErr.message || "";
  }

  return "";
}

async function ensureSessionIdIndex() {
  try {
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: "sessionId",
      field_schema: "keyword",
    });
    console.log("✅ Ensured Qdrant payload index: sessionId");
  } catch (err) {
    const msg = getQdrantErrorMessage(err);
    if (/already exists|is already indexed|same name/i.test(msg)) {
      return;
    }

    throw err;
  }
}

export async function ensureCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);
  if (!exists) {
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    console.log(`✅ Created Qdrant collection: ${COLLECTION}`);
  }

  await ensureSessionIdIndex();
}

export async function upsertChunk(
  sessionId: string,
  vector: number[],
  text: string,
  file: string,
): Promise<void> {
  const payload: QdrantChunkPayload = {
    text,
    file,
    sessionId,
  };

  await qdrant.upsert(COLLECTION, {
    points: [
      {
        id: uuid(),
        vector,
        payload: payload as unknown as Record<string, unknown>,
      },
    ],
  });
}

export async function searchBySession(
  sessionId: string,
  vector: number[],
  limit: number,
  scoreThreshold: number,
): Promise<any[]> {
  const results = await qdrant.search(COLLECTION, {
    vector,
    limit,
    score_threshold: scoreThreshold,
    filter: {
      must: [{ key: "sessionId", match: { value: sessionId } }],
    },
  });

  return results;
}

export async function scrollBySession(
  sessionId: string,
  limit: number,
): Promise<any[]> {
  const scrolled = await qdrant.scroll(COLLECTION, {
    limit,
    with_payload: true,
    with_vector: false,
    filter: {
      must: [{ key: "sessionId", match: { value: sessionId } }],
    },
  });

  return scrolled.points || [];
}

export async function deleteSession(sessionId: string): Promise<void> {
  await qdrant.delete(COLLECTION, {
    filter: {
      must: [{ key: "sessionId", match: { value: sessionId } }],
    },
  });
}
