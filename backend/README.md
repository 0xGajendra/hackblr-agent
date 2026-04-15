# HackBLR Dev Agent 🎤

Voice-native developer experience agent built with Vapi + Gemini + Qdrant.

## Setup

1. Add your keys to `.env`
2. Add your codebase files to `src/demo-codebase/`
3. Start Qdrant via Docker
4. Ingest your codebase
5. Start the server
6. Expose via ngrok → paste URL into Vapi dashboard

## Commands

```bash
# Start Qdrant
docker run -p 6333:6333 qdrant/qdrant

# Ingest codebase
npm run ingest

# Start server
npm run dev

# Expose to internet
npx ngrok http 3000
```

## Stack

- Voice: Vapi
- LLM: gemini-2.5-flash
- Embeddings: gemini-embedding-001
- Vector DB: Qdrant
- Backend: Node.js / TypeScript
