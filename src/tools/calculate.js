function calculate(expression) {
  const allowed = /^[0-9+\-*/.() ]+$/;
  if (!allowed.test(expression)) {
    return "Error: only numeric math expressions are allowed.";
  }
  try {
    return String(Function(`"use strict"; return (${expression})`)());
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = {
  name: "calculate",
  input_schema: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression to evaluate" },
    },
    required: ["expression"],
  },
  description: "Evaluate a math expression.",
  fn: ({ expression }) => calculate(expression),
};
