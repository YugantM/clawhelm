# ClawHelm

![ClawHelm logo](frontend/public/clawhelm-logo-dark.svg)

[![License](https://img.shields.io/github/license/YugantM/clawhelm)](LICENSE)
[![Pages](https://img.shields.io/github/actions/workflow/status/YugantM/clawhelm/deploy-pages.yml?branch=main&label=pages)](https://github.com/YugantM/clawhelm/actions/workflows/deploy-pages.yml)
[![Live Demo](https://img.shields.io/badge/demo-live-22c55e)](https://yugantm.github.io/clawhelm/)

**ClawHelm is an intelligent AI model router.** It picks the fastest, cheapest, and most capable model for every query from 350+ models across multiple providers.

[Live Demo](https://yugantm.github.io/clawhelm/) · [Wiki](https://github.com/YugantM/clawhelm/wiki) · [Issues](https://github.com/YugantM/clawhelm/issues)

---

## How It Works

1. You send a message through the chat interface
2. ClawHelm scores all available models on **quality**, **speed**, and **cost**
3. The best model is selected and your request is forwarded
4. The response is returned with full attribution (which model, provider, latency)
5. If the selected model fails, ClawHelm automatically falls back to the next best

## Features

- **Adaptive Routing** — Weighted scoring (`quality 40% + speed 35% + cost 25%`) with exploration and fallback
- **350+ Models** — Auto-synced from OpenRouter, plus OpenAI direct
- **Tile-Based Model Selector** — Visual popup with top picks, or browse the full catalog with filters
- **Markdown Chat** — Syntax-highlighted code blocks, tables, copy button, clean typography
- **Smart Cold Start** — New models scored using real pricing and context metadata, not flat defaults
- **Quality Floor** — Models with <30% success rate after 5+ requests are automatically excluded
- **Performance Dashboard** — Request stats, model leaderboard, and scoring breakdown
- **Multi-Provider Dedup** — Same base model from different providers? Only the best one is used
- **Full Attribution** — Every response shows the actual model, provider, and latency
- **Session History** — Chat sessions persist across page refreshes
- **OAuth + Guest** — Google/GitHub sign-in or continue without an account

## Screenshots

| Chat with Markdown Rendering | Model Selector |
|:---:|:---:|
| ![Chat](docs/screens/chat.png) | ![Models](docs/screens/dashboard.png) |

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- An [OpenRouter API key](https://openrouter.ai/keys) (free tier available)

### macOS / Linux

```bash
git clone https://github.com/YugantM/clawhelm.git
cd clawhelm
./install/install.sh --openrouter-api-key YOUR_OPENROUTER_KEY
./scripts/run_dashboard.sh
```

### Windows PowerShell

```powershell
git clone https://github.com/YugantM/clawhelm.git
cd clawhelm
.\install\install.ps1 --openrouter-api-key YOUR_OPENROUTER_KEY
.\scripts\run_dashboard.ps1
```

Open [http://localhost:5173](http://localhost:5173) and start chatting.

## Configuration

### API Keys

ClawHelm supports two ways to configure provider keys:

1. **Dashboard** (recommended) — Paste your OpenRouter key in Settings > Provider Keys
2. **Environment variables** — Set `OPENROUTER_API_KEY` in `.env`

Keys are stored in `.clawhelm/settings.json` and picked up immediately without restart.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `OPENAI_API_KEY` | — | OpenAI API key (optional) |
| `ALLOW_OPENROUTER_ROUTING` | `true` | Enable OpenRouter provider |
| `ALLOW_OPENAI_ROUTING` | `false` | Enable OpenAI direct provider |
| `DATABASE_URL` | `sqlite:///clawhelm.db` | Database connection string |
| `ENV_MODE` | `local` | `local` or `cloud` |
| `ENABLE_CLOUD_MODE` | `false` | Enable Stripe + OAuth features |
| `STRIPE_SECRET_KEY` | — | Stripe key (cloud mode only) |
| `STRIPE_PRICE_ID` | — | Stripe price ID (cloud mode only) |

## Architecture

```
Browser  -->  React Frontend (Vite)
                    |
                    v
              FastAPI Backend
                    |
          +---------+---------+
          |                   |
    OpenRouter API      OpenAI API
     (350+ models)     (direct access)
          |                   |
          +----> SQLite <-----+
                (logs, stats, sessions)
```

**Scoring formula:** `score = success_rate * 0.4 + (1/latency) * 0.35 + (1/cost) * 0.25`

Cold-start models use pricing metadata instead of neutral defaults. Free models get a +0.1 routing bonus. 10% of requests explore non-top models to discover better options.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat proxy |
| `GET` | `/chat/models` | Ranked model list for UI |
| `GET` | `/stats` | Performance metrics and model leaderboard |
| `GET` | `/refresh-models` | Sync models from OpenRouter |
| `GET` | `/health` | Backend health check |
| `POST` | `/chat/sessions` | Create/update chat session |
| `GET` | `/chat/sessions` | List user sessions |

## Project Structure

```
clawhelm/
  app/
    main.py              # FastAPI app and endpoints
    proxy.py             # Request forwarding and fallback chain
    router.py            # Model scoring, ranking, route decisions
    scoring.py           # Composite scoring formula
    providers.py         # Provider registry (OpenRouter, OpenAI)
    models_registry.py   # Model catalog with metadata
    costs.py             # Cost estimation from real pricing
    settings.py          # Persistent settings store
    db.py                # SQLite logging and stats
    models.py            # Pydantic response models
  frontend/
    src/
      App.jsx            # App shell, auth, routing
      components/
        Chat.jsx         # Chat thread and composer
        Message.jsx      # Markdown rendering with syntax highlighting
        ModelSelector.jsx # Tile-based model popup
        ModelDashboard.jsx # Performance stats panel
        Sidebar.jsx      # Session history sidebar
      pages/
        Settings.jsx     # Settings and provider keys
        Models.jsx       # Full model catalog with filters
      styles.css         # All styles (dark theme, blue accent)
```

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Push and open a PR

## License

[MIT](LICENSE)

---

Built by [Harsiddhi Pari](https://github.com/YugantM)
