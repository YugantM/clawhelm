PYTHON ?= python3
VENV ?= .venv
PIP := $(VENV)/bin/pip
PYTEST := $(VENV)/bin/pytest
UVICORN := $(VENV)/bin/uvicorn

.PHONY: install run run-mock test smoke-test

install:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install -r requirements.txt

run:
	PYTHONPATH=$(CURDIR) \
	PROVIDER_BASE_URL=$${PROVIDER_BASE_URL:-https://api.openai.com} \
	PROVIDER_API_KEY=$${PROVIDER_API_KEY:?set PROVIDER_API_KEY} \
	$(UVICORN) app.main:app --host 0.0.0.0 --port 8000 --reload

run-mock:
	PYTHONPATH=$(CURDIR) $(UVICORN) app.mock_provider:app --host 127.0.0.1 --port 8101

test:
	PYTHONPATH=$(CURDIR) $(PYTEST) -q

smoke-test:
	./scripts/smoke_test.sh
