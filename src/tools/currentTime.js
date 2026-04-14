function getCurrentTime() {
  return new Date().toLocaleString();
}

module.exports = {
  name: "get_current_time",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
  description: "Get the current date and time.",
  fn: () => getCurrentTime(),
};
