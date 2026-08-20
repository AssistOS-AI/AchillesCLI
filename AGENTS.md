# Scope

These instructions apply to the AchillesCLI repository. The runnable Ploinky agent lives under `achilles-cli/`; sibling agent directories provide optional task workers and their manifests.

# Mandatory Reading Order

1. Read `README.md` and `achilles-cli/docs/index.html` for the user and system overview.
2. Read `achilles-cli/docs/wiki.html` for canonical project terminology.
3. Read `achilles-cli/docs/specs/matrix.md`, the relevant DS files, and `achilles-cli/docs/specs/DS001-coding-style.md` for coding style, source layout, and test organization.
4. Read `achilles-cli/src/cli.mjs`, `achilles-cli/src/index.mjs`, and the relevant implementation and tests before changing behavior.

The DS specifications are the source of truth for project requirements and boundaries.

# Current Skill Catalog

AchillesCLI distributes built-in skill descriptors under `achilles-cli/src/skills/`. The catalog covers skill CRUD, schema validation, template retrieval, code generation, preview, execution, test generation and execution, iterative refinement, specification access, AKU memory support, Bash execution, orchestration, and launchers for Codex, OpenCode, PI, GPTResearcher, Open Interpreter, and web search.

Update this section, `achilles-cli/docs/index.html`, `achilles-cli/docs/skills.html`, `achilles-cli/docs/wiki.html`, and the relevant specifications whenever the distributed product skill catalog changes. Internal documentation-authoring tools are not product skills and must not appear in persistent project documentation.

# Repository Rules

- Write documentation, specifications, and comments in English.
- Keep ES modules in `.mjs` files, use four-space indentation, and route all LLM interactions through AchillesAgentLib `LLMAgent` configured by runtime configuration and environment variables.
- AchillesAgentLib is an authorized core dependency. Resolve it through the Ploinky runtime or the repository's supported runtime mounts; do not add direct vendor model HTTP calls.
- Keep `AchillesBroker` outside Bubblewrap as the authority for Bash approval state. Run Bash only through `LocalBashExecutor` inside the MainAgent sandbox.
- Apply task metadata tags when routing-sensitive work distinguishes documentation, specifications, orchestration, bootstrap, or testing.
- Keep DS numbering contiguous. Exactly one `achilles-cli/docs/specs/DS003-main-behavior.md` records the defining product behaviors.
- Re-evaluate the accepted main behaviors before changing `DS003-main-behavior.md` or after changes to essential workflows, public interfaces, architectural boundaries, or product direction.
- Put rationale, limitations, assumptions, alternatives, and unresolved contract boundaries in declarative prose under `Core Content`; do not create a separate decision log.
- When source behavior changes, update both the HTML documentation and the relevant DS files in the same change.
- Imported skills in downstream projects remain documented inside their own skill folders. A consuming project's `docs/` tree must describe the host project, not copied skill internals.
- Preserve the documentation structure, canonical wiki links, submenu navigation, unwrapped source prose, and declarative DS contracts established under `achilles-cli/docs/`.

# Runtime Defaults

The CLI uses the invocation directory unless `--dir` selects another workspace. Bash permission mode defaults to `ask-for-approval`; `full-access` removes prompts but remains inside the same filesystem sandbox. Model invocation uses AchillesAgentLib `LLMAgent` and the configured Soul Gateway model or tier. Runtime code may provide explicit manual configuration overrides in addition to environment-derived defaults.

# Key Paths

- `achilles-cli/docs/index.html` — documentation entry point.
- `achilles-cli/docs/usage.html` — installation, configuration, and command workflows.
- `achilles-cli/docs/architecture.html` — runtime and security boundaries.
- `achilles-cli/docs/skills.html` — distributed built-in skill catalog.
- `achilles-cli/docs/wiki.html` — canonical terminology.
- `achilles-cli/docs/specs/` — authoritative design specifications.
- `achilles-cli/docs/specs/DS001-coding-style.md` — coding and test conventions.
- `achilles-cli/src/cli.mjs` — trusted Broker entry point.
- `achilles-cli/src/index.mjs` — sandboxed agent entry point.
- `achilles-cli/src/skills/` — built-in product skills.
- `tests/` and `achilles-cli/tests/` — integration and package-local tests.
