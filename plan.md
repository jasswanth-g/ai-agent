# Azure DevOps CI/CD Agent — Feature Plan

## What We Have Today

### Current Tools (11)
| Tool | Purpose |
|---|---|
| `az_resolve_service` | Maps friendly service name → build/release pipeline IDs |
| `az_list_pipelines` | List all build pipelines |
| `az_list_branches` | List branches in a repo |
| `az_list_builds` | List recent builds for a pipeline |
| `az_build_status` | Check status of a specific build |
| `az_trigger_build` | Queue a build on a branch |
| `az_list_releases` | List release definitions |
| `az_trigger_release` | Create a release |
| `az_release_status` | Check release status and stage details |
| `calculate` | Math evaluator |
| `get_current_time` | Current date/time |

---

## User Scenarios To Cover

### Category 1: Build Operations

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 1.1 | "What was the last build on pre-order-service?" | YES | `az_resolve_service` → `az_list_builds` |
| 1.2 | "Trigger a build for core-service from branch feature/xyz" | YES | `az_resolve_service` → `az_trigger_build` |
| 1.3 | "What's the status of build 12765?" | YES | `az_build_status` |
| 1.4 | "Who triggered the last build on payment-service?" | YES | `az_resolve_service` → `az_list_builds` (returns `Requested By`) |
| 1.5 | "Show me build logs for build 12765" | NO | **NEW: `az_build_logs`** |

### Category 2: Release / Deployment Operations

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 2.1 | "Create a release for pre-order-service" | YES | `az_resolve_service` → `az_trigger_release` |
| 2.2 | "What's the status of release 450?" | YES | `az_release_status` |
| 2.3 | "Deploy pre-order-service to staging" | NO | **NEW: `az_deploy_release`** (deploy to specific environment/stage) |
| 2.5 | "What's deployed on staging for core-service?" | NO | **NEW: `az_environment_status`** |
| 2.6 | "Show deployment history for pre-order-service" | NO | **NEW: `az_list_deployments`** (list past releases for a definition) |
| 2.7 | "Which services were deployed today?" | NO | **NEW: `az_recent_deployments`** (cross-service query) |

### Category 3: Branch & Repository Operations

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 3.1 | "List branches in pre-order-service repo" | YES | `az_list_branches` |
| 3.2 | "Does branch feature/marketplace exist?" | YES | `az_list_branches` (LLM can check) |
| 3.3 | "Show recent commits on branch main" | NO | **NEW: `az_list_commits`** |

### Category 4: Build & Release Together

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 4.1 | "Build and release pre-order-service from feature/xyz" | NO | **NEW: `az_build_and_release`** — composite: resolve → trigger build → poll until done → trigger release |
| 4.2 | "Deploy core-service from branch main" | NO | Same as above (user means build + release) |
| 4.3 | "Ship auth-service from hotfix/bug-123" | NO | Same — natural language variations for build + release |

**How this works end-to-end:**
```
User: "Build and release pre-order-service from feature/marketplace-v1"

Agent workflow:
1. az_resolve_service("pre-order-service") → build ID 215, release ID 216
2. Confirm with user: "I will queue build pipeline 215 from branch
   feature/marketplace-v1 and then create release from definition 216
   once the build succeeds. Proceed?"
3. az_trigger_build(pipeline_id=215, branch="feature/marketplace-v1") → build 12800
4. Poll az_build_status(build_id=12800) every few seconds until completed
5. If build succeeded → az_trigger_release(definition_id=216) → release created
6. If build failed → report failure, do NOT create release
7. Report final status: build result + release result
```

### Category 5: Commit-to-Deployment Traceability

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 4.1 | "Is my latest code from feature/xyz deployed for pre-order-service?" | NO | **NEW: `az_check_deployment_commit`** — chain: get latest commit on branch → check if the latest build includes that commit → check if that build was released |
| 4.2 | "Does the current release of core-service have the latest commit from main?" | NO | Same as above |
| 4.3 | "What commit is deployed right now for order-service?" | NO | **Needs:** `az_list_deployments` (get latest release) → build details → source commit |
| 4.4 | "Was commit abc123 included in the last build?" | NO | **NEW: `az_build_source_info`** — shows source commit, branch, and repo for a build |
| 4.5 | "Show me the difference between what's deployed and what's on main" | NO | **Needs:** `az_list_commits` + deployed commit → LLM compares |

**How this works end-to-end:**
```
User: "Is pre-order-service release up to date with main?"

Agent workflow:
1. az_resolve_service("pre-order-service") → build ID 215, release ID 216
2. az_list_commits(repo, branch="main", top=1) → latest commit SHA on main
3. az_list_builds(pipeline_id=215, top=1) → last build → source commit SHA
4. Compare: does the build's source commit match the branch's latest commit?
5. az_list_deployments(definition_id=216, top=1) → was that build actually released?
6. Report: "The latest commit on main is <sha>. The last build (ID 12765) was
   built from <sha>. That build IS/IS NOT part of the latest release."
```

### Category 6: Build Safety

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 6.1 | "Build pre-order-service from feature/xyz" (but a build is already running) | NO | **NEW: `az_check_running_builds`** — checks if a build is already in progress for that pipeline+branch before queuing a new one |
| 6.2 | "What's currently building?" / "Are there any running builds?" | NO | Same tool — list all in-progress builds across services |
| 6.3 | "Why did build 12800 fail?" / "Which step failed?" | NO | **NEW: `az_build_timeline`** — shows build stages/tasks with pass/fail status per step (quick failure summary, not full logs) |

**Duplicate build prevention workflow:**
```
User: "Build pre-order-service from feature/xyz"

Agent workflow:
1. az_resolve_service("pre-order-service") → build ID 215
2. az_check_running_builds(pipeline_id=215, branch="feature/xyz")
3. If running build found → "Build #12800 is already in progress for this
   pipeline+branch (started 2 min ago). Want to wait for it instead?"
4. If no running build → proceed with az_trigger_build
```

### Category 7: Multi-Service Batch Operations

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 7.1 | "Build and release core-service, order-service, and payment-service from main" | NO | **Prompt-level workflow** — agent loops through each service using existing tools sequentially |
| 7.2 | "What's the last build status for core-service and order-service?" | NO | **Prompt-level** — agent calls az_list_builds for each service |

**Note:** No new tool needed. The system prompt will instruct the LLM to handle multiple services by resolving and processing each one sequentially, confirming before triggering any builds/releases.

### Category 8: Service Health Dashboard

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 8.1 | "Give me status of all services" | NO | **NEW: `az_service_health`** |
| 8.2 | "How are our pipelines doing?" | NO | Same tool |
| 8.3 | "Which services had failed builds today?" | NO | Same tool with failure filter |

**How `az_service_health` works:**
```
User: "Give me status of all services"

Tool internally:
1. Read all services from SERVICE_ALIASES config (25+ entries)
2. For each service, call az pipelines runs list --pipeline-ids <buildId> --top 1
3. Aggregate into a table:

Service              | Last Build | Result    | Branch                 | By          | When
---------------------|------------|-----------|------------------------|-------------|----------------
pre-order-service    | #12765     | succeeded | feature/marketplace-v1 | Haem B.     | Apr 6, 10:42
core-service         | #12740     | succeeded | main                   | Rajesh K.   | Apr 6, 09:15
order-service        | #12738     | FAILED    | hotfix/payment-fix     | Priya S.    | Apr 5, 18:30
payment-service      | #12730     | succeeded | main                   | Haem B.     | Apr 5, 16:00
...

4. Summary line: "22 succeeded, 2 failed, 1 in progress"

Note: Makes 25+ API calls — may take 30-60 seconds. Agent will show a
"fetching status for all services..." indicator while loading.
```

### Category 9: Cross-Service Queries

| # | User Says (Example) | Covered? | Tool Needed |
|---|---|---|---|
| 9.1 | "List all my services" | PARTIAL | `az_list_pipelines` works but too verbose — **NEW: `az_list_services`** (from alias config) |

---

## Proposed New Tools

### Priority 1 — High Value, Common Use Cases

| Tool | az CLI Command | Purpose |
|---|---|---|
| `az_list_services` | _(reads from alias config)_ | List all registered services with their IDs |
| `az_check_running_builds` | `az pipelines runs list --pipeline-ids <id> --status inProgress` | Check for in-progress builds to prevent duplicates |
| `az_build_timeline` | `az pipelines build show --id <id>` (parse timeline) | Show build stages/tasks with pass/fail per step — quick failure summary |
| `az_list_deployments` | `az pipelines release list --definition-id <id>` | List past releases/deployments for a service |
| `az_service_health` | _(composite — iterates all services in alias config)_ | Dashboard: latest build status for all services in one table |
| `az_build_logs` | `az pipelines runs artifact list` / `az pipelines build logs` | View build logs |

### Priority 2 — Build & Release Together

| Tool | az CLI Command | Purpose |
|---|---|---|
| `az_build_and_release` | _(composite — trigger build → poll status → trigger release)_ | Full end-to-end: build from branch, wait for success, then create release. Fails gracefully if build fails. |

### Priority 4 — Deployment Workflow

| Tool | az CLI Command | Purpose |
|---|---|---|
| `az_deploy_release` | `az pipelines release deploy` | Deploy a release to a specific environment |
| `az_environment_status` | `az pipelines release show` (parse environments) | What's currently deployed on each stage |

### Priority 5 — Commit-to-Deployment Traceability

| Tool | az CLI Command | Purpose |
|---|---|---|
| `az_list_commits` | `az repos commit list --repository <repo> --branch <branch>` | Recent commits on a branch (returns SHA, author, message, date) |
| `az_build_source_info` | `az pipelines build show --id <id>` (parse source fields) | Get the source commit SHA, branch, and repo for a specific build |
| `az_check_deployment_commit` | _(composite — calls multiple az commands)_ | End-to-end check: is latest branch commit built AND released? Returns clear YES/NO with details |

---

## Environment Access Rules

**Allowed environments: `dev` and `test` only.**

| Rule | Behavior |
|---|---|
| User doesn't mention environment | Default to `dev` |
| User says "test" / "testing" / "QA" | Use `test` |
| User says "staging" / "prod" / "production" / "UAT" | **REJECT** — agent must refuse and explain it only has access to dev and test |

**Where this is enforced:**
1. **System prompt** — instruct the LLM to only operate on dev/test, default to dev, and refuse other environments
2. **Config** — add `ALLOWED_ENVIRONMENTS = ["dev", "test"]` and `DEFAULT_ENVIRONMENT = "dev"`
3. **Tool-level** — `az_deploy_release`, `az_build_and_release`, and `az_trigger_release` must validate the environment before executing. If an invalid environment is passed, return an error string instead of executing.

---

## System Prompt Enhancements

1. **Workflow chains** — teach the LLM multi-step workflows:
   - "Deploy to staging" → resolve → trigger release → check release status
   - "Build and release from branch" → resolve → confirm with user → trigger build → poll status → if succeeded, trigger release → report final status
   - "Is my code deployed?" → use `az_check_deployment_commit` with service name and branch, OR manually chain: resolve → list commits (top=1) → list builds (top=1) → compare source commits → check if build is released

2. **Smart responses** — guide the LLM to:
   - Summarize build results concisely (not dump raw data)
   - Proactively mention who triggered, how long it took, which branch
   - Suggest next actions (e.g., after build succeeds → "Want me to create a release?")

3. **Error guidance** — teach the LLM to:
   - Suggest `az login` when auth fails
   - Suggest checking branch name when build fails with "branch not found"

---

## Security Fixes

| Issue | Fix |
|---|---|
| PAT hardcoded in config/index.js | Remove hardcoded value, read ONLY from env var |
| PAT could leak in error messages | Mask token patterns in shell.js error output |

---

## Implementation Order

**Phase 1 — Quick Wins & Safety**
1. Security fix: remove hardcoded PAT
2. Add environment config (`ALLOWED_ENVIRONMENTS`, `DEFAULT_ENVIRONMENT`) to config
3. `az_list_services` (reads alias config, no CLI call)
4. `az_check_running_builds` (duplicate build prevention)
5. `az_build_timeline` (quick failure summary per step)
6. Updated system prompt with workflow chains + environment rules + duplicate prevention

**Phase 2 — Build & Release Together**
7. `az_build_and_release` (composite: check duplicates → build → poll → release)
8. System prompt: add build-and-release workflow chain + multi-service handling

**Phase 3 — Deployment Workflow**
9. `az_list_deployments`
10. `az_deploy_release`
11. `az_environment_status`

**Phase 4 — Commit-to-Deployment Traceability**
12. `az_list_commits`
13. `az_build_source_info`
14. `az_check_deployment_commit` (composite tool)
15. System prompt: add traceability workflow chain

**Phase 5 — Dashboard & Extras**
16. `az_service_health` (all-services dashboard)
17. `az_build_logs`
