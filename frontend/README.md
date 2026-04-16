# HackBLR Frontend 🎤

Next.js frontend for HackBLR Dev Agent.

## Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Add your Vapi keys to .env.local
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_BACKEND_URL` | Backend URL (e.g., http://localhost:3000) |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | Your Vapi public key |
| `NEXT_PUBLIC_VAPI_ASSISTANT_ID` | Your Vapi assistant ID |

## Features

- Landing page with voice call interface
- Dark/Light theme toggle
- Demo codebase selector
- Paste code and GitHub ingest flows
- Live transcript panel
- Intent badge (Error/Audit/Debug/Explain/Navigate)
- Documentation page at `/docs`

## Stack

- Framework: Next.js 14
- Styling: Custom CSS with shadcn color palette
- Voice: Vapi SDK