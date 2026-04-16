# HackBLR 🎤

Voice-first developer assistant that lets you talk to your codebase. Ask about errors, audit code, or explain how anything works through a voice conversation.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/0xGajendra/hackblr-agent.git
cd hackblr
```

Then follow the setup guides in `backend/` and `frontend/` directories.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Vapi      │────▶│   Backend   │────▶│   Qdrant    │
│  (Voice)    │     │  (Express)  │     │  (Vectors)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │    Groq     │
                    │  (Llama)    │
                    └─────────────┘
```

- **Voice**: Vapi for voice calls
- **Backend**: Express.js + TypeScript
- **LLM**: Groq (Llama 3.3 70B)
- **Embeddings**: Google Gemini (gemini-embedding-001)
- **Vector DB**: Qdrant for session-isolated RAG
- **Frontend**: Next.js 14

## Features

- Voice-first interface - talk to your code naturally
- Session-isolated RAG - each conversation gets its own context
- Multiple code ingestion methods: paste, GitHub repo, file upload
- Intent detection - automatically identifies if you're debugging, auditing, or exploring
- Dark/Light theme support
- Real-time transcript display

## Project Structure

```
hackblr/
├── backend/          # Express.js API server
│   ├── src/
│   │   ├── index.ts       # Main server + endpoints
│   │   ├── gemini.ts      # LLM + embeddings
│   │   ├── qdrant.ts      # Vector database
│   │   ├── sessions.ts    # Session management
│   │   ├── ingestion.ts   # Code chunking + embedding
│   │   └── types.ts       # TypeScript types
│   ├── .env.example       # Environment template
│   └── README.md          # Backend setup guide
│
└── frontend/         # Next.js web app
    ├── app/
    │   ├── page.tsx       # Main dashboard
    │   ├── docs/          # Documentation page
    │   └── globals.css    # Theme + styles
    ├── .env.example       # Environment template
    └── README.md         # Frontend setup guide
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ingest/paste` | POST | Ingest pasted code |
| `/ingest/github` | POST | Ingest GitHub repository |
| `/ingest/upload` | POST | Ingest uploaded files |
| `/ingest/status/:sessionId` | GET | Check ingestion status |
| `/sessions` | GET | List active sessions |
| `/llm` | POST | OpenAI-compatible LLM endpoint |
| `/vapi-webhook` | POST | Vapi webhook handler |

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Voice**: Vapi
- **LLM**: Groq (Llama 3.3 70B)
- **Embeddings**: Google Gemini
- **Vector DB**: Qdrant
- **Frontend**: Next.js 14
- **Styling**: Custom CSS with shadcn OKLCH palette

## License

MIT