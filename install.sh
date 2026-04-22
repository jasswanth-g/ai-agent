#!/usr/bin/env bash
# Qwipo DevOps Agent — macOS installer
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/jasswanth-g/ai-agent/main/install.sh | bash
#
# Local usage (from the repo root):
#   ./install.sh
#
# Honors these env vars:
#   QWIPO_REPO_URL     — git URL to clone (default: https://github.com/jasswanth-g/ai-agent.git)
#   QWIPO_INSTALL_DIR  — where to put the source (default: ~/.qwipo-agent)
set -euo pipefail

REPO_URL="${QWIPO_REPO_URL:-https://github.com/jasswanth-g/ai-agent.git}"
INSTALL_DIR="${QWIPO_INSTALL_DIR:-$HOME/.qwipo-agent}"
RECOMMENDED_MODEL="qwen2.5:7b"

c_red="\033[0;31m"
c_green="\033[0;32m"
c_yellow="\033[0;33m"
c_blue="\033[0;34m"
c_bold="\033[1m"
c_dim="\033[2m"
c_reset="\033[0m"

step() { echo -e "\n${c_bold}${c_blue}==>${c_reset}${c_bold} $1${c_reset}"; }
ok()   { echo -e "${c_green}  \xe2\x9c\x93${c_reset} $1"; }
warn() { echo -e "${c_yellow}  !${c_reset} $1"; }
fail() { echo -e "${c_red}  \xe2\x9c\x97${c_reset} $1" >&2; exit 1; }
info() { echo -e "${c_dim}    $1${c_reset}"; }

# If the user piped us into bash from curl, keep stdin on /dev/tty so brew's
# prompts (e.g. password) still work.
if [[ ! -t 0 ]] && [[ -r /dev/tty ]]; then exec </dev/tty; fi

# --- platform guard ---
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This installer currently supports macOS only."
fi

# --- upfront banner so the user knows what's about to happen ---
echo ""
echo -e "${c_bold}${c_blue}┌────────────────────────────────────────────────────────────┐${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  ${c_bold}Qwipo DevOps Agent — installer${c_reset}                           ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}                                                            ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  Will install (if missing):                                ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}    • Homebrew       • Node.js        • Azure CLI          ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}    • Ollama         • qwen2.5:7b model (~5 GB)            ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}    • this repo      → ~/.qwipo-agent                      ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}                                                            ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  ${c_dim}Expected time: 15–25 min on a fresh Mac,${c_reset}                 ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  ${c_dim}1–2 min if you already have Homebrew + Node.${c_reset}             ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  ${c_dim}Sudo password may be required once (for Homebrew).${c_reset}       ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}└────────────────────────────────────────────────────────────┘${c_reset}"
echo ""

# --- Homebrew ---
step "Checking Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found. Installing…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to current shell PATH (Apple Silicon puts it under /opt/homebrew).
  if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
  if [[ -x /usr/local/bin/brew     ]]; then eval "$(/usr/local/bin/brew shellenv)"; fi
else
  ok "Homebrew installed"
fi

# --- Node.js (any source: brew, nvm, asdf — all fine as long as node is callable) ---
step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  warn "Node not found. Installing via Homebrew…"
  brew install node
else
  ok "Node installed ($(node --version))"
fi

# --- Azure CLI ---
step "Checking Azure CLI"
if ! command -v az >/dev/null 2>&1; then
  warn "Azure CLI not found. Installing via Homebrew (this can take a minute)…"
  brew install azure-cli
else
  ok "Azure CLI installed"
fi

# --- Ollama ---
step "Checking Ollama"
if ! command -v ollama >/dev/null 2>&1; then
  warn "Ollama not found. Installing via Homebrew…"
  brew install ollama
  info "Starting Ollama service in the background…"
  brew services start ollama >/dev/null 2>&1 || true
  sleep 3
else
  ok "Ollama installed"
  # Make sure the daemon is running — pull/list need it.
  if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    info "Ollama daemon not running — starting it…"
    brew services start ollama >/dev/null 2>&1 || true
    sleep 3
  fi
fi

# --- at least one model ---
step "Ensuring an Ollama model is available"
existing_models=$(ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -v '^$' || true)
if [[ -n "$existing_models" ]]; then
  ok "Models already installed:"
  echo "$existing_models" | sed 's/^/      - /'
  info "You'll pick which one to use during 'qwipo --setup'."
else
  warn "No models installed. Pulling ${c_bold}${RECOMMENDED_MODEL}${c_reset} (~5 GB, one time)…"
  ollama pull "$RECOMMENDED_MODEL"
fi

# --- source ---
step "Fetching qwipo agent source"
# If we're already inside a clone of this repo, reuse it. Otherwise clone fresh.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P 2>/dev/null || pwd)"
if [[ -f "$script_dir/package.json" ]] && grep -q '"qwipo"' "$script_dir/package.json" 2>/dev/null; then
  INSTALL_DIR="$script_dir"
  info "Using current repo at $INSTALL_DIR"
elif [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Existing install at $INSTALL_DIR — updating…"
  git -C "$INSTALL_DIR" pull --ff-only || warn "git pull failed — continuing with existing copy"
else
  info "Cloning into $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# --- deps + link ---
step "Installing npm dependencies"
( cd "$INSTALL_DIR" && npm install --production )

step "Linking 'qwipo' onto your PATH"
( cd "$INSTALL_DIR" && npm link )

# --- verify ---
if command -v qwipo >/dev/null 2>&1; then
  ok "qwipo is ready: $(command -v qwipo)"
else
  global_bin="$(npm bin -g 2>/dev/null || true)"
  fail "qwipo was linked but isn't on \$PATH. Add ${global_bin} to your PATH and reopen the terminal."
fi

echo ""
echo -e "${c_bold}${c_green}Installed.${c_reset}"
echo -e "Next: run ${c_bold}qwipo --setup${c_reset} to pick your Azure DevOps org and Ollama model."
echo -e "Then just type ${c_bold}qwipo${c_reset} anywhere to start the agent."
echo ""
