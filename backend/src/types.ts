export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface Session {
  messages: Message[];
  lastActive: number;
}

export interface SessionMeta {
  sessionId: string;
  createdAt: number;
  source: "paste" | "github" | "upload";
  label: string;
  chunkCount: number;
  ready: boolean;
}

export interface IngestResult {
  sessionId: string;
  chunks: number;
  ready: boolean;
}

export interface QdrantChunkPayload {
  text: string;
  file: string;
  sessionId: string;
}
