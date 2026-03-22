# Contributing

Thanks for contributing to ClawHelm.

## Before You Start

- Open an issue first for non-trivial changes.
- Keep changes scoped. Avoid bundling unrelated work into one pull request.
- Prefer small, reviewable commits.

## Development Setup

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
.venv/bin/pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

## Run Locally

### Recommended

```bash
./scripts/run_dashboard.sh
```

### Manual

Backend:

```bash
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend:

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

## Tests

Backend tests:

```bash
make test
```

Smoke test:

```bash
make smoke-test
```

Frontend build:

```bash
cd frontend
npm run build
```

## Contribution Guidelines

- preserve OpenAI-compatible request and response behavior
- keep routing decisions explainable and deterministic
- avoid introducing complex state management in the frontend
- prefer additive, safe migrations for SQLite changes
- update screenshots in `docs/screens/` when visible UI changes land

## Pull Requests

Please include:

- a short description of the problem
- the change made
- any API or schema changes
- screenshots for UI changes
- verification steps or test output
