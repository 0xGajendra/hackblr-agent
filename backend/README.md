# HackBLR Backend 🎤

Voice-native developer experience agent built with Vapi + Groq + Gemini + Qdrant.

## Prerequisites

- Node.js 18+
- Docker (for Qdrant vector database)
- API keys for Groq, Gemini, and Qdrant

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env

# 3. Add your API keys to .env
# Required: GROQ_API_KEY, GEMINI_API_KEY, QDRANT_URL, QDRANT_API_KEY

# 4. Start Qdrant via Docker
docker run -p 6333:6333 qdrant/qdrant

# 5. Start the server
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Your Groq API key (for LLM) |
| `GEMINI_API_KEY` | Your Google Gemini API key (for embeddings) |
| `QDRANT_URL` | Qdrant vector DB URL |
| `QDRANT_API_KEY` | Qdrant API key |
| `PORT` | Server port (default: 3000) |
| `FRONTEND_URL` | Frontend URL for CORS |

## API Endpoints

- `POST /ingest/paste` - Ingest pasted code
- `POST /ingest/github` - Ingest GitHub repository
- `POST /ingest/upload` - Ingest uploaded files
- `GET /ingest/status/:sessionId` - Check ingestion status
- `GET /sessions` - List active sessions
- `POST /llm` - LLM endpoint (OpenAI-compatible)
- `POST /vapi-webhook` - Vapi webhook handler

## Expose to Internet

For Vapi to reach your local server, use ngrok:

```bash
npx ngrok http 3000
```

Then configure your Vapi assistant to use your custom LLM endpoint at `https://your-ngrok-url/llm`.

## Stack

- Voice: Vapi
- LLM: Groq (Llama 3.1 8B Instant)
- Embeddings: Gemini (gemini-embedding-001)
- Vector DB: Qdrant
- Backend: Node.js / Express / TypeScript