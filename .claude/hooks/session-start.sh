#!/bin/bash
# SessionStart hook: install @openai/codex into a user-owned npm prefix and
# restore ~/.codex/auth.json from the CODEX_AUTH_B64 env var so the
# codex@openai-codex plugin can talk to OpenAI in a Claude Code on the web
# session. Idempotent — safe to re-run.
set -euo pipefail

# Only run in remote (Claude Code on the web) sessions; local users manage their own tooling.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

NPM_PREFIX="$HOME/.npm-global"
mkdir -p "$NPM_PREFIX/bin"

# Persist PATH for the rest of the session so `codex` is on $PATH for the agent.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$NPM_PREFIX/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
export PATH="$NPM_PREFIX/bin:$PATH"

# Install (or upgrade) @openai/codex into the user-owned prefix — no sudo needed.
echo "Installing @openai/codex into $NPM_PREFIX ..."
npm install -g --prefix "$NPM_PREFIX" @openai/codex

# Restore ~/.codex/auth.json from CODEX_AUTH_B64 (base64-encoded auth payload).
if [ -n "${CODEX_AUTH_B64:-}" ]; then
  mkdir -p "$HOME/.codex"
  printf '%s' "$CODEX_AUTH_B64" | base64 -d > "$HOME/.codex/auth.json"
  chmod 600 "$HOME/.codex/auth.json"
  echo "Restored ~/.codex/auth.json from CODEX_AUTH_B64."
else
  echo "CODEX_AUTH_B64 not set — skipping auth restore. Set it in your environment secrets to authenticate codex."
fi
