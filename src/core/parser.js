/**
 * Try to extract a tool call JSON from the model's response.
 * Handles various LLM quirks:
 * - JSON on its own line
 * - JSON wrapped in markdown code blocks
 * - JSON with surrounding text
 */
function extractToolCall(text) {
  // Try 1: Look for a clean JSON line
  for (const line of text.trim().split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj.tool) return obj;
      } catch {
        continue;
      }
    }
  }

  // Try 2: Extract JSON from markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/);
  if (codeBlockMatch) {
    try {
      const obj = JSON.parse(codeBlockMatch[1]);
      if (obj.tool) return obj;
    } catch {}
  }

  // Try 3: Find any JSON object with "tool" key anywhere in the text
  const jsonMatch = text.match(/\{[^{}]*"tool"\s*:\s*"[^"]+"\s*[,}][^{}]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj.tool) return obj;
    } catch {}
  }

  return null;
}

module.exports = { extractToolCall };
