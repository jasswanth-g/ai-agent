/**
 * Deterministic write-intent parser.
 *
 * The Ollama models we run are too unreliable to be trusted with the build/release
 * recipe — they skip the resolver, swap default branches in, or pick the wrong
 * action. So we parse build/release/deploy commands ourselves and only fall back
 * to the LLM for everything else (chitchat, READ queries, work items, etc.).
 */

const READ_PREFIX = /^(list|show|tell|what|when|who|how|why|recent|last|status\s+(of|for)|are\s+there|is\s+there)\b/i;

const ACTION_REGEX =
  /^(?:can\s+you\s+|could\s+you\s+|would\s+you\s+|please\s+|kindly\s+|hey,?\s+)?(?:give\s+(?:me\s+)?(?:a\s+)?|trigger\s+(?:a\s+)?|run\s+(?:a\s+)?|do\s+(?:a\s+)?|make\s+(?:a\s+)?|kick\s+off\s+(?:a\s+)?|start\s+(?:a\s+)?)?(build\s+and\s+release|build\s*(?:&|\+)\s*release|release\s+and\s+build|build|release|deploy)\b/i;

function parseWriteIntent(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bail on READ-like queries — even ones that mention "build" / "release".
  if (READ_PREFIX.test(trimmed)) return null;

  const actionMatch = trimmed.match(ACTION_REGEX);
  if (!actionMatch) return null;

  const verbRaw = actionMatch[1].toLowerCase().replace(/\s+/g, " ");
  let action;
  if (/build\s+and\s+release|build\s*&\s*release|build\s*\+\s*release|release\s+and\s+build/.test(verbRaw)) {
    action = "build_and_release";
  } else if (verbRaw === "deploy" || verbRaw === "release") {
    action = "build_and_release";
  } else if (verbRaw === "build") {
    action = "build";
  } else {
    return null;
  }

  let rest = trimmed.slice(actionMatch[0].length).trim();

  // Extract branch: "from <branch>" or "from branch <branch>"
  let branch = null;
  const branchMatch = rest.match(/\bfrom\s+(?:(?:the\s+)?branch\s+)?([a-zA-Z0-9_\-\/\.]+)/i);
  if (branchMatch) {
    branch = branchMatch[1];
    rest = (rest.slice(0, branchMatch.index) + " " + rest.slice(branchMatch.index + branchMatch[0].length)).trim();
  }

  // Extract environment: "to <env>", "to env <env>", "to <env> environment"
  let environment = null;
  const envMatch = rest.match(/\b(?:to|in)\s+(?:env(?:ironment)?\s+|the\s+)?([a-zA-Z0-9_\-]+)(?:\s+env(?:ironment)?)?\b/i);
  if (envMatch) {
    environment = envMatch[1];
    rest = (rest.slice(0, envMatch.index) + " " + rest.slice(envMatch.index + envMatch[0].length)).trim();
  }

  // What remains should be service name(s). Strip filler words ONLY when they
  // appear with whitespace boundaries — otherwise "service" inside hyphenated
  // names like "auth-service" or "seller-core-service-api" gets shredded.
  rest = rest.replace(/[`"'?!.]/g, " ");
  rest = " " + rest.replace(/\s+/g, " ").trim() + " ";
  rest = rest.replace(/\s(for|of|the|services?)(?=\s)/gi, " ");
  rest = rest.replace(/\s+and\s+/gi, " ");
  rest = rest.replace(/\s+/g, " ").trim();

  const services = rest
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (services.length === 0) return null;

  return { action, services, branch, environment };
}

module.exports = { parseWriteIntent };
