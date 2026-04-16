"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

export default function DocsPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    setTheme(current as "light" | "dark");
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <main className="page">
      <header className="header">
        <div className="header-left">
          <Link href="/" style={{ textDecoration: "none" }}>
            <h1>HackBLR</h1>
          </Link>
          <p className="subtitle">Documentation</p>
        </div>
        <div className="header-right">
          <Link href="/" className="nav-link">
            Home
          </Link>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <section className="hero" style={{ textAlign: "left" }}>
        <h2>Quick Start</h2>
        <p>
          HackBLR is a voice-first developer assistant. It uses Vapi for voice calls and a custom LLM
          (Groq + Llama) with RAG over your code.
        </p>
      </section>

      <div className="grid">
        <div className="card">
          <h3>1. Backend Setup</h3>
          <pre className="code-block">{`# Clone the repo
git clone https://github.com/your-org/hackblr.git
cd hackblr/backend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your API keys
# (see environment variables below)

# Start the server
npm run dev`}</pre>
        </div>

        <div className="card">
          <h3>2. Frontend Setup</h3>
          <pre className="code-block">{`cd ../frontend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your Vapi keys

# Start the app
npm run dev`}</pre>
        </div>

        <div className="card">
          <h3>3. Ingest Your Code</h3>
          <p className="docs-text">
            Before making a voice call, you need to ingest your codebase. Use one of these methods:
          </p>
          <ul className="docs-list">
            <li>
              <strong>Paste Code</strong> - Paste directly in the web interface
            </li>
            <li>
              <strong>GitHub Repository</strong> - Enter a repo URL to ingest
            </li>
            <li>
              <strong>Upload Files</strong> - Upload local files
            </li>
          </ul>
        </div>

        <div className="card">
          <h3>4. Start Voice Call</h3>
          <p className="docs-text">
            After ingesting your code, click "Start Call" to begin a voice conversation with the AI
            about your codebase.
          </p>
        </div>
      </div>

      <section className="card">
        <h3>Environment Variables</h3>

        <h4>Backend (.env)</h4>
        <table className="env-table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>GROQ_API_KEY</code></td>
              <td>Your Groq API key (for LLM)</td>
            </tr>
            <tr>
              <td><code>GEMINI_API_KEY</code></td>
              <td>Your Google Gemini API key (for embeddings)</td>
            </tr>
            <tr>
              <td><code>QDRANT_URL</code></td>
              <td>Qdrant vector DB URL</td>
            </tr>
            <tr>
              <td><code>QDRANT_API_KEY</code></td>
              <td>Qdrant API key</td>
            </tr>
            <tr>
              <td><code>PORT</code></td>
              <td>Server port (default: 3000)</td>
            </tr>
            <tr>
              <td><code>FRONTEND_URL</code></td>
              <td>Frontend URL for CORS</td>
            </tr>
          </tbody>
        </table>

        <h4>Frontend (.env.local)</h4>
        <table className="env-table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>NEXT_PUBLIC_BACKEND_URL</code></td>
              <td>Backend URL (e.g., http://localhost:3000)</td>
            </tr>
            <tr>
              <td><code>NEXT_PUBLIC_VAPI_PUBLIC_KEY</code></td>
              <td>Your Vapi public key</td>
            </tr>
            <tr>
              <td><code>NEXT_PUBLIC_VAPI_ASSISTANT_ID</code></td>
              <td>Your Vapi assistant ID</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Vapi Configuration</h3>
        <p className="docs-text">
          In your Vapi dashboard:
        </p>
        <ol className="docs-list">
          <li>Create a new assistant or use an existing one</li>
          <li>Enable "Custom LLM" in the assistant settings</li>
          <li>Set the Custom LLM endpoint to: <code>{`{your-backend-url}/llm`}</code></li>
          <li>Add your backend URL as a webhook</li>
        </ol>
        <p className="docs-text">
          <strong>Note:</strong> Use ngrok to expose your local backend to the internet for Vapi
          to reach it: <code>npx ngrok http 3000</code>
        </p>
      </section>

      <section className="card">
        <h3>API Endpoints</h3>
        <table className="env-table">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Method</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>/ingest/paste</code></td>
              <td>POST</td>
              <td>Ingest pasted code</td>
            </tr>
            <tr>
              <td><code>/ingest/github</code></td>
              <td>POST</td>
              <td>Ingest GitHub repository</td>
            </tr>
            <tr>
              <td><code>/ingest/upload</code></td>
              <td>POST</td>
              <td>Ingest uploaded files</td>
            </tr>
            <tr>
              <td><code>/ingest/status/:sessionId</code></td>
              <td>GET</td>
              <td>Check ingestion status</td>
            </tr>
            <tr>
              <td><code>/sessions</code></td>
              <td>GET</td>
              <td>List active sessions</td>
            </tr>
            <tr>
              <td><code>/llm</code></td>
              <td>POST</td>
              <td>LLM endpoint (OpenAI-compatible)</td>
            </tr>
            <tr>
              <td><code>/vapi-webhook</code></td>
              <td>POST</td>
              <td>Vapi webhook handler</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>GitHub Repository</h3>
        <p className="docs-text">
          <a
            href="https://github.com/your-org/hackblr"
            target="_blank"
            rel="noopener noreferrer"
            className="repo-link"
          >
            https://github.com/your-org/hackblr
          </a>
        </p>
      </section>

      <footer className="footer">
        <p>HackBLR - Voice-first developer assistant</p>
      </footer>
    </main>
  );
}