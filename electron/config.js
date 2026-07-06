/**
 * Reads/writes the same Configstore the server uses ("aiagent"), so the org /
 * project / services URL a user enters in the first-run setup window is exactly
 * what src/web/server.js picks up when it starts.
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
    servicesUrl: s.get("servicesUrl") || "",
  };
}

function saveOrgProject(org, project, servicesUrl) {
  const s = store();
  s.set("azureDevOpsOrg", org);
  s.set("azureDevOpsProject", project);
  s.set("servicesUrl", servicesUrl || "");
}

module.exports = { readOrgProject, saveOrgProject };
