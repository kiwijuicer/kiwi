PREFIX ?= $(HOME)/.local
BINDIR ?= $(PREFIX)/bin
KIWI_BIN ?= $(BINDIR)/kiwi
KIWI_MCP_BIN ?= $(BINDIR)/kiwi-mcp-stdio
KIWI_HOME ?= $(HOME)/.kiwi
KIWI_INSTALL_ROOT ?= $(KIWI_HOME)/install
KIWI_RELEASES_DIR ?= $(KIWI_INSTALL_ROOT)/releases
KIWI_CURRENT ?= $(KIWI_INSTALL_ROOT)/current
KIWI_RELEASES_TO_KEEP ?= 2
BUILD_CONCURRENCY ?= 4
INSTALL_DEPS ?= 1
BUILD ?= 1
UPDATE_SHELL ?= 1
INSTALL_CURSOR_AGENT ?= 0
INSTALL_CLAUDE_CODE ?= 0
CLAUDE_CODE_INSTALLER ?= native
PNPM_VERSION ?= 10.23.0
SHELL_PROFILE ?= $(HOME)/.zshrc
REPO_ROOT := $(patsubst %/,%,$(abspath $(dir $(lastword $(MAKEFILE_LIST)))))

.PHONY: install install-cursor-agent install-claude-code rollback uninstall build check fix smoke update-models

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
	if [ "$(INSTALL_DEPS)" = "1" ]; then CI=true; export CI; run_pnpm install --frozen-lockfile; fi
	@if [ "$(BUILD)" = "1" ]; then $(MAKE) build; fi
	@set -eu; \
	case "$(KIWI_RELEASES_TO_KEEP)" in ""|*[!0-9]*) \
		echo "KIWI_RELEASES_TO_KEEP must be a positive integer" >&2; \
		exit 1; \
		;; \
	esac; \
	if [ "$(KIWI_RELEASES_TO_KEEP)" -lt 1 ]; then \
		echo "KIWI_RELEASES_TO_KEEP must be at least 1" >&2; \
		exit 1; \
	fi; \
	KIWI_BUILD_SHA=$$(git -C "$(REPO_ROOT)" rev-parse --short HEAD 2>/dev/null || echo unknown); \
	KIWI_BUILD_TS=$$(date -u +%Y%m%dT%H%M%SZ); \
	INSTALLED_AT=$$(date -u +%Y-%m-%dT%H:%M:%SZ); \
	RELEASE_ID="$$KIWI_BUILD_TS-$$KIWI_BUILD_SHA"; \
	INSTALL_ROOT="$(KIWI_INSTALL_ROOT)"; \
	RELEASES_DIR="$(KIWI_RELEASES_DIR)"; \
	CURRENT_LINK="$(KIWI_CURRENT)"; \
	TMP_ROOT="$$INSTALL_ROOT/.tmp"; \
	CANDIDATE="$$TMP_ROOT/$$RELEASE_ID"; \
	RELEASE_PATH="$$RELEASES_DIR/$$RELEASE_ID"; \
	if [ -e "$$RELEASE_PATH" ]; then \
		RELEASE_ID="$$RELEASE_ID-$$$$"; \
		CANDIDATE="$$TMP_ROOT/$$RELEASE_ID"; \
		RELEASE_PATH="$$RELEASES_DIR/$$RELEASE_ID"; \
	fi; \
	SMOKE_WORKSPACE="$$TMP_ROOT/smoke-workspace-$$RELEASE_ID"; \
	SMOKE_KIWI_HOME="$$TMP_ROOT/smoke-home-$$RELEASE_ID"; \
	LINK_TMP="$$CURRENT_LINK.next"; \
	trap 'rm -rf "$$CANDIDATE" "$$SMOKE_WORKSPACE" "$$SMOKE_KIWI_HOME" "$$LINK_TMP"' EXIT INT TERM; \
	test -f "$(REPO_ROOT)/apps/cli/dist/index.js"; \
	test -f "$(REPO_ROOT)/apps/mcp-server/dist/index.js"; \
	rm -rf "$$CANDIDATE" "$$SMOKE_WORKSPACE"; \
	mkdir -p "$$CANDIDATE/apps/cli/dist" "$$CANDIDATE/apps/mcp-server/dist" "$$CANDIDATE/bin" "$$CANDIDATE/config" "$$RELEASES_DIR" "$$TMP_ROOT"; \
	cp -R "$(REPO_ROOT)/apps/cli/dist/." "$$CANDIDATE/apps/cli/dist/"; \
	cp -R "$(REPO_ROOT)/apps/mcp-server/dist/." "$$CANDIDATE/apps/mcp-server/dist/"; \
	cp "$(REPO_ROOT)/config/model-catalog.json" "$$CANDIDATE/config/model-catalog.json"; \
	printf '{\n  "releaseId": "%s",\n  "sha": "%s",\n  "installedAt": "%s",\n  "repoRoot": "%s"\n}\n' "$$RELEASE_ID" "$$KIWI_BUILD_SHA" "$$INSTALLED_AT" "$(REPO_ROOT)" > "$$CANDIDATE/manifest.json"; \
	printf '%s\n' \
		'#!/usr/bin/env sh' \
		'set -eu' \
		"KIWI_BUILD_SHA='$$KIWI_BUILD_SHA'" \
		"KIWI_MCP_BIN='$(KIWI_MCP_BIN)'" \
		'export KIWI_BUILD_SHA KIWI_MCP_BIN' \
		'RELEASE_ROOT=$$(CDPATH= cd "$$(dirname "$$0")/.." && pwd)' \
		'exec node "$$RELEASE_ROOT/apps/cli/dist/index.js" "$$@"' \
		> "$$CANDIDATE/bin/kiwi"; \
	printf '%s\n' \
		'#!/usr/bin/env sh' \
		'set -eu' \
		"KIWI_BUILD_SHA='$$KIWI_BUILD_SHA'" \
		'export KIWI_BUILD_SHA' \
		'RELEASE_ROOT=$$(CDPATH= cd "$$(dirname "$$0")/.." && pwd)' \
		'exec node "$$RELEASE_ROOT/apps/mcp-server/dist/index.js" "$$@"' \
		> "$$CANDIDATE/bin/kiwi-mcp-stdio"; \
	chmod +x "$$CANDIDATE/bin/kiwi" "$$CANDIDATE/bin/kiwi-mcp-stdio"; \
	node "$(REPO_ROOT)/scripts/check-bundle-requires.mjs" "$$CANDIDATE/apps/cli/dist/index.js" "$$CANDIDATE/apps/mcp-server/dist/index.js"; \
	"$$CANDIDATE/bin/kiwi" --version >/dev/null; \
	KIWI_MCP_ENTRY="$$CANDIDATE/apps/mcp-server/dist/index.js" node -e 'import(process.env.KIWI_MCP_ENTRY).then((server) => { if (typeof server.startMcpServer !== "function") throw new Error("startMcpServer export not found"); }).catch((error) => { console.error(error); process.exit(1); });'; \
	mkdir -p "$$SMOKE_WORKSPACE" "$$SMOKE_KIWI_HOME"; \
	KIWI_HOME="$$SMOKE_KIWI_HOME" "$$CANDIDATE/bin/kiwi" init --workspace "$$SMOKE_WORKSPACE" >/dev/null; \
	KIWI_HOME="$$SMOKE_KIWI_HOME" KIWI_TEST_ALLOW_STUB=1 KIWI_FORCE_ACCESS_MODE=stub "$$CANDIDATE/bin/kiwi" doctor --workspace "$$SMOKE_WORKSPACE" >/dev/null; \
	mv "$$CANDIDATE" "$$RELEASE_PATH"; \
	if [ -e "$$CURRENT_LINK" ] && [ ! -L "$$CURRENT_LINK" ]; then \
		echo "kiwi current path exists and is not a symlink: $$CURRENT_LINK" >&2; \
		exit 1; \
	fi; \
	rm -f "$$LINK_TMP"; \
	ln -s "$$RELEASE_PATH" "$$LINK_TMP"; \
	node -e 'const fs = require("fs"); fs.renameSync(process.argv[1], process.argv[2]);' "$$LINK_TMP" "$$CURRENT_LINK"; \
	mkdir -p "$(BINDIR)"; \
	printf '%s\n' \
		'#!/usr/bin/env sh' \
		'set -eu' \
		"KIWI_MCP_BIN='$(KIWI_MCP_BIN)'" \
		'export KIWI_MCP_BIN' \
		"CURRENT_LINK='$(KIWI_CURRENT)'" \
		'TARGET="$$CURRENT_LINK/bin/kiwi"' \
		'if [ ! -x "$$TARGET" ]; then' \
		'  echo "kiwi: installed release missing at $$TARGET" >&2' \
		'  echo "kiwi: run make install to install a release" >&2' \
		'  exit 127' \
		'fi' \
		'exec "$$TARGET" "$$@"' \
		> "$(KIWI_BIN)"; \
	printf '%s\n' \
		'#!/usr/bin/env sh' \
		'set -eu' \
		"CURRENT_LINK='$(KIWI_CURRENT)'" \
		'TARGET="$$CURRENT_LINK/bin/kiwi-mcp-stdio"' \
		'if [ ! -x "$$TARGET" ]; then' \
		'  echo "kiwi-mcp-stdio: installed release missing at $$TARGET" >&2' \
		'  echo "kiwi-mcp-stdio: run make install to install a release" >&2' \
		'  exit 127' \
		'fi' \
		'exec "$$TARGET" "$$@"' \
		> "$(KIWI_MCP_BIN)"; \
	chmod +x "$(KIWI_BIN)" "$(KIWI_MCP_BIN)"; \
	find "$$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | awk 'NR > $(KIWI_RELEASES_TO_KEEP)' | while IFS= read -r old_release; do rm -rf "$$old_release"; done; \
	rm -rf "$$SMOKE_WORKSPACE" "$$SMOKE_KIWI_HOME"; \
	rmdir "$$TMP_ROOT" 2>/dev/null || true; \
	trap - EXIT; \
	echo "kiwi installed: $(KIWI_BIN)"; \
	echo "kiwi-mcp-stdio installed: $(KIWI_MCP_BIN)"; \
	echo "kiwi release: $$RELEASE_ID"
	@if [ "$(UPDATE_SHELL)" = "1" ]; then \
		if ! printf '%s' "$$PATH" | tr ':' '\n' | grep -qx "$(BINDIR)"; then \
			touch "$(SHELL_PROFILE)"; \
			if ! grep -Fqx 'export PATH="$(BINDIR):$$PATH"' "$(SHELL_PROFILE)"; then \
				printf '\n%s\n' 'export PATH="$(BINDIR):$$PATH"' >> "$(SHELL_PROFILE)"; \
			fi; \
			echo "PATH updated in $(SHELL_PROFILE). Open a new shell or run: source $(SHELL_PROFILE)"; \
		fi; \
	fi
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

update-models:
	@set -eu; \
	if [ -x "$(KIWI_BIN)" ]; then \
		"$(KIWI_BIN)" models update --apply; \
	else \
		pnpm --filter '@kiwi/cli' kiwi -- models update --apply; \
	fi
	@if command -v claude >/dev/null 2>&1; then \
		echo "claude detected: $$(command -v claude)"; \
	else \
		if [ "$(INSTALL_CLAUDE_CODE)" = "1" ]; then \
			$(MAKE) install-claude-code; \
		else \
			echo "claude missing. Optional Claude Code runner install:"; \
			echo "  make install-claude-code"; \
			echo "  # or: make install INSTALL_CLAUDE_CODE=1"; \
			echo "  # brew path: make install-claude-code CLAUDE_CODE_INSTALLER=brew"; \
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

install-claude-code:
	@set -eu; \
	if command -v claude >/dev/null 2>&1; then \
		echo "claude already installed: $$(command -v claude)"; \
		claude --version || true; \
		exit 0; \
	fi; \
	if [ "$(CLAUDE_CODE_INSTALLER)" = "brew" ]; then \
		if ! command -v brew >/dev/null 2>&1; then \
			echo "brew is not on PATH; use CLAUDE_CODE_INSTALLER=native or install Homebrew." >&2; \
			exit 1; \
		fi; \
		echo "Installing Claude Code via Homebrew cask..."; \
		brew install --cask claude-code; \
	elif [ "$(CLAUDE_CODE_INSTALLER)" = "brew-latest" ]; then \
		if ! command -v brew >/dev/null 2>&1; then \
			echo "brew is not on PATH; use CLAUDE_CODE_INSTALLER=native or install Homebrew." >&2; \
			exit 1; \
		fi; \
		echo "Installing Claude Code latest channel via Homebrew cask..."; \
		brew install --cask claude-code@latest; \
	elif [ "$(CLAUDE_CODE_INSTALLER)" = "npm" ]; then \
		if ! command -v npm >/dev/null 2>&1; then \
			echo "npm is not on PATH; install Node.js 18+ or use CLAUDE_CODE_INSTALLER=native." >&2; \
			exit 1; \
		fi; \
		echo "Installing Claude Code via npm global package..."; \
		npm install -g @anthropic-ai/claude-code; \
	else \
		echo "Installing Claude Code via official native installer..."; \
		curl -fsSL https://claude.ai/install.sh | bash; \
	fi; \
	if ! command -v claude >/dev/null 2>&1; then \
		echo "claude installed, but not on PATH yet. Add ~/.local/bin to PATH:"; \
		echo "  export PATH=\"$$HOME/.local/bin:$$PATH\""; \
		exit 0; \
	fi; \
	claude --version

uninstall:
	@rm -f "$(KIWI_BIN)" "$(KIWI_MCP_BIN)"
	@rm -rf "$(KIWI_INSTALL_ROOT)"
	@echo "kiwi removed: $(KIWI_BIN)"
	@echo "kiwi-mcp-stdio removed: $(KIWI_MCP_BIN)"
	@echo "kiwi install root removed: $(KIWI_INSTALL_ROOT)"

rollback:
	@set -eu; \
	RELEASES_DIR="$(KIWI_RELEASES_DIR)"; \
	CURRENT_LINK="$(KIWI_CURRENT)"; \
	if [ ! -d "$$RELEASES_DIR" ]; then \
		echo "kiwi releases not found: $$RELEASES_DIR" >&2; \
		exit 1; \
	fi; \
	CURRENT_TARGET=$$(readlink "$$CURRENT_LINK" 2>/dev/null || true); \
	PREVIOUS_RELEASE=""; \
	for release in $$(find "$$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r); do \
		if [ "$$release" != "$$CURRENT_TARGET" ]; then \
			PREVIOUS_RELEASE="$$release"; \
			break; \
		fi; \
	done; \
	if [ -z "$$PREVIOUS_RELEASE" ]; then \
		echo "no previous kiwi release available" >&2; \
		exit 1; \
	fi; \
	if [ -e "$$CURRENT_LINK" ] && [ ! -L "$$CURRENT_LINK" ]; then \
		echo "kiwi current path exists and is not a symlink: $$CURRENT_LINK" >&2; \
		exit 1; \
	fi; \
	rm -f "$$CURRENT_LINK.next"; \
	ln -s "$$PREVIOUS_RELEASE" "$$CURRENT_LINK.next"; \
	node -e 'const fs = require("fs"); fs.renameSync(process.argv[1], process.argv[2]);' "$$CURRENT_LINK.next" "$$CURRENT_LINK"; \
	echo "kiwi rolled back to: $$PREVIOUS_RELEASE"

build:
	@set -eu; \
	run_pnpm() { \
		if command -v pnpm >/dev/null 2>&1; then pnpm "$$@"; else corepack pnpm "$$@"; fi; \
	}; \
	run_pnpm -r --filter @kiwi/cli... --filter @kiwi/mcp-server... --workspace-concurrency "$(BUILD_CONCURRENCY)" --aggregate-output --reporter=append-only build; \
	node scripts/check-bundle-requires.mjs apps/cli/dist/index.js apps/mcp-server/dist/index.js

check:
	@if command -v pnpm >/dev/null 2>&1; then pnpm release:check; else corepack pnpm release:check; fi

fix:
	@if command -v pnpm >/dev/null 2>&1; then pnpm format && pnpm lint:fix; else corepack pnpm format && corepack pnpm lint:fix; fi

smoke:
	@if command -v pnpm >/dev/null 2>&1; then pnpm smoke; else corepack pnpm smoke; fi
