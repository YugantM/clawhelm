# ClawHelm

![ClawHelm logo](frontend/public/clawhelm-logo-dark.svg)

[![License](https://img.shields.io/github/license/YugantM/clawhelm)](LICENSE)
[![Pages](https://img.shields.io/github/actions/workflow/status/YugantM/clawhelm/deploy-pages.yml?branch=main&label=pages)](https://github.com/YugantM/clawhelm/actions/workflows/deploy-pages.yml)
[![Live Demo](https://img.shields.io/badge/demo-live-22c55e)](https://yugantm.github.io/clawhelm/)

### Stop choosing AI models. Let ClawHelm choose for you.

ClawHelm connects to **350+ AI models** and automatically picks the best one for every message you send — the fastest, cheapest, and most reliable. No setup, no guesswork.

[Try the Live Demo](https://yugantm.github.io/clawhelm/) · [User Guide](https://github.com/YugantM/clawhelm/wiki)

---

## Why ClawHelm?

Every AI provider has dozens of models. Some are fast, some are cheap, some are smart. Picking the right one for every question is exhausting.

**ClawHelm does it for you.** It learns which models perform best and routes every query to the optimal choice — automatically. If a model fails, it instantly retries with the next best option. You just chat.

## What You Get

**Just chat** — Type a question, get the best answer. ClawHelm handles model selection behind the scenes.

**350+ models, one interface** — Access models from OpenRouter and OpenAI through a single clean chat. No switching tabs or accounts.

**Beautiful responses** — Code blocks with syntax highlighting and copy buttons, tables, formatted text — all rendered natively.

**Pick your own model** — Want control? Browse the full catalog, filter by free/paid, and sort by speed, quality, or cost.

**See what's happening** — Every response shows which model answered and how fast. Full transparency, zero complexity.

**Automatic fallback** — If a model goes down mid-conversation, ClawHelm switches to the next best one seamlessly.

**Free models first** — ClawHelm prioritizes free models that deliver great results, so you spend nothing unless you want to.

## Screenshots

| Chat with Markdown | Model Selector |
|:---:|:---:|
| ![Chat](docs/screens/chat.png) | ![Models](docs/screens/dashboard.png) |

## Get Started in 60 Seconds

Grab a free [OpenRouter API key](https://openrouter.ai/keys), then:

```bash
git clone https://github.com/YugantM/clawhelm.git
cd clawhelm
./install/install.sh --openrouter-api-key YOUR_KEY
./scripts/run_dashboard.sh
```

Open [localhost:5173](http://localhost:5173) and start chatting.

> **Windows?** Use `.\install\install.ps1` in PowerShell instead.

## Configuration

Paste your API key in **Settings > Provider Keys** — or set `OPENROUTER_API_KEY` in `.env`. That's it.

Want OpenAI direct access too? Add `OPENAI_API_KEY` and set `ALLOW_OPENAI_ROUTING=true`.

## For Developers

ClawHelm exposes an **OpenAI-compatible API** at `/v1/chat/completions` — point any OpenAI SDK at it and get intelligent routing for free.

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello!"}]}'
```

Full [API Reference](https://github.com/YugantM/clawhelm/wiki/API-Reference) in the wiki.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Open a PR

## License

[MIT](LICENSE)

---

Built by [Harsiddhi Pari](https://github.com/YugantM)
