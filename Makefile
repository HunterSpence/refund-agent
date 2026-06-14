# Refund Agent — task runner
# Thin wrappers over the pnpm scripts so the project has the conventional
# `make` entry points. Everything here is keyless except a live deploy.

.DEFAULT_GOAL := help
.PHONY: help install dev seed test eval build typecheck lint check

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (pnpm)
	pnpm install

dev: ## Start the dev server at http://localhost:3000
	pnpm dev

seed: ## Describe the CRM seed (in-memory — no external database to seed)
	@echo "CRM seed is in-memory: 16 profiles (C001-C016) in lib/crm/data.ts,"
	@echo "covering every policy branch + one high-value order (C016) for the"
	@echo "human-in-the-loop approval flow. Swap lib/crm/adapter.ts (// SWAP_ME)"
	@echo "for a real CRM; no migration step required for the demo."

test: ## Run the full test suite (unit + deterministic eval gate)
	pnpm test:run

eval: ## Run the deterministic adversarial eval (23 scenarios, keyless)
	pnpm eval

build: ## Production build (next build)
	pnpm build

typecheck: ## Strict TypeScript check (tsc --noEmit)
	pnpm typecheck

lint: ## ESLint
	pnpm lint

check: typecheck lint test build ## Run the full CI gate locally (typecheck, lint, test, build)
