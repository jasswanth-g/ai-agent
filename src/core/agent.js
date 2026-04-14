const readline = require("readline");
const { execFile } = require("child_process");
const chalk = require("chalk");
const ora = require("ora");
const { MAX_TOOL_STEPS, AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");
const { chat } = require("./ollama");
const { extractToolCall } = require("./parser");
const { buildSystemPrompt } = require("./prompt");
const { loadTools, getToolDescriptions, runTool } = require("../tools");
const { SERVICE_ALIASES } = require("../config/serviceAliases");
const { config, runSetup } = require("../setup");

// Debug mode — toggled with Ctrl+L
let debugMode = false;

function debugLog(label, data) {
  if (!debugMode) return;
  const border = chalk.dim.yellow("│");
  console.log("");
  console.log(chalk.dim.yellow("┌─ DEBUG ─────────────────────────────────────────"));
  console.log(`${border} ${chalk.yellow.bold(label)}`);
  const lines = String(data).split("\n");
  lines.forEach((line) => {
    console.log(`${border} ${chalk.dim(line)}`);
  });
  console.log(chalk.dim.yellow("└─────────────────────────────────────────────────"));
}

async function checkPrerequisites() {
  const spinner = ora("Checking prerequisites...").start();

  const azAvailable = await new Promise((resolve) => {
    execFile("az", ["--version"], (err) => resolve(!err));
  });

  if (!azAvailable) {
    spinner.warn("Azure CLI (az) not found — Azure tools will not work.");
  } else if (!AZURE_DEVOPS_ORG || !AZURE_DEVOPS_PROJECT) {
    spinner.warn("Azure DevOps org/project not configured. Run: qwipo --setup");
  } else {
    spinner.succeed("Azure CLI connected");
  }
}

async function fetchAzureUserName() {
  try {
    const { AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG } = require("../config");
    const url = AZURE_DEVOPS_ORG + "_apis/connectionData";
    const resp = await fetch(url, {
      headers: {
        Authorization: "Basic " + Buffer.from(":" + AZURE_DEVOPS_PAT).toString("base64"),
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.authenticatedUser?.providerDisplayName || null;
  } catch {
    return null;
  }
}

function printBanner(userName) {
  const displayName = userName || "there";
  console.log("");
  const brand = chalk.hex("#be78ff").bold;
  console.log(brand("  ╔════════════════════════════════╗"));
  console.log(brand("  ║") + chalk.hex("#be78ff").bold("      Qwipo DevOps Agent        ") + brand("║"));
  console.log(brand("  ║") + chalk.gray("    Azure DevOps CI/CD Agent    ") + brand("║"));
  console.log(brand("  ╚════════════════════════════════╝"));
  console.log("");
  console.log(chalk.white(`  Hey ${chalk.cyan.bold(displayName)}! How can I help you today?`));
  console.log("");
  // console.log(chalk.gray("  Commands: /clear  /history  /services  /logout  /help"));
  console.log(chalk.gray("  Type 'quit' to exit. Press Ctrl+L to toggle debug logs.\n"));
}

function printHelp() {
  console.log("");
  console.log(chalk.cyan.bold("  Available Commands:"));
  console.log(chalk.white("  /clear      ") + chalk.gray("— Clear conversation and start fresh"));
  console.log(chalk.white("  /history    ") + chalk.gray("— Show your prompts from this session"));
  console.log(chalk.white("  /services   ") + chalk.gray("— List all configured services"));
  console.log(chalk.white("  /help       ") + chalk.gray("— Show this help"));
  console.log(chalk.white("  /logout     ") + chalk.gray("— Clear saved config and re-run setup"));
  console.log(chalk.white("  quit        ") + chalk.gray("— Exit the agent"));
  console.log("");
  console.log(chalk.cyan.bold("  Ask me things like:"));
  console.log(chalk.gray('  "What are the last 5 builds for core-service?"'));
  console.log(chalk.gray('  "Trigger build for partner-portal from testing"'));
  console.log(chalk.gray('  "Who made the latest release of auth-service?"'));
  console.log("");
}

function printServices() {
  console.log("");
  console.log(chalk.cyan.bold("  Configured Services:\n"));
  const names = Object.keys(SERVICE_ALIASES);
  const mid = Math.ceil(names.length / 2);
  for (let i = 0; i < mid; i++) {
    const left = chalk.white(`  ${names[i] || ""}`).padEnd(45);
    const right = names[i + mid] ? chalk.white(names[i + mid]) : "";
    console.log(left + right);
  }
  console.log(chalk.gray(`\n  Total: ${names.length} services\n`));
}

function printHistory(userHistory) {
  console.log("");
  if (userHistory.length === 0) {
    console.log(chalk.gray("  No prompts yet in this session.\n"));
    return;
  }
  console.log(chalk.cyan.bold("  Session History:\n"));
  userHistory.forEach((msg, i) => {
    console.log(chalk.gray(`  ${i + 1}. `) + chalk.white(msg));
  });
  console.log("");
}

const SLASH_COMMANDS = [
  { cmd: "/clear",    desc: "Clear conversation and start fresh" },
  { cmd: "/history",  desc: "Show your prompts from this session" },
  { cmd: "/services", desc: "List all configured services" },
  { cmd: "/debug",    desc: "Toggle debug logs (Ctrl+L)" },
  { cmd: "/logout",   desc: "Clear saved config and re-run setup" },
  { cmd: "/help",     desc: "Show all commands and examples" },
];

function renderSlashMenu(filter, prevMenuLines, selectedIndex) {
  const matches = SLASH_COMMANDS.filter((s) => s.cmd.startsWith(filter));

  // Strategy: redraw the prompt line + menu from scratch each time
  // 1. Move cursor to beginning of prompt line
  // 2. Clear everything from cursor to end of screen
  // 3. Rewrite prompt + input + menu

  // Move to start of current line
  process.stdout.write("\r");
  // Clear from cursor to end of screen (wipes prompt line + all menu lines below)
  process.stdout.write("\x1B[J");
  // Rewrite the prompt line with current input
  process.stdout.write(chalk.bold.magenta("❯ ") + filter);

  if (matches.length === 0) return { count: 0, matches };

  // Draw menu lines below
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    process.stdout.write("\n");

    if (i === selectedIndex) {
      const row = `  ${m.cmd}${" ".repeat(Math.max(0, 14 - m.cmd.length))}${m.desc}  `;
      process.stdout.write(chalk.bgCyan.black.bold(row));
    } else {
      const highlighted = filter.length > 1
        ? chalk.cyan.bold(m.cmd.slice(0, filter.length)) + chalk.cyan(m.cmd.slice(filter.length))
        : chalk.cyan(m.cmd);
      process.stdout.write(`  ${highlighted}${" ".repeat(Math.max(0, 14 - m.cmd.length))}${chalk.gray(m.desc)}`);
    }
  }

  // Move cursor back up to the prompt line
  if (matches.length > 0) {
    process.stdout.write(`\x1B[${matches.length}A`);
  }
  // Position cursor at end of prompt (after "❯ " which is 2 visible chars)
  // The actual input text will be redrawn by redrawPrompt
  process.stdout.write(`\r\x1B[999C`);

  return { count: matches.length, matches };
}

function showConfirmSelector() {
  return new Promise((resolve) => {
    const options = [
      { label: "Yes, and wait for completion", value: "yes, wait" },
      { label: "Yes, proceed", value: "yes" },
      { label: "No, cancel", value: "no" },
    ];
    let selected = 0;

    if (!process.stdin.isTTY) {
      // Fallback for piped input
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(chalk.bold.magenta("  Confirm (yes/no): "), (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    function render() {
      // Clear previous render
      process.stdout.write(`\x1B[${options.length}A`);
      options.forEach((opt, i) => {
        process.stdout.write("\x1B[2K");
        if (i === selected) {
          console.log(chalk.bgCyan.black.bold(`  ❯ ${opt.label}  `));
        } else {
          console.log(chalk.gray(`    ${opt.label}`));
        }
      });
    }

    // Initial render
    options.forEach((opt, i) => {
      if (i === selected) {
        console.log(chalk.bgCyan.black.bold(`  ❯ ${opt.label}  `));
      } else {
        console.log(chalk.gray(`    ${opt.label}`));
      }
    });

    if (!keypressInitialized) {
      readline.emitKeypressEvents(process.stdin);
      keypressInitialized = true;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKey = (ch, key) => {
      if (!key) return;

      if (key.name === "down") {
        selected = Math.min(selected + 1, options.length - 1);
        render();
      } else if (key.name === "up") {
        selected = Math.max(selected - 1, 0);
        render();
      } else if (key.name === "return") {
        process.stdin.removeListener("keypress", onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        // Highlight final selection
        process.stdout.write(`\x1B[${options.length}A`);
        options.forEach((opt, i) => {
          process.stdout.write("\x1B[2K");
          if (i === selected) {
            console.log(chalk.green.bold(`  ✔ ${opt.label}`));
          } else {
            console.log(""); // clear line
          }
        });
        resolve(options[selected].value);
      } else if (key.ctrl && key.name === "c") {
        process.stdin.removeListener("keypress", onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve("no");
      }
    };

    process.stdin.on("keypress", onKey);
  });
}

// Initialize keypress events once
let keypressInitialized = false;

function getUserInput() {
  return new Promise((resolve) => {
    const serviceNames = Object.keys(SERVICE_ALIASES);
    const allCompletions = [...SLASH_COMMANDS.map((s) => s.cmd), ...serviceNames, "quit", "exit"];

    // Non-TTY fallback (piped input)
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(chalk.bold.magenta("❯ "), (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    // Enable keypress events only once
    if (!keypressInitialized) {
      readline.emitKeypressEvents(process.stdin);
      keypressInitialized = true;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let input = "";         // what the user actually typed (used for filtering)
    let cursor = 0;          // cursor position within input
    let displayInput = "";   // what's shown in prompt (may be selected cmd)
    let menuLines = 0;
    let selectedIndex = -1;
    let currentMatches = [];
    const PROMPT_PREFIX = "❯ ";
    const PROMPT_LEN = 2; // visible length of "❯ "

    // Draw prompt with bottom border, then move cursor back up to input line
    const cols = process.stdout.columns || 80;
    process.stdout.write(chalk.bold.magenta(PROMPT_PREFIX));
    process.stdout.write("\n" + chalk.dim("─".repeat(cols)));
    process.stdout.write("\x1B[1A"); // move back up to input line
    process.stdout.write(`\r\x1B[${PROMPT_LEN}C`); // position after "❯ "

    function updateMenu() {
      if (input.startsWith("/")) {
        const result = renderSlashMenu(input.toLowerCase(), menuLines, selectedIndex);
        menuLines = result.count;
        currentMatches = result.matches;
      } else if (menuLines > 0) {
        clearMenu();
        selectedIndex = -1;
        currentMatches = [];
      }
    }

    function redrawPrompt(text, cursorPos) {
      process.stdout.write("\r\x1B[2K");
      process.stdout.write(chalk.bold.magenta(PROMPT_PREFIX) + text);
      displayInput = text;
      // Position cursor
      const pos = cursorPos !== undefined ? cursorPos : text.length;
      const moveBack = text.length - pos;
      if (moveBack > 0) {
        process.stdout.write(`\x1B[${moveBack}D`);
      }
    }

    const onKeypress = (ch, key) => {
      if (!key && !ch) return;

      // Ctrl+C
      if (key && key.ctrl && key.name === "c") {
        clearMenu();
        process.stdout.write("\n");
        cleanup();
        process.exit(0);
      }

      // Ctrl+L — toggle debug mode
      if (key && key.ctrl && key.name === "l") {
        debugMode = !debugMode;
        process.stdout.write("\r\x1B[2K");
        console.log(debugMode
          ? chalk.yellow("\n  Debug mode ON — tool logs will be visible\n")
          : chalk.gray("\n  Debug mode OFF\n")
        );
        redrawPrompt(input, cursor);
        return;
      }

      // Ctrl+D — exit
      if (key && key.ctrl && key.name === "d") {
        clearMenu();
        process.stdout.write("\n");
        cleanup();
        resolve("quit");
        return;
      }

      // Ctrl+A — move to start
      if (key && key.ctrl && key.name === "a") {
        cursor = 0;
        process.stdout.write(`\r\x1B[${PROMPT_LEN}C`);
        return;
      }

      // Ctrl+E — move to end
      if (key && key.ctrl && key.name === "e") {
        cursor = input.length;
        process.stdout.write(`\r\x1B[${PROMPT_LEN + input.length}C`);
        return;
      }

      // Escape — close menu
      if (key && key.name === "escape") {
        if (menuLines > 0) {
          clearMenu();
          selectedIndex = -1;
          currentMatches = [];
          redrawPrompt(input, cursor);
        }
        return;
      }

      // Arrow left — move cursor left
      if (key && key.name === "left") {
        if (cursor > 0) {
          cursor--;
          process.stdout.write("\x1B[1D");
        }
        return;
      }

      // Arrow right — move cursor right
      if (key && key.name === "right") {
        if (cursor < input.length) {
          cursor++;
          process.stdout.write("\x1B[1C");
        }
        return;
      }

      // Arrow down — navigate menu
      if (key && key.name === "down") {
        if (currentMatches.length > 0) {
          selectedIndex = Math.min(selectedIndex + 1, currentMatches.length - 1);
          updateMenu();
          redrawPrompt(currentMatches[selectedIndex].cmd);
          cursor = currentMatches[selectedIndex].cmd.length;
        }
        return;
      }

      // Arrow up — navigate menu
      if (key && key.name === "up") {
        if (currentMatches.length > 0 && selectedIndex > 0) {
          selectedIndex--;
          updateMenu();
          redrawPrompt(currentMatches[selectedIndex].cmd);
          cursor = currentMatches[selectedIndex].cmd.length;
        } else if (selectedIndex === 0) {
          selectedIndex = -1;
          updateMenu();
          redrawPrompt(input);
          cursor = input.length;
        }
        return;
      }

      // Enter — submit
      if (key && key.name === "return") {
        const finalInput = selectedIndex >= 0 && currentMatches.length > 0
          ? currentMatches[selectedIndex].cmd
          : input;
        clearMenu();
        // Move past the bottom border line (1 down for newline + 1 to skip border)
        process.stdout.write("\n\n");
        cleanup();
        resolve(finalInput.trim());
        return;
      }

      // Backspace — delete char before cursor
      if (key && key.name === "backspace") {
        if (cursor > 0) {
          input = input.slice(0, cursor - 1) + input.slice(cursor);
          cursor--;
          selectedIndex = -1;
          redrawPrompt(input, cursor);
          updateMenu();
        }
        return;
      }

      // Delete — delete char at cursor
      if (key && key.name === "delete") {
        if (cursor < input.length) {
          input = input.slice(0, cursor) + input.slice(cursor + 1);
          selectedIndex = -1;
          redrawPrompt(input, cursor);
          updateMenu();
        }
        return;
      }

      // Tab — fill in selected command
      if (key && key.name === "tab") {
        if (selectedIndex >= 0 && currentMatches.length > 0) {
          input = currentMatches[selectedIndex].cmd;
          cursor = input.length;
          clearMenu();
          redrawPrompt(input);
          selectedIndex = -1;
          currentMatches = [];
        } else if (input.startsWith("/")) {
          const matches = SLASH_COMMANDS.filter((s) => s.cmd.startsWith(input.toLowerCase()));
          if (matches.length === 1) {
            input = matches[0].cmd;
            cursor = input.length;
            clearMenu();
            redrawPrompt(input);
            selectedIndex = -1;
            currentMatches = [];
          }
        } else {
          const hits = allCompletions.filter((c) => c.startsWith(input.toLowerCase()));
          if (hits.length === 1) {
            input = hits[0];
            cursor = input.length;
            redrawPrompt(input);
          }
        }
        return;
      }

      // Regular character — insert at cursor position
      if (ch && (!key || (!key.ctrl && !key.meta))) {
        input = input.slice(0, cursor) + ch + input.slice(cursor);
        cursor++;
        selectedIndex = -1;
        redrawPrompt(input, cursor);
        updateMenu();
      }
    };

    function clearMenu() {
      if (menuLines > 0) {
        // Save position, clear everything below, restore position
        process.stdout.write("\x1B[J"); // clear from cursor to end of screen
        menuLines = 0;
      }
    }

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    process.stdin.on("keypress", onKeypress);
  });
}

async function startAgent() {
  const userName = await fetchAzureUserName();
  printBanner(userName);
  await checkPrerequisites();
  console.log("");

  const tools = loadTools();
  const toolDescriptions = getToolDescriptions(tools);
  const systemPrompt = buildSystemPrompt(toolDescriptions);

  let conversation = [{ role: "system", content: systemPrompt }];
  const userHistory = [];

  while (true) {
    // Claude Code-style prompt with top and bottom borders
    const cols = process.stdout.columns || 80;

    // Push content up so prompt doesn't sit at the very bottom
    if (process.stdout.isTTY) {
      const rows = process.stdout.rows || 24;
      const pad = Math.min(8, rows - 2);
      // Scroll the terminal by writing lines below viewport
      for (let i = 0; i < pad; i++) {
        process.stdout.write("\n");
      }
      // Move cursor back up
      process.stdout.write(`\x1B[${pad}A`);
      // Clear from cursor to bottom to remove artifacts
      process.stdout.write("\x1B[J");
    }

    console.log(chalk.dim("─".repeat(cols)));

    const userInput = await getUserInput();

    if (!userInput) continue;

    // Handle quit
    if (["quit", "exit"].includes(userInput.toLowerCase())) {
      console.log(chalk.gray("\n  Goodbye!\n"));
      break;
    }

    // Handle slash commands
    if (userInput.toLowerCase() === "/clear") {
      conversation = [{ role: "system", content: systemPrompt }];
      userHistory.length = 0;
      console.log(chalk.green("\n  Conversation cleared.\n"));
      continue;
    }
    if (userInput.toLowerCase() === "/history") {
      printHistory(userHistory);
      continue;
    }
    if (userInput.toLowerCase() === "/services") {
      printServices();
      continue;
    }
    if (userInput.toLowerCase() === "/help") {
      printHelp();
      continue;
    }
    if (userInput.toLowerCase() === "/debug") {
      debugMode = !debugMode;
      console.log(debugMode
        ? chalk.yellow("\n  Debug mode ON — tool logs will be visible\n")
        : chalk.gray("\n  Debug mode OFF\n")
      );
      continue;
    }
    if (userInput.toLowerCase() === "/logout") {
      config.clear();
      console.log(chalk.yellow("\n  Config cleared. Running setup...\n"));
      await runSetup();
      console.log(chalk.green("  Logged in with new config.\n"));
      continue;
    }

    // Unknown slash command
    if (userInput.startsWith("/")) {
      console.log(chalk.red(`\n  Unknown command: ${userInput}\n`));
      continue;
    }

    // Reprint user input with styling so it stands out in scrollback
    process.stdout.write("\x1B[1A\x1B[2K"); // move up past bottom border to input line
    process.stdout.write("\x1B[1A\x1B[2K"); // clear input line
    console.log(chalk.bold.magenta("❯ ") + chalk.bgGray.white.bold(` ${userInput} `));

    userHistory.push(userInput);
    conversation.push({ role: "user", content: userInput });

    let responded = false;
    const recentCalls = [];
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const spinner = ora({
        text: "Thinking...",
        color: "cyan",
      }).start();

      let reply;
      try {
        reply = await chat(conversation);
      } catch (err) {
        spinner.fail(chalk.red("LLM error: " + err.message));
        responded = true;
        break;
      }

      debugLog("LLM Response", reply);

      const toolCall = extractToolCall(reply);

      if (!toolCall) {
        spinner.stop();
        console.log("");

        // Detect confirmation prompts and show interactive selector
        const isConfirmation = /shall i proceed|confirm|yes\/no|yes or no|\(yes\/no\)/i.test(reply);

        if (isConfirmation) {
          // Show the message without the yes/no part
          const cleanReply = reply.replace(/\s*\(yes\/no.*?\)/gi, "").replace(/\s*Shall I proceed\?/gi, "").trim();
          for (const char of cleanReply) {
            process.stdout.write(char);
            await new Promise((r) => setTimeout(r, 8));
          }
          console.log("\n\n");

          // Show interactive selector
          const answer = await showConfirmSelector();
          conversation.push({ role: "assistant", content: reply });
          conversation.push({ role: "user", content: answer });

          if (answer.toLowerCase().startsWith("yes")) {
            // Continue the loop — LLM will proceed with the action
            continue;
          } else {
            console.log(chalk.yellow("\n  Cancelled.\n"));
            responded = true;
            break;
          }
        }

        console.log(reply);
        console.log("");
        conversation.push({ role: "assistant", content: reply });
        responded = true;
        break;
      }

      const { tool: toolName, args: toolArgs } = toolCall;

      // Detect repeated tool calls
      const callKey = JSON.stringify({ tool: toolName, args: toolArgs });
      if (recentCalls.includes(callKey)) {
        spinner.stop();
        conversation.push({ role: "assistant", content: reply });
        conversation.push({
          role: "user",
          content: `You already called ${toolName} with the same arguments. Use the previous result to answer the question. Do NOT call the same tool again.`,
        });
        continue;
      }
      recentCalls.push(callKey);

      debugLog(`Tool Call: ${toolName}`, JSON.stringify(toolArgs, null, 2));

      spinner.text = `Running ${chalk.yellow(toolName)}...`;

      try {
        const result = await runTool(tools, toolName, toolArgs);
        spinner.succeed(chalk.gray(`${toolName} `) + chalk.green("done"));

        debugLog(`Tool Result: ${toolName}`, result);

        // Tools with formatted output — display directly, skip LLM reformatting
        const directDisplayTools = ["az_list_work_items", "az_build_and_release", "az_branch_diff"];
        if (directDisplayTools.includes(toolName)) {
          console.log("\n" + result + "\n");
          conversation.push({ role: "assistant", content: reply });
          conversation.push({
            role: "user",
            content: `Tool ${toolName} executed successfully. The result has already been shown to the user. Do NOT repeat, reformat, or summarize the data. Just say "Let me know if you need anything else."`,
          });
        } else {
          conversation.push({ role: "assistant", content: reply });
          conversation.push({
            role: "user",
            content: `Tool result for ${toolName}:\n${result}\n\nNow use this result to answer my original question.`,
          });
        }
      } catch (err) {
        spinner.fail(chalk.red(`${toolName} failed: ${err.message}`));
        conversation.push({ role: "assistant", content: reply });
        conversation.push({
          role: "user",
          content: `Tool result for ${toolName}: Error - ${err.message}`,
        });
      }
    }

    if (!responded) {
      console.log(chalk.red("\nAgent: (max tool steps reached)\n"));
    }
  }
}

module.exports = { startAgent };
