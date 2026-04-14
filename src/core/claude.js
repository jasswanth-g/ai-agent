const Anthropic = require("@anthropic-ai/sdk");
const { getConfig } = require("../setup");

let client = null;

function getClient() {
  if (!client) {
    const apiKey = getConfig("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured. Run: qwipo --setup");
    client = new Anthropic({ apiKey });
  }
  return client;
}

async function chat(systemPrompt, messages, tools) {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: systemPrompt,
    messages,
    tools,
  });

  return response;
}

async function chatStream(systemPrompt, messages, tools, onText) {
  const anthropic = getClient();

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: systemPrompt,
    messages,
    tools,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      if (onText) onText(event.delta.text);
    }
  }

  return stream.finalMessage();
}

module.exports = { chat, chatStream };
