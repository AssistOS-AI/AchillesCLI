# Workflow graph implementation plan

Status: implemented in the workspace on 2026-09-22. DS007 now defines the graph model. RoboTeam uses SQLite, and the linked AdvancedLanguageAgent checkout supplies separate caller system instructions. Activation requires restarting RoboTeam; startup removes legacy workflow definitions as agreed.

The requested behavior takes precedence over the existing workflow design in AGENTS.md and DS007. Implementation must update those contracts together with the code. Documentation is in English as required by AGENTS.md.

## Findings from the current implementation

- `roboTeamAgent/server/roboflow/workflow-registry.mjs` validates robot members and a decision member and stores workflow definitions as JSON.
- `server/roboflow/roboflow-service.mjs` starts a decision robot repeatedly and exposes member launch and finish operations. This execution loop must be replaced.
- `server/roboflow/task-flow-store.mjs` stores flow JSON, event files and copied logs under the RoboFlow data directory. Runtime task history also has project storage. The new flow metadata belongs in SQLite; task output belongs in the execution working folder.
- `public/app.js` contains the member editor and limits skillset choices to the selected robot. `public/roboflow.js` renders decision steps and member runs.
- `server/runtime-manager.mjs` already allows concurrent terminal tasks and serializes Desktop and Browser through one GUI queue per robot. Reuse this behavior.
- `server/repository-client.mjs` loads Ploinky's repository client. Discovery must use this active connection, not a hardcoded repository list.
- `copilot/src/lib/robotSkillCatalog.mjs` reads the workflow registry directly. `copilot/src/lib/alaEngine.mjs` adds the default robot's instruction to only choose and start workflows. Both paths need adaptation, including caller-supplied system prompts for normal invocation, graph generation and workflow task execution. The robot itself must not choose a hardcoded system prompt based on its name.
- The current RoboFlow decision prompt is passed as task text. The requested system instructions need an explicit path through RuntimeManager, the task wrapper and the ALA adapter.

## Target contract

A workflow type is a reusable directed graph, global within the RoboTeam instance. Tasks are its nodes; edges are possible transitions. A run follows one path at a time. An edge does not launch a parallel branch.

Each ordinary editable task has `name`, `description`, `skillsets` and `executionType`, one of `terminal`, `desktop`, or `browser`. Internal task IDs remain stable when names change. There are no robot selectors, members, roles or decision-member fields in ordinary graph definitions. The built-in `default` workflow has the explicit execution exception specified below.

Proposed graph representation:

```json
{
  "schemaVersion": 2,
  "id": "review-workflow",
  "revision": 1,
  "name": "Review workflow",
  "description": "Review a change and revise it when needed",
  "entryTaskId": "review",
  "tasks": [
    {
      "id": "review",
      "name": "Review change",
      "description": "Review the requested change and decide whether it needs revision.",
      "skillsets": ["repository-id/review-set"],
      "executionType": "terminal"
    },
    {
      "id": "revise",
      "name": "Revise change",
      "description": "Apply the requested revisions.",
      "skillsets": ["repository-id/edit-set"],
      "executionType": "terminal"
    },
    {
      "id": "finish",
      "name": "Report result",
      "description": "Report the accepted result to the user.",
      "skillsets": [],
      "executionType": "terminal"
    }
  ],
  "edges": [
    { "id": "needs-revision", "sourceTaskId": "review", "targetTaskId": "revise" },
    { "id": "accepted", "sourceTaskId": "review", "targetTaskId": "finish" },
    { "id": "review-again", "sourceTaskId": "revise", "targetTaskId": "review" }
  ],
  "layout": {
    "review": { "x": 100, "y": 100 },
    "revise": { "x": 400, "y": 40 },
    "finish": { "x": 400, "y": 220 }
  }
}
```

Edges contain only identity and directed endpoints; they have no description or condition field. Task descriptions explain the work at each node. Every task invocation receives the complete execution graph, including task descriptions, and its current node ID. Branching decisions use that context.

The example skillset IDs illustrate qualification. Implementation must reuse or extend the existing catalog identity rules to identify the same repository and skillset across discovery and robot catalogs. Display names alone are insufficient. Robot-specific registration generations must not become global skillset identities.

Validate unique task and edge IDs, a valid entry task, valid edge endpoints, field types, execution types and bounded input sizes. Cycles are allowed. Report unreachable nodes during editing. Missing robot coverage is a warning and must not block saving or starting an otherwise valid graph.

## Skillset discovery and robot matching

Add a server catalog operation that aggregates named skillsets from every skill repository discovered through the current Ploinky endpoint. Reuse repository discovery and the `skillsets.md` parser. Include repository identity and skillset descriptions for the picker and generator. Repositories that cannot be read must produce visible diagnostics; do not silently substitute the selected robot's catalog.

Implement one shared matching function for the editor, workflow list and executor:

```text
matches(robot, task) = every required skillset exists and is enabled
                      in that same robot's registered catalog
```

A robot may have additional skillsets. Combining partial coverage from several robots does not satisfy a task. Pass only the task's selected skillsets into its runtime skill policy. An empty selection imposes no skillset requirement and mounts no optional skillsets by default.

The server validates coverage after each selection change in an unsaved draft. Return task IDs without coverage and matching robot IDs per task. The browser discards stale responses when a later edit has already been made.

Show this exact warning for an uncovered task:

> No robot has these matching skillsets, add or edit a robot to ensure the workflow runs correctly

After Save, the workflow list shows a yellow warning symbol with accessible explanatory text whenever any task lacks coverage. Compute this at response time or keep an invalidated memory cache. Never persist warning flags in the workflow or SQLite tables.

After robot creation, editing, deletion, repository changes or skillset enable/disable, recompute coverage for all workflows on the server. Refresh the UI after its own mutations and provide a refresh mechanism for changes made in another client. Recalculate before dispatch as well; earlier coverage does not reserve a robot.

Keep coverage separate from temporary resource availability. A busy GUI does not mean missing skillsets. Execution-mode/backend incompatibility should have a distinct diagnostic rather than the missing-skillsets warning.

## Graph generation and editing

The first control in the workflow editor is a text input describing the desired workflow, followed by Generate. Manual creation remains available for refinement or starting from scratch.

Add an asynchronous MCP operation, proposed name `roboflow_generate_workflow`. The UI invokes it through the existing authenticated Ploinky Router/MCP path. Follow the native task contract for progress, cancellation and final output. Do not expose the service's internal token to browser code.

The operation starts robot `default` in terminal mode and supplies the generation system prompt as an invocation argument. Its system instructions contain the graph schema, discovered skillset IDs and descriptions, permitted execution types, edge semantics, entry-node requirements and a small valid example. The user description is supplied as user input. Normal AchillesCLI invocation supplies its own system prompt; generation supplies a different one. Remove implicit prompt injection based on the robot name. Carry the caller-supplied system prompt through every execution adapter without adding the normal workflow-launch instruction to generation or worker calls.

The generator returns JSON for a graph draft. The server extracts and validates the result before returning it to the browser. Reject invented catalog identities, broken endpoints or invalid task fields with useful diagnostics. A valid graph without matching robots is accepted with coverage warnings. A failed generation preserves the current draft.

Populate the task list and board from one shared draft model. Assign automatic positions if the generated layout is absent. Every new task immediately creates a board node. Renaming updates its visible label. Deleting a task removes its incident edges and requires another entry selection if it was the entry task.

The board supports dragging nodes, drawing directed connections, selecting and deleting edges, editing task descriptions, and choosing the entry task. Show task names at readable size and arrow direction. Edge selection can show the edge ID; there is no edge-description editor. Save persists the graph and node positions together. Reopening restores both.

Use the existing dashboard style and theme tokens. Provide keyboard controls for equivalent task and connection edits. Split the editor, graph state and board rendering into modules instead of adding more workflow code to `public/app.js`.

Protect an edited draft from an older generation response. Generation replaces the draft only for the current request and with an explicit UI action if edits were made while it ran. Saving uses the expected revision to detect concurrent edits.

## SQLite and execution records

Use one database under the global RoboTeam data root, proposed path `/data/roboflow/roboflow.sqlite`. Resolve it through existing data-root configuration. Workflow CRUD and listing must not require a project folder.

Proposed tables:

| Table | Content |
| --- | --- |
| `workflow_types` | Stable ID, name, description, current validated graph and layout JSON, edit revision counter, built-in kind and timestamps |
| `workflow_runs` | Run ID, source workflow ID, immutable graph snapshot captured at Start, objective, cwd, status, current task instance, selected mode for default and timestamps |
| `task_instances` | Instance ID, run ID, sequence, graph node ID, selected robot, execution mode, runtime task ID, state, selected edge, timestamps, error code and final-response/log references |

Store only the current workflow definition and board layout in `workflow_types`. Each Save updates that row; there is no saved-version history table. The edit revision counter only detects concurrent saves. At Start, read the current definition and create a `workflow_runs` row containing an immutable graph snapshot in one transaction. This snapshot preserves the graph used by that execution. Use exactly these three application tables, with no migration-history table. Keep run metadata compact. Task output, full prompts, results and log streams remain in the working folder; SQLite stores references and lifecycle/routing facts. Warning state is never a column.

Every visit creates a distinct backend task instance with a fresh runtime task ID and a fresh visit row, including revisits in `A -> B -> A`. The stable graph node ID identifies the task definition only. Never resume or reuse the previous A task instance when traversing back to A. A run executes its own graph snapshot, so editing or deleting the source workflow does not alter its graph or destroy its history. Deleting a workflow must not cascade to its runs. Retain the source workflow ID as historical metadata without a required foreign key to a live workflow row; enforce the run-to-task-instance relationship with a foreign key.

Reuse the existing `.achilles-cli/tasks/` output where possible. Any additional per-visit output goes under the execution folder's `.achilles-cli/roboflow/<runId>/`. Global listing still works when that folder is unavailable; log retrieval then returns a clear unavailable response.

Use transactions for workflow saves, run snapshot creation and execution transitions. Create the three tables and required indexes at initialization if absent; do not add a schema migration subsystem. Verify SQLite driver support in the actual RoboTeam runtime image before selecting the driver. Keep that choice behind a storage adapter and test it in deployment packaging.

## Execution and resource selection

At start, copy the current saved graph into the run snapshot, capture the objective and execution cwd, then dispatch `entryTaskId` from that snapshot. The cwd belongs to the run, not the workflow definition. Each task receives its description, the run objective, the complete captured graph and its current graph node ID. The only context passed from prior task executions is their final response text, whether plain text, structured Markdown or the accepted JSON alternative. Preserve final responses as returned, including routing fields; do not replace them with extracted messages or generated summaries. Never attach files, artifact references, logs, tool output, intermediate progress or full transcripts as predecessor context. Keep final responses in traversal order, associated with their task-instance and graph-node IDs, so repeated visits remain distinguishable. The first task has no predecessor response. If this context exceeds the supported input limit, report the limit explicitly instead of silently summarizing or truncating it.

For ordinary workflows, at every visit, resolve matching robots from their current catalogs. Select one uniformly at random from the matching robots that can execute the requested mode and are currently available. Inject randomness in tests.

For terminal mode, other tasks on the robot do not make it unavailable. For Desktop/Browser, select an idle eligible robot when possible. If eligible robots exist but all GUI slots are occupied, select one at random and enqueue through its existing shared Desktop/Browser FIFO queue. Record `queued` and do not advance the workflow until that task completes. Recheck eligibility at dequeue because catalog configuration may have changed while waiting.

If no matching robot exists when the task is reached, fail the workflow with the task ID and a clear reason. A warning elsewhere in the graph does not block Start or preempt execution before that task is reached. If matching robots cannot support the execution mode, fail with that separate reason. Runtime failure, cancellation and interruption must not trigger a normal outgoing transition.

After successful completion, use the outgoing edges of the current node in the run's captured graph:

| Outgoing edges | Task prompt and transition |
| --- | --- |
| 0 | No graph-routing system prompt and no edge parser requirement. Complete the workflow. |
| 1 | No graph-routing system prompt and no edge parser requirement. Follow the single edge automatically. |
| 2 or more | Inject the graph-routing system prompt. Parse and validate the selected edge, then follow exactly that edge. |

Zero or one outgoing edge means no additional workflow routing system instruction. The complete graph and current node ID are still included as task context, along with final-response history. Any ordinary system instructions come from the caller; the robot has no hardcoded system prompt. Do not infer a route from task names, response prose or an edge that belongs to a different source node.

For branching nodes, the system prompt states that the robot executes a task within a graph, supplies the execution graph and current task ID, lists allowed outgoing edge IDs and their destination task IDs, and requires one final route selection. Pass these instructions through an explicit system-instruction mechanism, not as a user-text prefix. Verify propagation through terminal and GUI execution adapters.

The default robot can execute an ordinary workflow task too if selected by matching. The caller supplies its task instructions; robot identity never injects the front copilot workflow-launch-only restriction. This applies regardless of outgoing edge count.

## Special default workflow

The built-in `default` workflow is a graph with exactly one node, `entryTaskId` pointing to that node, and no edges. That node supports all three execution modes: `terminal`, `desktop` and `browser`. One mode is chosen per run; the modes do not execute simultaneously.

Execution is hardcoded to robot `default`, bypassing random robot selection. Another matching robot must never substitute for it. If robot `default` is unavailable or cannot support the selected mode, fail with a clear reason. If its GUI resource is merely busy, queue the task normally. Terminal execution keeps normal concurrency.

Represent this as a reserved built-in workflow kind with `supportedExecutionTypes` on its sole node. Ordinary editable nodes retain exactly one `executionType`. Users and the graph generator cannot create another workflow with this exception or introduce robot assignments into ordinary graphs. Any skillset coverage check for the built-in workflow is against its fixed robot only.

When AchillesCLI chooses `default`, it must also choose and send the run's `executionType`, one of `terminal`, `desktop` or `browser`. Extend the start HTTP/MCP schema and the `launch-workflow` invocation contract accordingly. Require this argument for `default`. Reject execution-type overrides for every other workflow, whose task definitions own execution modes. Record the selected mode in the default run and its backend task instance.

Update the normal caller-supplied AchillesCLI system prompt and workflow catalog so this exception is explicit: choose a workflow and, only for `default`, choose its execution mode. The single default node receives the objective, graph and current node ID and returns ordinary final text without a route-selection requirement.

## Tolerant result parser

Preferred branching response:

```markdown
# message
The change needs another revision.

# nextEdgeId
needs-revision
```

Also accept JSON, including a fenced JSON object:

```json
{ "message": "The change needs another revision.", "nextEdgeId": "needs-revision" }
```

Accept `nextEdgeId`, `nextEdge` and `Edge` case-insensitively in Markdown headings and JSON keys. Tolerate heading whitespace, optional space after `#`, newline conventions and fenced scalar values. `message` is optional. The canonical result is an optional message and one edge ID.

Parse the complete final task output, not intermediate progress or a truncated summary. Tolerance applies to formatting, not graph authority. Missing, conflicting or unknown edge selections fail a branching visit with an actionable diagnostic. Repeated aliases with the same value can normalize to one selection; conflicting values must fail. Do not silently pick the first edge or launch an extra decision robot.

The selected edge must exist and have `sourceTaskId` equal to the current task ID. Given `A -> B` and `B -> C`, B cannot return to A unless `B -> A` exists explicitly.

Serialize transitions per run and handle repeated runtime completion notifications idempotently. Commit the completed visit and next pending visit together before dispatching the next task. Preserve the current conservative restart policy: mark unfinished runs failed and active visits interrupted after a service restart; do not replay tasks that may already have produced side effects. Cover the crash window between preparing a visit and recording its runtime task ID.

## Delivery order and code boundaries

1. Define graph validation, stable skillset identities, coverage results and fixtures. Add focused modules under `server/roboflow/` for graph schema, matching, branching prompts and result parsing.
2. Introduce the SQLite adapter and the three stores for current workflow definitions, runs with graph snapshots, and task instances. Delete persisted old workflow definitions during cutover instead of importing or converting them, then initialize the new built-in default graph. Adapt `workflow-registry.mjs`, `task-flow-store.mjs`, startup and the copilot's direct registry reader.
3. Replace the decision loop with graph traversal, random robot selection and the existing runtime queues. Add caller-supplied system-instruction propagation through the wrapper and ALA adapter, final-response-only predecessor context, and a fresh backend task instance per visit. Implement the fixed-robot, per-run execution-mode exception for `default`.
4. Add global skillset discovery, draft coverage validation and server recomputation hooks for robot/catalog mutations. Update HTTP and MCP graph schemas, workflow CRUD, run state, stop and log access.
5. Add the MCP graph generator and its dedicated default-terminal context. Validate its output with the same graph validator used by Save.
6. Replace the member editor in `public/app.js` and `public/index.html` with the generator, task form and drawing board. Update workflow cards and robot-save refresh behavior.
7. Replace decision-step monitoring in `public/roboflow.js` with the run graph, visited path, repeated visits, task states, selected robot and project log links. Unvisited nodes stay visibly unvisited.
8. Remove obsolete `roboflow_launch_robot` and `roboflow_finish_flow` execution capabilities and decision MCP injection. Update `tools/roboflow.mjs`, `mcp-config.json`, workflow catalog formatting and `launch-workflow` skill text. Retain list/start/state/stop using the new model. Require execution-mode selection when starting `default` and reject it for ordinary workflows.
9. Update README, AGENTS.md, DS007, affected DS004/DS005/DS006 contracts, the specification matrix and HTML documentation. Reassess main behaviors before updating DS003 as required by repository guidance. Verify the UI, runtime and deployment package together.

## Existing data and cutover

Existing workflow definitions are to be deleted from persistence. Do not migrate, import, archive or generate conversion drafts for them. This is an explicit user decision. Initialize SQLite for the new graph model and create the special built-in `default` graph after removing the old definitions.

Implement idempotent cutover cleanup targeting only the old workflow storage paths. After those old files have been removed, rerunning cleanup is a no-op. Subsequent startups must preserve new graph workflows. Stop or settle active old executions before removing their definitions. Scope cleanup to old workflow persistence; deleting unrelated robot data or project task logs is outside this reset. There is no legacy-workflow compatibility UI or execution path.

## Confirmed decisions and remaining implementation defaults

- Use one explicit `entryTaskId`, chosen by the generator or editor.
- Permit explicit cycles. Every traversal creates a new backend task instance, even when the graph node was visited before.
- Keep a graph snapshot in each run so edits do not alter running executions; workflow definitions keep only their current saved state. Mark unfinished runs failed and active tasks interrupted after a service restart, without automatic replay.
- Use only final task responses as predecessor context, plus the graph and current node as described above.
- Use the special single-node default workflow with fixed robot `default` and execution mode selected by AchillesCLI per call.
- Save structurally valid graphs with coverage warnings. Missing coverage fails execution only when the affected node is reached.

Remaining implementation defaults: retain current administrator requirements for workflow mutations and generation; retain a configurable visit cap, initially 500; keep incomplete drafts in the editor until structural validation passes. Use the supplied working folder for generation logs, or a managed scratch folder when none is supplied. That folder does not become the workflow's scope.

## Acceptance and verification

| Scenario | Expected result |
| --- | --- |
| Generate from a description | Real authenticated MCP request starts default in terminal mode and returns a validated draft that populates tasks and board |
| Add, rename, move or delete a task | Task list and board stay synchronized; incident edges are handled; Save/reopen preserves layout |
| Discover skills | All discovered repositories from the active Ploinky connection are represented, independently of selected robots |
| Robot X has S1 and robot Y has S2, task needs both | Coverage warning; the two robots cannot jointly satisfy one task |
| Robot Z has S1, S2 and S3, task needs S1 and S2 | Coverage succeeds; execution mounts the selected sets |
| Edit a draft's skillsets | Server returns fresh coverage after every change; stale responses cannot overwrite newer results |
| Save uncovered workflow, then add matching robot | Save succeeds; yellow warning appears, then clears after server recomputation without rewriting the workflow |
| Remove or disable a required skillset | Coverage updates across saved workflows; dispatch uses current matching |
| Workflow has an uncovered task on an unchosen branch | Start is allowed; execution fails only if it reaches a task without an eligible robot |
| Several matching idle robots | Selection uses injected randomness from the eligible set and is not permanently bound to one robot |
| GUI busy versus terminal execution | GUI task queues; terminal tasks still start concurrently; separate robots retain separate GUI queues |
| Zero or one outgoing edge | No routing system prompt is sent; ordinary output completes or advances automatically |
| Branch with Markdown or JSON output | Supported aliases route correctly; missing message is accepted |
| Branch selects an incoming, nonexistent or another node's edge | Flow fails and no unauthorized next task starts |
| Revisit a node through an explicit cycle | A fresh backend task instance and runtime task ID are created; previous instances and visit history remain distinct |
| Duplicate completion, stop race or service restart | No duplicate successor launch; stopped runs do not advance; unfinished runs recover as failed |
| Edit/delete a workflow during an existing run | Its captured graph and historical records remain available |
| Open another working folder | Same global workflow list; each run's logs remain in its own execution folder |
| Old workflow storage cutover reruns | Old definitions are deleted without conversion; new SQLite workflows survive subsequent startups |
| Caller invokes the same default robot for normal use and generation | Each call receives its supplied system prompt; no robot-name-based hardcoded prompt is injected |
| Graph supplied to any task | Complete node descriptions, edges and current node ID are present; edges have no descriptions |
| Task follows a previous execution | Only final response text is forwarded as predecessor context, never files, references, logs or intermediate output |
| AchillesCLI starts default in each supported mode | One task runs on robot default in the selected mode; no random substitute and no routing prompt |
| Default GUI is busy | The fixed default robot's task queues; it is not reassigned |
| AchillesCLI starts ordinary workflow with execution-mode override | Server rejects the override; execution modes belong to graph nodes |
| Default start omits execution mode | Validation requires terminal, desktop or browser |

Extend `roboTeamAgent/tests/roboflow-service.test.mjs` and `roboflow-http.test.mjs`; add focused schema, SQLite, parser, matching and generator tests. Update relevant runtime, robot-skillset, ALA adapter, MCP policy and copilot workflow tests. Add browser interaction coverage for board synchronization, generation and warning refresh. Verify default-mode selection in the AchillesCLI launch contract and prompt propagation without robot-name-based injection. Test storage with temporary roots and runtime behavior with fake robots and injected randomness.

After targeted checks, run the repository's required suites, documentation checks and a deployment smoke test for SQLite availability, real MCP generation, one terminal branch and a queued GUI task. Verify one real branching task per supported execution mode receives the system instructions and returns a result the parser can consume.
