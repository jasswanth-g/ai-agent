const { OLLAMA_URL, MODEL } = require("../config");

async function chat(messages) {
  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, stream: false }),
  });
  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  return data.message.content;
}

async function chatStream(messages, onToken) {
  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, stream: true }),
  });
  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status} ${resp.statusText}`);
  }

  let fullContent = "";
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.message && json.message.content) {
          const token = json.message.content;
          fullContent += token;
          if (onToken) onToken(token);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return fullContent;
}

module.exports = { chat, chatStream };
