# Antigravity Agent Handoff Guide

Welcome to this repository! This project is developed and maintained alongside Google DeepMind's Antigravity agent system. 

To ensure a seamless handoff and continuation of work by any AI or IDE, please familiarize yourself with the Antigravity "secret sauce"—its file-based memory and artifact structure. On this system, the Application Data Directory is located at:

**`~/.gemini/antigravity`** (specifically `/Users/rahulrathee/.gemini/antigravity`)

## 🧠 The "Brain" and Memory System

Antigravity preserves state, knowledge, and planning across sessions using persistent directories. You should reference these structures whenever you need to understand past context, previous approaches, or the state of incomplete work.

### 1. Knowledge Items (KIs)
**Location:** `<appDataDir>/knowledge/`

Before starting new work, checking KIs is the primary method for context retrieval. These contain curated, localized knowledge about established patterns in this repository.
- **`metadata.json`**: Summaries, timestamps, and references to original conversation sources.
- **`artifacts/`**: Related code snippets, documentation, and specific implementation templates.

*Rule of thumb:* Always check KIs first to avoid reinventing the wheel (e.g., figuring out how a specific API handles errors here), but verify against active code since KIs can become stale.

### 2. Conversation Logs
**Location:** `<appDataDir>/brain/<conversation-id>/.system_generated/logs/`

Raw logs and full conversation transcripts from past interactions.
- **`overview.txt`**: A full transcript detailing every tool call and model/user turn. Refer to these logs if a KI is insufficient or if the user explicitly references a past interaction you need raw details on.

### 3. Scratch Space
**Location:** `<appDataDir>/brain/<conversation-id>/scratch/`

Used for temporary resources such as one-off python debugging scripts, generated test JSONs, or API test suites.

## 📝 Planning and Execution Artifacts

When executing complex tasks (e.g., major architecture changes, building integrations), the agent operates in **Planning Mode** and creates/updates specific markdown artifacts stored in the active conversation directory (`<appDataDir>/brain/<conversation-id>/`). 

### Implementation Plans
**File:** `<appDataDir>/brain/<conversation-id>/implementation_plan.md`
- **Purpose:** A detailed design document presenting the proposed technical plan. It details new files, modified files, and what will be deleted, often calling out breaking decisions using GitHub alerts (e.g., `> [!WARNING]`).
- **Usage:** Read this to understand the architectural goal of the current session before writing any code.

### Task Tracking
**File:** `<appDataDir>/brain/<conversation-id>/task.md`
- **Purpose:** A living TODO list and checklist used during execution to break down work sequentially.
- **Format:** `[ ]` (Uncompleted), `[/]` (In Progress), `[x]` (Completed).
- **Usage:** Use this to resume a partially completed task precisely where the last agent left off.

### Walkthroughs
**File:** `<appDataDir>/brain/<conversation-id>/walkthrough.md`
- **Purpose:** A summary of completed work, including what was changed, tested, and validated. Often contains embedded diffs (`render_diffs()`) and media.

## Workflow for New Agents / IDEs:
1. **Identify the Session:** Find the current or most relevant `<conversation-id>` folder in the `brain` directory.
2. **Absorb Context:** Read through `knowledge/` first. If mid-task, read `implementation_plan.md` and `task.md`.
3. **Execute & Update:** Pick up the unfinished items in `task.md`, make code changes, and keep the artifacts updated to maintain the chain of memory for the next agent.

## 🛡️ Security & Secrets (MANDATORY)

- **NEVER use `git add .`**: Always run `git status` and specifically add files you have intentionally modified. Broad `add` commands risk staging untracked scratch files containing hardcoded secrets.
- **Respect `.gitignore`**: Ensure `scratch/`, `.env.local`, and any data directories are never tracked.
- **No Hardcoded Keys**: If testing, always load from `process.env` or `.env.local`. Do not paste raw keys into scripts, even in `scratch/`.
- **Double-Check Before Push**: Verify the list of staged files before committing and pushing.
