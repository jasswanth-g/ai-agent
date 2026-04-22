# Qwipo DevOps Agent

A local, CLI-driven DevOps assistant for Qwipo's Azure DevOps. Ask it in plain English — it triggers builds/releases, lists work items, checks pipeline status, and more. All running on your laptop via Ollama (nothing leaves your machine except your Azure CLI calls).

## Install (macOS)

Copy-paste this in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/jasswanth-g/ai-agent/main/install.sh | bash
```

*Prefer to see download progress first?* Use this two-step variant instead — curl shows a progress bar while fetching, then bash runs the saved script with no stdin buffering:

```bash
curl -fL -o /tmp/qwipo-install.sh https://raw.githubusercontent.com/jasswanth-g/ai-agent/main/install.sh && bash /tmp/qwipo-install.sh
```

That's it. The installer takes care of everything:

- Homebrew, Node.js, Azure CLI, Ollama (skips anything you already have)
- `qwen2.5:7b` model (~5 GB, skipped if you have any model installed)
- Clones the agent into `~/.qwipo-agent`
- Puts the `qwipo` command on your `$PATH`

**Expected time:** 15–25 min on a fresh Mac, 1–2 min if you already have Homebrew + Node. Sudo password is asked once (for Homebrew).

## First run

```bash
qwipo --setup
```

Prompts for your Azure DevOps org URL, project name, and which Ollama model to use (picks from what you have installed, with `qwen2.5:7b` marked *recommended*). Also runs `az login` if you're not already logged in.

Then:

```bash
qwipo
```

Launches the interactive agent. Type questions or commands in plain English.

## Example prompts

```
what are my work items?
latest build for partner-portal
build and release core-service from dev to dev
build and release pre-order-service, cache-service, core-service from dev to dev
```

## Agent-to-agent usage

Claude Code or any other automation can invoke the agent headlessly:

```bash
qwipo --prompt "build and release core-service from dev to dev"
```

Returns the result on stdout; write-confirmations are auto-accepted in this mode.

## Update

```bash
cd ~/.qwipo-agent && git pull && npm install --production
```

## Uninstall

```bash
npm -g uninstall @qwipo/aiagent
rm -rf ~/.qwipo-agent ~/.config/configstore/aiagent.json
```

Homebrew-installed tools (Node, Azure CLI, Ollama) stay put unless you `brew uninstall` them separately.

## Troubleshooting

**`qwipo: command not found`** — open a new terminal, or run `source ~/.zshrc`. If it still doesn't resolve, `npm root -g` shows where the symlink lives; that directory needs to be on your `$PATH`.

**Setup asks for a model but none show up** — check the Ollama daemon: `brew services list | grep ollama`. If it's `stopped`, run `brew services start ollama` and re-run `qwipo --setup`.

**Azure calls fail with auth errors** — run `az login` and retry.
