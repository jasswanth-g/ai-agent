# Qwipo DevOps

A local, CLI-driven DevOps tool for Qwipo's Azure DevOps. Trigger builds/releases, list recent builds, and check pipeline status — straight from your terminal or the built-in Build & Release web UI. Nothing leaves your machine except your Azure CLI calls.

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

- Homebrew, Node.js, Azure CLI (skips anything you already have)
- Clones the repo into `~/.qwipo-agent`
- Puts the `qwipo` command on your `$PATH`

**Expected time:** 5–8 min on a fresh Mac, 1–2 min if you already have Homebrew + Node. Sudo password is asked once (for Homebrew).

## First run

```bash
qwipo --setup
```

Prompts for your Azure DevOps org URL and project name. Also runs `az login` if you're not already logged in.

## Commands

```bash
qwipo builds <service>            # list recent builds for a service
qwipo releases <service>          # list recent releases for a service
qwipo status <build-id>           # check the status of a build
qwipo trigger <service> <branch>  # trigger a build for a service on a branch
qwipo services                    # list all configured services
qwipo --web                       # launch the Build & Release web UI (http://localhost:4317)
qwipo --setup                     # reconfigure org/project
```

Running `qwipo` with no arguments prints this command list.

## Update

```bash
cd ~/.qwipo-agent && git pull && npm install --production
```

## Uninstall

```bash
npm -g uninstall @qwipo/aiagent
rm -rf ~/.qwipo-agent ~/.config/configstore/aiagent.json
```

Homebrew-installed tools (Node, Azure CLI) stay put unless you `brew uninstall` them separately.

## Troubleshooting

**`qwipo: command not found`** — open a new terminal, or run `source ~/.zshrc`. If it still doesn't resolve, `npm root -g` shows where the symlink lives; that directory needs to be on your `$PATH`.

**Azure calls fail with auth errors** — run `az login` and retry.
