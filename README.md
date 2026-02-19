# Planner Desktop App

A glassmorphism, monochrome day planner for Windows with color-coded tags, a floating AI chat drawer, and local SQLite persistence. The AI integration uses a **local Ollama model** (`llama3:8b-instruct-q4_K_M`) and does **not** have internet access.

## Features
- iOS-like glassmorphism UI with monochrome palette
- Color-coded tags (work, family, errands, custom)
- Drag-free card layout with time fields
- Floating chat drawer in the bottom-right
- AI schedule optimization with apply/revert
- Local SQLite storage (no account required)

## Requirements
- Node.js 18+
- Ollama running locally (optional, for AI)

## Setup
1. Install dependencies:
   - npm install
2. Run the app:
   - npm run dev

## AI Providers
The app now supports two local AI providers:

1. **Embedded runtime (preferred for installer users)**
   - Bundles model + runtime in installer resources (`ai/` folder)
   - No Ollama installation required for end users

2. **Ollama fallback**
   - Used automatically if embedded assets are not bundled
   - Endpoint: `http://localhost:11434/api/chat`
   - Model: `llama3:8b-instruct-q4_K_M`

## Embedded AI Setup
Before building installer, place embedded assets in [ai/README.md](ai/README.md):
- `ai/llama-server.exe`
- `ai/planner-model.gguf`

On first app launch, bundled assets are copied to user data and started automatically.
If assets in the installer are updated in a newer app build, they are re-copied to user data automatically.

If embedded assets are missing, the app falls back to Ollama.

### Embedded AI environment options
Configure these in `.env` when needed:

- `EMBEDDED_AI_ENABLED=true|false` (default `true`)
- `EMBEDDED_AI_HOST` (default `127.0.0.1`)
- `EMBEDDED_AI_PORT` (default `11435`)
- `EMBEDDED_AI_STARTUP_TIMEOUT_MS` (default `15000`)
- `EMBEDDED_RUNTIME_FILE` (default `llama-server.exe`)
- `EMBEDDED_MODEL_FILE` (default `planner-model.gguf`)

Set `EMBEDDED_AI_ENABLED=false` to force Ollama-only mode.

## Web Search (Optional)
Free option (default): DuckDuckGo Instant Answer API (no key required)
- Copy `.env.example` to `.env`
- Keep `SEARCH_PROVIDER=duckduckgo`

Optional paid provider: Brave Search
- Set `SEARCH_PROVIDER=brave`
- Set `BRAVE_API_KEY=your_key`

When web search is enabled, results are added to the prompt and the assistant uses them in responses.

## Packaging
Build installer (`.exe`) for Windows:
- `npm install`
- `npm run dist:win`

Installer output is generated in the `release` folder.

If you bundle embedded assets, users get AI immediately after installation.

If you do **not** bundle embedded assets, end-user Ollama setup is:
1. Install Ollama from the official Ollama website.
2. Run `ollama pull llama3:8b-instruct-q4_K_M` once.
3. Start Ollama (it serves on `http://localhost:11434`).

## Notes on Internet Access
Local Ollama models cannot browse the internet by default. This app can optionally fetch web results in the backend and pass them to Ollama.
