PREFIX ?= $(HOME)/.local
BINDIR ?= $(PREFIX)/bin
KIWI_BIN ?= $(BINDIR)/kiwi
INSTALL_DEPS ?= 1
UPDATE_SHELL ?= 1
PNPM_VERSION ?= 10.23.0
SHELL_PROFILE ?= $(HOME)/.zshrc
REPO_ROOT := $(patsubst %/,%,$(abspath $(dir $(lastword $(MAKEFILE_LIST)))))

.PHONY: install uninstall build check fix

install:
	@set -eu; \
	if ! command -v pnpm >/dev/null 2>&1; then \
		if ! command -v corepack >/dev/null 2>&1; then \
			echo "pnpm or corepack is required. Install Node.js 20+ and rerun make install." >&2; \
			exit 1; \
		fi; \
		corepack enable; \
		corepack prepare pnpm@$(PNPM_VERSION) --activate; \
	fi; \
	run_pnpm() { \
		if command -v pnpm >/dev/null 2>&1; then pnpm "$$@"; else corepack pnpm "$$@"; fi; \
	}; \
	if [ "$(INSTALL_DEPS)" = "1" ]; then CI=true; export CI; run_pnpm install --frozen-lockfile; fi; \
	run_pnpm --filter @kiwi/mcp-server build; \
	run_pnpm --filter @kiwi/cli build
	@mkdir -p "$(BINDIR)"
	@printf '%s\n' \
		'#!/usr/bin/env sh' \
		'set -eu' \
		"REPO_ROOT='$(REPO_ROOT)'" \
		'run_pnpm() {' \
		'  if command -v pnpm >/dev/null 2>&1; then' \
		'    pnpm "$$@"' \
		'  elif command -v corepack >/dev/null 2>&1; then' \
		'    corepack pnpm "$$@"' \
		'  else' \
		'    echo "pnpm or corepack is required to run kiwi from source." >&2' \
		'    exit 127' \
		'  fi' \
		'}' \
		'if [ "$${KIWI_SKIP_AUTO_BUILD:-0}" != "1" ]; then' \
		'  run_pnpm --dir "$$REPO_ROOT" --filter @kiwi/mcp-server build >/dev/null' \
		'  run_pnpm --dir "$$REPO_ROOT" --filter @kiwi/cli build >/dev/null' \
		'fi' \
		'exec node "$$REPO_ROOT/apps/cli/dist/index.js" "$$@"' \
		> "$(KIWI_BIN)"
	@chmod +x "$(KIWI_BIN)"
	@if [ "$(UPDATE_SHELL)" = "1" ]; then \
		if ! printf '%s' "$$PATH" | tr ':' '\n' | grep -qx "$(BINDIR)"; then \
			touch "$(SHELL_PROFILE)"; \
			if ! grep -Fqx 'export PATH="$(BINDIR):$$PATH"' "$(SHELL_PROFILE)"; then \
				printf '\n%s\n' 'export PATH="$(BINDIR):$$PATH"' >> "$(SHELL_PROFILE)"; \
			fi; \
			echo "PATH updated in $(SHELL_PROFILE). Open a new shell or run: source $(SHELL_PROFILE)"; \
		fi; \
	fi
	@echo "kiwi installed: $(KIWI_BIN)"
	@echo "Ensure this is on PATH: $(BINDIR)"

uninstall:
	@rm -f "$(KIWI_BIN)"
	@echo "kiwi removed: $(KIWI_BIN)"

build:
	@if command -v pnpm >/dev/null 2>&1; then pnpm --filter @kiwi/mcp-server build && pnpm --filter @kiwi/cli build; else corepack pnpm --filter @kiwi/mcp-server build && corepack pnpm --filter @kiwi/cli build; fi

check:
	@if command -v pnpm >/dev/null 2>&1; then pnpm release:check; else corepack pnpm release:check; fi

fix:
	@if command -v pnpm >/dev/null 2>&1; then pnpm format && pnpm lint:fix; else corepack pnpm format && corepack pnpm lint:fix; fi
