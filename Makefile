PREFIX ?= $(HOME)/.local
BINDIR ?= $(PREFIX)/bin
KIWI_BIN ?= $(BINDIR)/kiwi
INSTALL_DEPS ?= 1
BUILD ?= 1
UPDATE_SHELL ?= 1
INSTALL_CURSOR_AGENT ?= 0
PNPM_VERSION ?= 10.23.0
SHELL_PROFILE ?= $(HOME)/.zshrc
REPO_ROOT := $(patsubst %/,%,$(abspath $(dir $(lastword $(MAKEFILE_LIST)))))

.PHONY: install install-cursor-agent uninstall build check fix smoke

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
	if [ "$(BUILD)" = "1" ]; then \
		run_pnpm --filter @kiwi/contracts build; \
		run_pnpm --filter @kiwi/sandbox build; \
		run_pnpm --filter @kiwi/core build; \
		run_pnpm --filter @kiwi/adapters build; \
		run_pnpm --filter @kiwi/runtime build; \
		run_pnpm --filter @kiwi/mcp-server build; \
		run_pnpm --filter @kiwi/cli build; \
	fi
	@KIWI_BUILD_SHA=$$(git -C "$(REPO_ROOT)" rev-parse --short HEAD 2>/dev/null || echo unknown); \
	mkdir -p "$(BINDIR)"; \
	printf '%s\n' \
		'#!/usr/bin/env sh' \
		'set -eu' \
		"REPO_ROOT='$(REPO_ROOT)'" \
		"KIWI_BUILD_SHA='$$KIWI_BUILD_SHA'" \
		'export KIWI_BUILD_SHA' \
		'CLI_DIST="$$REPO_ROOT/apps/cli/dist/index.js"' \
		'if [ ! -f "$$CLI_DIST" ]; then' \
		'  echo "kiwi: build artifact missing at $$CLI_DIST" >&2' \
		'  echo "kiwi: run \"make build\" in $$REPO_ROOT to rebuild" >&2' \
		'  exit 127' \
		'fi' \
		'exec node "$$CLI_DIST" "$$@"' \
		> "$(KIWI_BIN)"; \
	chmod +x "$(KIWI_BIN)"
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
	@if command -v cursor-agent >/dev/null 2>&1; then \
		echo "cursor-agent detected: $$(command -v cursor-agent)"; \
	elif command -v cursor >/dev/null 2>&1; then \
		if [ "$(INSTALL_CURSOR_AGENT)" = "1" ]; then \
			$(MAKE) install-cursor-agent; \
		else \
			echo "cursor detected, cursor-agent missing. Optional runner install:"; \
			echo "  make install-cursor-agent"; \
			echo "  # or: make install INSTALL_CURSOR_AGENT=1"; \
		fi; \
	fi

install-cursor-agent:
	@set -eu; \
	if command -v cursor-agent >/dev/null 2>&1; then \
		echo "cursor-agent already installed: $$(command -v cursor-agent)"; \
		cursor-agent --version || true; \
		exit 0; \
	fi; \
	if ! command -v cursor >/dev/null 2>&1; then \
		echo "cursor is not on PATH; install Cursor first, then rerun make install-cursor-agent." >&2; \
		exit 1; \
	fi; \
	echo "Installing Cursor Agent CLI via official Cursor installer..."; \
	curl https://cursor.com/install -fsS | bash; \
	if ! command -v cursor-agent >/dev/null 2>&1; then \
		echo "cursor-agent installed, but not on PATH yet. Add ~/.local/bin to PATH:"; \
		echo "  export PATH=\"$$HOME/.local/bin:$$PATH\""; \
		exit 0; \
	fi; \
	cursor-agent --version

uninstall:
	@rm -f "$(KIWI_BIN)"
	@echo "kiwi removed: $(KIWI_BIN)"

build:
	@if command -v pnpm >/dev/null 2>&1; then \
		pnpm --filter @kiwi/contracts build && \
		pnpm --filter @kiwi/sandbox build && \
		pnpm --filter @kiwi/core build && \
		pnpm --filter @kiwi/adapters build && \
		pnpm --filter @kiwi/runtime build && \
		pnpm --filter @kiwi/mcp-server build && \
		pnpm --filter @kiwi/cli build; \
	else \
		corepack pnpm --filter @kiwi/contracts build && \
		corepack pnpm --filter @kiwi/sandbox build && \
		corepack pnpm --filter @kiwi/core build && \
		corepack pnpm --filter @kiwi/adapters build && \
		corepack pnpm --filter @kiwi/runtime build && \
		corepack pnpm --filter @kiwi/mcp-server build && \
		corepack pnpm --filter @kiwi/cli build; \
	fi

check:
	@if command -v pnpm >/dev/null 2>&1; then pnpm release:check; else corepack pnpm release:check; fi

fix:
	@if command -v pnpm >/dev/null 2>&1; then pnpm format && pnpm lint:fix; else corepack pnpm format && corepack pnpm lint:fix; fi

smoke:
	@if command -v pnpm >/dev/null 2>&1; then pnpm smoke; else corepack pnpm smoke; fi
