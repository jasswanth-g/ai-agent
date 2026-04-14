const { MAX_TOOL_STEPS } = require("../config");
const { chat } = require("./ollama");
const { extractToolCall } = require("./parser");
const { buildSystemPrompt } = require("./prompt");
const { loadTools, getToolDescriptions, runTool } = require("../tools");

/**
 * Run the agent in headless (non-interactive) mode.
 * Takes a single prompt, executes the full tool loop, returns the final text.
 * Used for agent-to-agent communication (e.g. Claude Code calling Qwipo).
 *
 * For build/release confirmations, auto-confirms with "yes, wait"
 * since the calling agent has already decided to proceed.
 */
async function runHeadless(prompt, options = {}) {
  const { autoConfirm = true } = options;

  const tools = loadTools();
  const toolDescriptions = getToolDescriptions(tools);
  const systemPrompt = buildSystemPrompt(toolDescriptions);

  const conversation = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  const results = [];

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const reply = await chat(conversation);
    const toolCall = extractToolCall(reply);

    if (!toolCall) {
      // Check if it's asking for confirmation — auto-confirm in headless mode
      const isConfirmation = /shall i proceed|confirm|yes\/no|yes or no/i.test(reply);

      if (isConfirmation && autoConfirm) {
        conversation.push({ role: "assistant", content: reply });
        conversation.push({ role: "user", content: "yes, wait" });
        results.push(`[Confirmation] ${reply.trim()}`);
        continue;
      }

      // Final response
      results.push(reply.trim());
      return results.join("\n\n");
    }

    const { tool: toolName, args: toolArgs } = toolCall;

    // Execute the tool
    const result = await runTool(tools, toolName, toolArgs);
    results.push(`[${toolName}] ${result}`);

    conversation.push({ role: "assistant", content: reply });
    conversation.push({
      role: "user",
      content: `Tool result for ${toolName}:\n${result}\n\nNow use this result to answer my original question.`,
    });
  }

  results.push("[Max tool steps reached]");
  return results.join("\n\n");
}

module.exports = { runHeadless };
