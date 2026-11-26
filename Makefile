# VetScribe — developer entry points. Run `make help`.
SHELL := /bin/bash
PY ?= python3
VENV := backend/.venv
BIN := $(VENV)/bin

.DEFAULT_GOAL := help
.PHONY: help install install-backend install-frontend dev dev-backend dev-frontend dev-mock-fe \
        eval eval-oracle test test-backend test-frontend lint lint-backend lint-frontend build deploy clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: install-backend install-frontend ## Install backend + frontend dependencies

install-backend: ## Create backend venv and install package with dev extras
	test -d $(VENV) || $(PY) -m venv $(VENV)
	$(BIN)/pip install -q --upgrade pip
	$(BIN)/pip install -q -e "backend[dev]"

install-frontend: ## Install frontend npm dependencies
	cd frontend && npm ci

dev: ## Run full mocked stack locally (API :8000 with mock LLM + UI :5173)
	./scripts/dev.sh

dev-backend: ## Run only the local API server (mock LLM, in-memory store)
	cd backend && .venv/bin/python -m vetscribe.local.server --port 8000

dev-frontend: ## Run only the Vite dev server (proxies /v1 to :8000)
	cd frontend && npm run dev

dev-mock-fe: ## Frontend-only demo with in-browser MSW mocks (no Python needed)
	cd frontend && npm run dev:mock

eval: ## Evaluate the mock generator on the case set (reps=2); results in backend/.eval-runs
	cd backend && .venv/bin/python -m vetscribe.evals.cli validate-cases && \
	.venv/bin/python -m vetscribe.evals.cli run --provider mock --reps 2 --label make-eval

eval-oracle: ## Harness self-test: oracle must score 1.0, null must score ~0
	cd backend && .venv/bin/python -m vetscribe.evals.cli run --provider oracle --reps 1 \
	  --fail-under fact_recall=1 --fail-under field_accuracy=1 --fail-under hallucination_free=1 \
	  --fail-under missing_data_handling=1 --fail-under flag_recall=1 --fail-under action_recall=1 \
	  --label oracle-selftest
	cd backend && .venv/bin/python -m vetscribe.evals.cli run --provider null --reps 1 --label null-selftest

test: test-backend test-frontend ## Run all tests

test-backend: ## Backend tests with coverage
	cd backend && .venv/bin/pytest --cov=vetscribe --cov-report=term-missing

test-frontend: ## Frontend unit tests
	cd frontend && npm test

lint: lint-backend lint-frontend ## Lint + type-check everything

lint-backend:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy src

lint-frontend:
	cd frontend && npm run lint && npm run typecheck

build: ## Build frontend bundle and SAM artifacts
	cd frontend && npm run build
	cd infra && sam build

deploy: ## Deploy the stack with SAM (guided on first run)
	cd infra && sam deploy --guided

clean: ## Remove build artefacts and caches
	rm -rf frontend/dist infra/.aws-sam backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache backend/.coverage
