import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

export const qdrant = new QdrantClient({ url: process.env.QDRANT_URL! });

export const COLLECTION = "codebase";
export const VECTOR_SIZE = 3072; // gemini-embedding-001 output dims

export async function ensureCollection() {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);
  if (!exists) {
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    console.log(`✅ Created Qdrant collection: ${COLLECTION}`);
  }
}
