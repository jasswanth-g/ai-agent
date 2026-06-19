#!/usr/bin/env bash
# Qwipo DevOps — macOS APP installer (one command).
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/jasswanth-g/ai-agent/main/install-app.sh | bash
#
# Local usage (from the repo root):
#   ./install-app.sh
#
# What it does, end to end:
#   1. installs prerequisites if missing: Homebrew, Node.js, Azure CLI
#   2. fetches this repo (clone or update) into ~/.qwipo-agent
#   3. builds the desktop app with electron-builder
#   4. copies "Qwipo DevOps.app" into /Applications
# After that, the user just opens "Qwipo DevOps" from Launchpad / Applications.
#
# Honors:
#   QWIPO_REPO_URL     — git URL to clone (default: https://github.com/jasswanth-g/ai-agent.git)
#   QWIPO_INSTALL_DIR  — where to put the source (default: ~/.qwipo-agent)

printf "\n\033[1m\033[34m==>\033[0m \033[1mQwipo app installer starting — preparing your machine, please wait…\033[0m\n" >&2

set -euo pipefail

REPO_URL="${QWIPO_REPO_URL:-https://github.com/jasswanth-g/ai-agent.git}"
INSTALL_DIR="${QWIPO_INSTALL_DIR:-$HOME/.qwipo-agent}"
APP_NAME="Qwipo DevOps.app"

c_red="\033[0;31m"; c_green="\033[0;32m"; c_yellow="\033[0;33m"
c_blue="\033[0;34m"; c_bold="\033[1m"; c_dim="\033[2m"; c_reset="\033[0m"

step() { echo -e "\n${c_bold}${c_blue}==>${c_reset}${c_bold} $1${c_reset}"; }
ok()   { echo -e "${c_green}  \xe2\x9c\x93${c_reset} $1"; }
warn() { echo -e "${c_yellow}  !${c_reset} $1"; }
fail() { echo -e "${c_red}  \xe2\x9c\x97${c_reset} $1" >&2; exit 1; }
info() { echo -e "${c_dim}    $1${c_reset}"; }

# Keep stdin on the terminal so brew's password prompt works under curl|bash.
if [[ ! -t 0 ]] && [[ -r /dev/tty ]]; then exec </dev/tty; fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This installer currently supports macOS only."
fi

echo ""
echo -e "${c_bold}${c_blue}┌────────────────────────────────────────────────────────────┐${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  ${c_bold}Qwipo DevOps — desktop app installer${c_reset}                     ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}                                                            ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  Will install (if missing):                                ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}    • Homebrew     • Node.js     • Azure CLI               ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  Then builds and installs the app to /Applications.        ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}                                                            ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}│${c_reset}  ${c_dim}~5–10 min on a fresh Mac · ~2 min if tools are present.${c_reset}   ${c_bold}${c_blue}│${c_reset}"
echo -e "${c_bold}${c_blue}└────────────────────────────────────────────────────────────┘${c_reset}"
echo ""

# --- Homebrew ---
step "Checking Homebrew  ${c_dim}(5 s if installed · ~3–5 min + sudo password if not)${c_reset}"
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found. Installing — you'll see Homebrew's own output below:"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
  if [[ -x /usr/local/bin/brew     ]]; then eval "$(/usr/local/bin/brew shellenv)"; fi
else
  ok "Homebrew installed"
fi

# --- Node.js ---
step "Checking Node.js  ${c_dim}(instant if installed · ~30 s via brew if not)${c_reset}"
if ! command -v node >/dev/null 2>&1; then
  warn "Node not found. Running: brew install node"
  brew install node
else
  ok "Node installed ($(node --version))"
fi

# --- Azure CLI ---
step "Checking Azure CLI  ${c_dim}(instant if installed · ~2–3 min via brew if not)${c_reset}"
if ! command -v az >/dev/null 2>&1; then
  warn "Azure CLI not found. Running: brew install azure-cli"
  info "This pulls in Python + several deps. Brew will show download progress below."
  if ! brew install azure-cli; then
    warn "Automatic Azure CLI install failed."
    info "Install it manually, then re-run this script:"
    info "https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos"
    fail "Azure CLI is required."
  fi
else
  ok "Azure CLI installed"
fi

# --- Azure DevOps extension ---
# The app's commands (az pipelines / az repos) live in this extension, NOT in
# core az. Install it explicitly — az's own dynamic auto-install via pip is
# unreliable and is what produces the "Pip failed" error on first build.
step "Checking Azure DevOps extension  ${c_dim}(instant if installed · ~10 s if not)${c_reset}"
if az extension show --name azure-devops >/dev/null 2>&1; then
  ok "azure-devops extension installed"
else
  warn "azure-devops extension not found. Running: az extension add --name azure-devops"
  if ! az extension add --name azure-devops; then
    warn "Could not install the azure-devops extension automatically."
    info "Install it manually, then re-run this script:"
    info "  az extension add --name azure-devops"
    fail "The azure-devops extension is required (az pipelines / az repos)."
  fi
  ok "azure-devops extension installed"
fi

# --- source ---
step "Fetching app source"
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

# --- deps (full — build needs electron + electron-builder) ---
step "Installing dependencies  ${c_dim}(~1–2 min — downloads Electron the first time)${c_reset}"
( cd "$INSTALL_DIR" && npm install )

# --- build the app (unpacked .app; faster than a .dmg and all we need to install) ---
step "Building the app  ${c_dim}(~1–2 min)${c_reset}"
( cd "$INSTALL_DIR" && npx --no-install electron-builder --mac --dir )

# --- locate the freshly built .app under dist/ ---
built_app="$(find "$INSTALL_DIR/dist" -maxdepth 2 -name "$APP_NAME" -type d 2>/dev/null | head -1)"
[[ -n "$built_app" ]] || fail "Build finished but '$APP_NAME' was not found under $INSTALL_DIR/dist."

# --- install into /Applications ---
step "Installing into /Applications"
dest="/Applications/$APP_NAME"
rm -rf "$dest"
cp -R "$built_app" "$dest"
# Locally built + unsigned: clear the quarantine flag so it opens without the
# "unidentified developer" block on first launch.
xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
ok "Installed: $dest"

# --- Azure sign-in ---
step "Azure sign-in"
if az account show >/dev/null 2>&1; then
  ok "Already signed in to Azure"
else
  read -r -p "  Sign in to Azure now (opens a browser)? [Y/n] " a || a=""
  case "${a:-Y}" in
    [Nn]*) warn "Skipped — run 'az login' before using the app." ;;
    *) az login || warn "az login failed — you can run it later with 'az login'." ;;
  esac
fi

# --- org / project ---
# The app reads these from its config file (GUI apps don't see shell env vars).
# We MERGE into any existing file so other keys aren't clobbered.
step "Configure your Azure DevOps org & project"
CONFIG_FILE="$HOME/.config/configstore/aiagent.json"

# Pre-fill defaults from an existing config if present, else sensible team values.
cur_org="$(node -e 'try{process.stdout.write((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).azureDevOpsOrg)||"")}catch{}' "$CONFIG_FILE" 2>/dev/null)"
cur_proj="$(node -e 'try{process.stdout.write((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).azureDevOpsProject)||"")}catch{}' "$CONFIG_FILE" 2>/dev/null)"
default_org="${cur_org:-https://dev.azure.com/xavica/}"
default_project="${cur_proj:-Qwipo B2B}"

read -r -p "  Azure DevOps Org URL [$default_org]: " in_org || in_org=""
org="${in_org:-$default_org}"
read -r -p "  Azure DevOps Project [$default_project]: " in_proj || in_proj=""
project="${in_proj:-$default_project}"

node -e '
  const fs = require("fs"); const path = require("path");
  const file = process.argv[1];
  let obj = {};
  try { obj = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  obj.azureDevOpsOrg = process.argv[2];
  obj.azureDevOpsProject = process.argv[3];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
' "$CONFIG_FILE" "$org" "$project"
ok "Saved: org=$org  project=$project"

echo ""
echo -e "${c_bold}${c_green}Done.${c_reset}"
echo -e "Open ${c_bold}Qwipo DevOps${c_reset} from Launchpad or your Applications folder."
echo ""

# Offer to open it now (skip silently if not interactive).
if [[ -t 0 ]]; then
  read -r -p "Open Qwipo DevOps now? [Y/n] " ans || ans=""
  case "${ans:-Y}" in [Nn]*) : ;; *) open "$dest" ;; esac
fi
