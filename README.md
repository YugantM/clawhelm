# ClawHelm

An intelligent AI model router that picks the fastest, cheapest, most reliable model for every query.

**No model menus. No configuration. Just a chat that always gives you the best answer — from 350+ models.**

---

## How It Works

ClawHelm scores every model on **speed**, **quality**, and **cost** from real usage:

- **Speed (45%)** — Latency from live traffic + benchmark tests
- **Quality (30%)** — Success rate (errors penalize heavily)
- **Cost (25%)** — Per-token pricing

The top-scoring model gets your message. If it fails, the next best instantly takes over. Built-in fallback chain ensures you always get an answer.

---

## Features

- **Adaptive routing** — Learns from each request to pick better models
- **350+ models** — OpenRouter, OpenAI, and others
- **Markdown chat** — Code blocks with copy button, formatted responses
- **Session history** — Save chats, organized by date (signed-in users)
- **Guest mode** — Temporary storage in browser, no account needed
- **Speed comparison** — See how fast your selected model is vs. runner-up
- **Cost tracking** — Know how much each request costs
- **Fallback chain** — Auto-retry on failure, no stuck requests
- **OpenAI-compatible API** — Drop-in replacement for any OpenAI SDK

---

## Quick Start

### macOS / Linux

```bash
git clone https://github.com/YugantM/clawhelm.git
cd clawhelm
./install/install.sh --openrouter-api-key YOUR_KEY
./scripts/run_dashboard.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/YugantM/clawhelm.git
cd clawhelm
.\install\install.ps1 -openRouterApiKey YOUR_KEY
.\scripts\run_dashboard.ps1
```

Get a free OpenRouter key: [openrouter.ai/keys](https://openrouter.ai/keys)

Open [localhost:5173](http://localhost:5173)

---

## Configuration

### API Keys

Set via environment variables or the dashboard:

```bash
OPENROUTER_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here  # optional, for OpenAI models
```

Or paste in Settings → API Keys in the UI.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAWHELM_DB_PATH` | `./clawhelm.db` | SQLite database location |
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `OPENAI_API_KEY` | — | OpenAI API key (optional) |

---

## Architecture

```
Frontend (React, Vite) → FastAPI Proxy → Model Router → Provider APIs
                             ↓
                         SQLite (stats)
```

- **Frontend** — Chat UI, session management, markdown rendering
- **Router** — Scores models, selects best, manages fallback chain
- **Scoring** — Blends speed/quality/cost from live usage + benchmarks
- **Database** — Tracks performance metrics per model

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Chat completion (OpenAI-compatible) |
| `GET` | `/health` | Backend health check |
| `GET` | `/stats/{model_id}` | Model performance stats |
| `POST` | `/backtest/run` | Start benchmark run (admin) |
| `GET` | `/backtest/status` | Backtest progress (admin) |

---

## Contributing

Contributions welcome. Submit a PR.

## License

[MIT](LICENSE)

---

Built by [YugantM](https://github.com/YugantM)
