/**
 * Reads/writes the same Configstore the server + CLI use ("aiagent"), so the
 * org/project a user enters in the first-run setup window is exactly what
 * src/web/server.js picks up when it starts.
 */
const Configstore = require("configstore");

function store() {
  return new Configstore("aiagent");
}

function readOrgProject() {
  const s = store();
  return {
    org: s.get("azureDevOpsOrg") || "",
    project: s.get("azureDevOpsProject") || "",
  };
}

function saveOrgProject(org, project) {
  const s = store();
  s.set("azureDevOpsOrg", org);
  s.set("azureDevOpsProject", project);
}

module.exports = { readOrgProject, saveOrgProject };
