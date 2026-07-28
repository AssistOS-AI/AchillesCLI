/**
 * HelpSystem - Comprehensive, topic-based help system for the achilles-cli CLI.
 *
 * Provides contextual help with topics, examples, and detailed explanations.
 */

import { colors as baseColors } from './themes/base.mjs';

// Use theme colors (aliased to C for brevity in content strings)
const C = {
    reset: baseColors.reset,
    bold: baseColors.bold,
    dim: baseColors.dim,
    cyan: baseColors.cyan,
    yellow: baseColors.yellow,
    green: baseColors.green,
    blue: baseColors.blue,
    magenta: baseColors.magenta,
    white: baseColors.white,
    red: baseColors.red,
};

/**
 * Help topics with their content
 */
const HELP_TOPICS = {
    // Main overview
    overview: {
        title: 'Achilles CLI Overview',
        aliases: ['intro', 'about', 'main'],
        content: `
${C.bold}${C.cyan}What is Achilles CLI?${C.reset}

Achilles CLI is a CLI tool for creating, managing, and testing skill definition
files in skills directories. It supports both interactive REPL mode and
single-shot command execution.

${C.bold}${C.yellow}Key Features:${C.reset}
  ${C.green}•${C.reset} Create and edit skill definitions using natural language or commands
  ${C.green}•${C.reset} Validate skills against their type schemas
  ${C.green}•${C.reset} Generate executable code from tskill definitions
  ${C.green}•${C.reset} Run tests and iteratively refine skills
  ${C.green}•${C.reset} Interactive pickers for skills and tests

${C.bold}${C.yellow}Two Ways to Interact:${C.reset}
  ${C.cyan}1. Natural Language${C.reset} - Just describe what you want
     Example: "read the equipment skill"

  ${C.cyan}2. Slash Commands${C.reset} - Direct, fast command execution
     Example: /read equipment

${C.dim}Type /help topics to see all available help topics.${C.reset}
`,
    },

    // Getting started guide
    'getting-started': {
        title: 'Getting Started',
        aliases: ['start', 'begin', 'tutorial', 'quickstart'],
        content: `
${C.bold}${C.cyan}Getting Started with Achilles CLI${C.reset}

${C.bold}${C.yellow}Step 1: List Your Skills${C.reset}
  ${C.dim}See what skills exist in your project:${C.reset}
  ${C.green}>${C.reset} list          ${C.dim}or${C.reset}  ${C.green}>${C.reset} /ls

${C.bold}${C.yellow}Step 2: Read a Skill${C.reset}
  ${C.dim}View the definition of any skill:${C.reset}
  ${C.green}>${C.reset} /read equipment
  ${C.green}>${C.reset} "show me the area skill"

${C.bold}${C.yellow}Step 3: Create a New Skill${C.reset}
  ${C.dim}Create a new skill with a template:${C.reset}
  ${C.green}>${C.reset} /write my-skill tskill
  ${C.green}>${C.reset} "create a new cskill called data-processor"

${C.bold}${C.yellow}Step 4: Generate Code (for tskills)${C.reset}
  ${C.dim}Generate executable .mjs code from your tskill:${C.reset}
  ${C.green}>${C.reset} /generate my-skill

${C.bold}${C.yellow}Step 5: Test Your Skill${C.reset}
  ${C.dim}Run tests to verify the generated code:${C.reset}
  ${C.green}>${C.reset} /test my-skill

${C.bold}${C.yellow}Step 6: Refine Until Tests Pass${C.reset}
  ${C.dim}Automatically improve the skill until all tests pass:${C.reset}
  ${C.green}>${C.reset} /refine my-skill

${C.dim}Type /help commands for the full command reference.${C.reset}
`,
    },

    // Commands reference
    commands: {
        title: 'Command Reference',
        aliases: ['cmd', 'cmds', 'reference', 'ref'],
        content: `
${C.bold}${C.cyan}Command Reference${C.reset}

${C.bold}${C.yellow}Quick Commands${C.reset} ${C.dim}(instant, no LLM)${C.reset}
  ${C.green}help${C.reset}              Show quick help
  ${C.green}list${C.reset}, ${C.green}ls${C.reset}         List user skills
  ${C.green}list all${C.reset}, ${C.green}ls -a${C.reset}  List all skills (including built-in)
  ${C.green}reload${C.reset}            Refresh skills from disk
  ${C.green}history${C.reset}, ${C.green}hist${C.reset}    Show command history
  ${C.green}exit${C.reset}, ${C.green}quit${C.reset}, ${C.green}q${C.reset}   Exit the CLI

${C.bold}${C.yellow}Slash Commands${C.reset} ${C.dim}(direct skill execution)${C.reset}
  ${C.cyan}/ls${C.reset} [all]                List skills
  ${C.cyan}/read${C.reset} <skill>            Read skill definition
  ${C.cyan}/write${C.reset} <skill> [type]    Create/update skill
  ${C.cyan}/delete${C.reset} <skill>          Delete a skill
  ${C.cyan}/validate${C.reset} <skill>        Validate against schema
  ${C.cyan}/template${C.reset} <type>         Get blank template
  ${C.cyan}/build${C.reset}                   Build pending skills from specs
  ${C.cyan}/generate${C.reset} <skill>        Generate runtime code
  ${C.cyan}/test${C.reset} [skill]            Test skill code
  ${C.cyan}/run-tests${C.reset} [skill|all]   Run test files
  ${C.cyan}/refine${C.reset} <skill>          Improve until tests pass
  ${C.cyan}/update${C.reset} <skill> <section> Update a section
  ${C.cyan}/update repos${C.reset}             Pull cloned repositories
  ${C.cyan}/specs${C.reset} <skill>           Read specs/ files
  ${C.cyan}/specs-write${C.reset} <skill>     Create/update specs/ files
  ${C.cyan}/exec${C.reset} <skill> [input]    Execute any skill
  ${C.cyan}/raw${C.reset}                     Toggle markdown rendering
  ${C.cyan}/tier${C.reset} [name]             Show/switch LLM tier
  ${C.cyan}/model${C.reset} [name|clear]      Pin a model or clear pin
  ${C.cyan}/permissions${C.reset} [mode]      Show/set Bash approval mode
  ${C.cyan}/tasks${C.reset} [count|all]       Show background task summaries
  ${C.cyan}/task view${C.reset} <task-id>     Show a task and its stored log
  ${C.cyan}/task stop${C.reset} <task-id>     Stop an ongoing task
  ${C.cyan}/task continue${C.reset} <id> <prompt> Continue a terminal task
  ${C.cyan}/help${C.reset} [topic]            Show help
  ${C.cyan}/add-repo${C.reset} <URL> [name]   Clone a repository
  ${C.cyan}/list-repos${C.reset}              List cloned repositories
  ${C.cyan}/remove-repo${C.reset} <name>      Remove a repository

${C.dim}Type /help <command> for detailed help on any command.${C.reset}
`,
    },

    // Skill types
    skills: {
        title: 'Skill Types',
        aliases: ['types', 'skill-types', 'skilltypes'],
        content: `
${C.bold}${C.cyan}Skill Types${C.reset}

${C.bold}${C.yellow}tskill${C.reset} - Database Table Skill
  ${C.dim}Defines entity schemas with fields, validators, and business rules.${C.reset}
  ${C.green}File:${C.reset} tskill.md -> ${C.cyan}generates${C.reset} src/tskill.generated.mjs
  ${C.green}Sections:${C.reset} Table Purpose, Fields, Role Access Policy, Delete Guard
  ${C.green}Use for:${C.reset} Equipment, Materials, Areas, Jobs, etc.

${C.bold}${C.yellow}cskill${C.reset} - Code Skill
  ${C.dim}Executes src/index.mjs or src/index.js; can be generated from specs/.${C.reset}
  ${C.green}File:${C.reset} cskill.md + specs/*.md -> src/*.mjs
  ${C.green}Sections:${C.reset} Description, Input Format, Output Format, Constraints
  ${C.green}Use for:${C.reset} Complex business logic from natural language specs

${C.bold}${C.yellow}dcgskill${C.reset} - Dynamic Code Generation Skill
  ${C.dim}LLM decides text/code at runtime and may execute generated snippets.${C.reset}
  ${C.green}File:${C.reset} dcgskill.md
  ${C.green}Sections:${C.reset} Description, Prompt, Argument, LLM Model, Examples
  ${C.green}Use for:${C.reset} Utilities, agent API access, deterministic tools

${C.bold}${C.yellow}oskill${C.reset} - Orchestrator Skill
  ${C.dim}Routes user intents to other skills.${C.reset}
  ${C.green}File:${C.reset} oskill.md
  ${C.green}Sections:${C.reset} Preparation, Allowed-Prep-Skills, Instructions, Allowed-Skills, Session-Type, Description
  ${C.green}Use for:${C.reset} Domain routers, skill coordinators

${C.bold}${C.yellow}mskill${C.reset} - MCP Skill
  ${C.dim}Uses Model Context Protocol tools.${C.reset}
  ${C.green}File:${C.reset} mskill.md
  ${C.green}Sections:${C.reset} Description, Instructions, Allowed-Tools, Light-SOP-Lang, Configuration
  ${C.green}Use for:${C.reset} External tool integrations

${C.dim}Type /template <type> to get a blank template.${C.reset}
`,
    },

    // tskill specific help
    tskill: {
        title: 'Database Table Skills (tskill)',
        aliases: ['table', 'entity', 'database'],
        content: `
${C.bold}${C.cyan}Database Table Skills (tskill)${C.reset}

tskills define database entities with fields, validators, presenters, and
business rules. They generate executable .mjs code.

${C.bold}${C.yellow}Structure:${C.reset}
  ${C.green}# Entity Name${C.reset}

  ${C.green}## Table Purpose${C.reset}
  ${C.dim}Describe what this table stores and its role.${C.reset}

  ${C.green}## Fields${C.reset}
  ${C.dim}Define each field with properties and validators.${C.reset}

  ${C.green}### field_name${C.reset}
  - Description: What this field stores
  - Type: string | number | boolean | datetime
  - Required: true | false
  - PrimaryKey: true ${C.dim}(for ID fields)${C.reset}
  - Default: default value

  ${C.green}#### Field Value Validator${C.reset}
  ${C.dim}Validation rules in natural language.${C.reset}

  ${C.green}#### Field Value Enumerator${C.reset}
  ${C.dim}List of allowed values: ["active", "inactive"]${C.reset}

  ${C.green}#### Field Value Presenter${C.reset}
  ${C.dim}How to format the value for display.${C.reset}

${C.bold}${C.yellow}Workflow:${C.reset}
  1. ${C.cyan}/write my-entity tskill${C.reset} - Create from template
  2. Edit the tskill.md file
  3. ${C.cyan}/validate my-entity${C.reset} - Check for errors
  4. ${C.cyan}/generate my-entity${C.reset} - Generate runtime code
  5. ${C.cyan}/test my-entity${C.reset} - Run tests

${C.dim}See /help specs for adding requirements via specs/ files.${C.reset}
`,
    },

    // Specifications
    specs: {
        title: 'Skill Specifications (specs/)',
        aliases: ['specifications', 'requirements', 'constraints'],
        content: `
${C.bold}${C.cyan}Skill Specifications (specs/)${C.reset}

Generated cskill and tskill/dbtable workflows use markdown files under specs/
to define implementation requirements and constraints.

${C.bold}${C.yellow}Creating a Specs File:${C.reset}
  ${C.green}>${C.reset} /specs-write my-skill

${C.bold}${C.yellow}Reading a Specs File:${C.reset}
  ${C.green}>${C.reset} /specs my-skill

${C.bold}${C.yellow}Example specs/index.mjs.md:${C.reset}
  ${C.dim}# Specifications for Equipment

  ## Requirements
  - All equipment_id values must be unique
  - Status changes must be logged
  - Calibration dates must not be in the future

  ## Validation Requirements

  ### Required Exports
  - validateRecord
  - presentRecord
  - resolveDefaults

  ### Required Fields
  - equipment_id
  - name
  - status

  ### Custom Rules
  - Equipment in "In Use" status cannot be deleted
  ${C.reset}

${C.bold}${C.yellow}How Specs Are Used:${C.reset}
  ${C.green}•${C.reset} Included in LLM context during /generate
  ${C.green}•${C.reset} Used by /refine to understand requirements
  ${C.green}•${C.reset} Displayed alongside skill with /read

${C.dim}Specs are optional but help ensure consistent code generation.${C.reset}
`,
    },

    // Testing
    testing: {
        title: 'Testing Skills',
        aliases: ['test', 'tests', 'run-tests'],
        content: `
${C.bold}${C.cyan}Testing Skills${C.reset}

The skill manager supports automated testing of generated code.

${C.bold}${C.yellow}Test File Convention:${C.reset}
  Tests live in the ${C.cyan}tests/${C.reset} folder with names like:
  ${C.green}tests/equipment.tests.mjs${C.reset}
  ${C.green}tests/material.tests.mjs${C.reset}

${C.bold}${C.yellow}Running Tests:${C.reset}
  ${C.green}>${C.reset} /test                ${C.dim}Interactive picker${C.reset}
  ${C.green}>${C.reset} /test equipment      ${C.dim}Test specific skill${C.reset}
  ${C.green}>${C.reset} /run-tests           ${C.dim}Interactive picker${C.reset}
  ${C.green}>${C.reset} /run-tests all       ${C.dim}Run all tests${C.reset}

${C.bold}${C.yellow}Test File Structure:${C.reset}
  ${C.dim}// tests/my-skill.tests.mjs
  export default async function() {
      let passed = 0, failed = 0;
      const errors = [];

      // Test 1
      try {
          // ... test logic
          passed++;
      } catch (e) {
          failed++;
          errors.push(e.message);
      }

      return { passed, failed, errors };
  }${C.reset}

${C.bold}${C.yellow}Refinement Loop:${C.reset}
  ${C.green}>${C.reset} /refine my-skill

  This automatically:
  1. Runs tests
  2. Analyzes failures
  3. Updates the skill definition
  4. Regenerates code
  5. Repeats until tests pass (max 5 iterations)

${C.dim}Tests run in isolated subprocesses for safety.${C.reset}
`,
    },

    // Natural language
    'natural-language': {
        title: 'Using Natural Language',
        aliases: ['nl', 'natural', 'language', 'chat'],
        content: `
${C.bold}${C.cyan}Using Natural Language${C.reset}

You can interact with the skill manager using natural language.
The LLM understands your intent and executes the appropriate skill.

${C.bold}${C.yellow}Examples:${C.reset}

  ${C.bold}Listing Skills${C.reset}
  ${C.green}>${C.reset} "list all skills"
  ${C.green}>${C.reset} "show me my skills"
  ${C.green}>${C.reset} "what skills do I have?"

  ${C.bold}Reading Skills${C.reset}
  ${C.green}>${C.reset} "read the equipment skill"
  ${C.green}>${C.reset} "show me the material tskill"
  ${C.green}>${C.reset} "what's in the area skill?"

  ${C.bold}Creating Skills${C.reset}
  ${C.green}>${C.reset} "create a new tskill called inventory"
  ${C.green}>${C.reset} "make a code skill for data processing"

  ${C.bold}Validation & Generation${C.reset}
  ${C.green}>${C.reset} "validate the equipment skill"
  ${C.green}>${C.reset} "generate code for my-entity"

  ${C.bold}Complex Requests${C.reset}
  ${C.green}>${C.reset} "add a status field to the equipment skill"
  ${C.green}>${C.reset} "update the validator for the name field"

${C.bold}${C.yellow}When to Use Natural Language:${C.reset}
  ${C.green}•${C.reset} Exploratory tasks - when you're not sure what to do
  ${C.green}•${C.reset} Complex operations - multi-step tasks
  ${C.green}•${C.reset} Questions - "how do I...?"

${C.bold}${C.yellow}When to Use Slash Commands:${C.reset}
  ${C.green}•${C.reset} Speed - direct execution without LLM
  ${C.green}•${C.reset} Scripting - predictable behavior
  ${C.green}•${C.reset} Repetitive tasks - faster workflow

${C.dim}Press Esc to cancel any long-running LLM operation.${C.reset}
`,
    },

    // Keyboard shortcuts
    shortcuts: {
        title: 'Keyboard Shortcuts',
        aliases: ['keys', 'keyboard', 'keybindings', 'hotkeys'],
        content: `
${C.bold}${C.cyan}Keyboard Shortcuts${C.reset}

${C.bold}${C.yellow}Navigation:${C.reset}
  ${C.green}↑${C.reset} / ${C.green}↓${C.reset}           Navigate command history
  ${C.green}←${C.reset} / ${C.green}→${C.reset}           Move cursor in input
  ${C.green}Ctrl+A${C.reset} / ${C.green}Home${C.reset}   Move to line start
  ${C.green}Ctrl+E${C.reset} / ${C.green}End${C.reset}    Move to line end
  ${C.green}Ctrl+←${C.reset}          Move to previous word
  ${C.green}Ctrl+→${C.reset}          Move to next word

${C.bold}${C.yellow}Editing:${C.reset}
  ${C.green}Backspace${C.reset}       Delete character before cursor
  ${C.green}Delete${C.reset}          Delete character at cursor
  ${C.green}Ctrl+Backspace${C.reset}  Delete previous word
  ${C.green}Ctrl+Delete${C.reset}     Delete next word
  ${C.green}Ctrl+U${C.reset}          Clear entire line
  ${C.green}Ctrl+K${C.reset}          Delete to end of line

${C.bold}${C.yellow}Command Picker:${C.reset}
  ${C.green}/${C.reset}               Open command picker (when line is empty)
  ${C.green}Tab${C.reset}             Complete or select
  ${C.green}↑${C.reset} / ${C.green}↓${C.reset}           Navigate picker options
  ${C.green}Enter${C.reset}           Select highlighted option
  ${C.green}Esc${C.reset}             Cancel picker

${C.bold}${C.yellow}During Operations:${C.reset}
  ${C.green}Esc${C.reset}             Cancel running LLM operation
  ${C.green}Ctrl+C${C.reset}          Exit the CLI

${C.dim}The command picker appears when you type "/" on an empty line.${C.reset}
`,
    },

    // Workflows
    workflows: {
        title: 'Common Workflows',
        aliases: ['workflow', 'patterns', 'examples'],
        content: `
${C.bold}${C.cyan}Common Workflows${C.reset}

${C.bold}${C.yellow}1. Create a New Database Entity${C.reset}
   ${C.green}>${C.reset} /write equipment tskill     ${C.dim}Create from template${C.reset}
   ${C.dim}(edit the tskill.md file)${C.reset}
   ${C.green}>${C.reset} /validate equipment         ${C.dim}Check for errors${C.reset}
   ${C.green}>${C.reset} /generate equipment         ${C.dim}Generate code${C.reset}
   ${C.green}>${C.reset} /test equipment             ${C.dim}Run tests${C.reset}

${C.bold}${C.yellow}2. Iterative Refinement${C.reset}
   ${C.green}>${C.reset} /refine equipment           ${C.dim}Auto-improve until tests pass${C.reset}

${C.bold}${C.yellow}3. Add Specifications${C.reset}
   ${C.green}>${C.reset} /specs-write equipment      ${C.dim}Create specs/ template${C.reset}
   ${C.dim}(edit specs/ files with requirements)${C.reset}
   ${C.green}>${C.reset} /generate equipment         ${C.dim}Regenerate with specs${C.reset}

${C.bold}${C.yellow}4. Update a Skill Section${C.reset}
   ${C.green}>${C.reset} /read equipment             ${C.dim}View current definition${C.reset}
   ${C.green}>${C.reset} /update equipment Fields    ${C.dim}Update specific section${C.reset}

${C.bold}${C.yellow}5. Run All Tests${C.reset}
   ${C.green}>${C.reset} /run-tests all              ${C.dim}Run entire test suite${C.reset}

${C.bold}${C.yellow}6. Execute Any Skill Directly${C.reset}
   ${C.green}>${C.reset} /exec list-skills           ${C.dim}Run list-skills skill${C.reset}
   ${C.green}>${C.reset} /exec my-custom-skill arg   ${C.dim}Run with argument${C.reset}

${C.bold}${C.yellow}7. Debug Workflow${C.reset}
   ${C.green}>${C.reset} /read my-skill              ${C.dim}Check definition${C.reset}
   ${C.green}>${C.reset} /validate my-skill          ${C.dim}Find schema errors${C.reset}
   ${C.green}>${C.reset} /specs my-skill             ${C.dim}Check requirements${C.reset}
   ${C.green}>${C.reset} /test my-skill              ${C.dim}Run tests with output${C.reset}

${C.dim}Tip: Use natural language for complex tasks, slash commands for speed.${C.reset}
`,
    },

    // Topics list
    topics: {
        title: 'Help Topics',
        aliases: ['index', 'toc', 'contents'],
        content: `
${C.bold}${C.cyan}Available Help Topics${C.reset}

  ${C.green}/help overview${C.reset}          What is Achilles CLI?
  ${C.green}/help getting-started${C.reset}   Quick start guide
  ${C.green}/help commands${C.reset}          Full command reference
  ${C.green}/help skills${C.reset}            Skill types explained
  ${C.green}/help tskill${C.reset}            Database table skills in detail
  ${C.green}/help specs${C.reset}             Using specs/ files
  ${C.green}/help testing${C.reset}           Testing and refinement
  ${C.green}/help natural-language${C.reset}  Using natural language
  ${C.green}/help shortcuts${C.reset}         Keyboard shortcuts
  ${C.green}/help workflows${C.reset}         Common workflows and patterns
  ${C.green}/help repos${C.reset}             Managing repositories
  ${C.green}/help repos${C.reset}             Managing repositories

${C.bold}${C.yellow}Command-Specific Help:${C.reset}
  ${C.green}/help read${C.reset}              Help for /read command
  ${C.green}/help write${C.reset}             Help for /write command
  ${C.green}/help generate${C.reset}          Help for /generate command
  ${C.dim}...and any other slash command${C.reset}

${C.dim}Type /help or just "help" for quick reference.${C.reset}
`,
    },

    // Repository management
    repos: {
        title: 'Repository Management',
        aliases: ['repo', 'repositories', 'git'],
        content: `
${C.bold}${C.cyan}Repository Management${C.reset}

Achilles CLI stores cloned repositories in ${C.cyan}.achilles-cli/repos/${C.reset}.
Skills inside these repos are automatically discovered by MainAgent
after a ${C.green}reload${C.reset} command.

${C.bold}${C.yellow}Adding a Repository:${C.reset}
  ${C.green}>${C.reset} /add-repo <URL> [name]

  The name is optional — derived from the URL if omitted.

  ${C.green}>${C.reset} /add-repo https://github.com/foo/bar.git
  ${C.dim}Clones into .achilles-cli/repos/bar/${C.reset}

  ${C.green}>${C.reset} /add-repo https://github.com/foo/bar.git my-repo
  ${C.dim}Clones into .achilles-cli/repos/my-repo/${C.reset}

${C.bold}${C.yellow}Listing Repositories:${C.reset}
  ${C.green}>${C.reset} /list-repos
  ${C.dim}Shows all cloned repos with URLs and paths${C.reset}

${C.bold}${C.yellow}Updating Repositories:${C.reset}
  ${C.green}>${C.reset} /update repos
  ${C.dim}Runs git pull in every cloned repository and reports per-repo failures${C.reset}

${C.bold}${C.yellow}Removing a Repository:${C.reset}
  ${C.green}>${C.reset} /remove-repo <name>
  ${C.dim}Deletes .achilles-cli/repos/<name>/${C.reset}

${C.bold}${C.yellow}After Cloning:${C.reset}
  Run ${C.green}reload${C.reset} to re-scan skills from the new repository.

${C.dim}Repositories are stored locally in .achilles-cli/repos/.${C.reset}
`,
    },
};

/**
 * Help for individual commands
 */
const COMMAND_HELP = {
    ls: {
        title: '/ls - List Skills',
        content: `
${C.bold}${C.cyan}/ls - List Skills${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/ls${C.reset}         List user skills only
  ${C.green}/ls all${C.reset}     List all skills (including built-in)

${C.bold}${C.yellow}Description:${C.reset}
  Shows all skills registered in the current project's skills
  directory. By default, only shows user-created skills. Add "all" to
  include built-in skills used by the skill manager itself.

${C.bold}${C.yellow}Output:${C.reset}
  Each skill shows: [type] skill-name
  Types: tskill, cskill, dcgskill, oskill, mskill, anthropic

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /ls
  ${C.dim}User skills:
    • [tskill] equipment
    • [tskill] material
    • [cskill] data-processor${C.reset}

${C.dim}Alias: /list${C.reset}
`,
    },

    read: {
        title: '/read - Read Skill Definition',
        content: `
${C.bold}${C.cyan}/read - Read Skill Definition${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/read <skill-name>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Displays the full content of a skill's definition file (tskill.md,
  cskill.md, etc.).

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /read equipment
  ${C.green}>${C.reset} /read my-custom-skill

${C.bold}${C.yellow}Tips:${C.reset}
  ${C.green}•${C.reset} Use Tab after typing "/read " to get skill name suggestions
  ${C.green}•${C.reset} Press "/" then select "read" from the picker for guided input
`,
    },

    write: {
        title: '/write - Create/Update Skill',
        content: `
${C.bold}${C.cyan}/write - Create or Update Skill${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/write <skill-name>${C.reset}           Update existing skill
  ${C.green}/write <skill-name> <type>${C.reset}    Create new skill of type

${C.bold}${C.yellow}Skill Types:${C.reset}
  ${C.cyan}tskill${C.reset}  - Database table skill
  ${C.cyan}cskill${C.reset}  - Code skill (LLM generates from specs)
  ${C.cyan}dcgskill${C.reset} - Dynamic code generation skill
  ${C.cyan}oskill${C.reset}  - Orchestrator skill
  ${C.cyan}mskill${C.reset}  - MCP tool skill
  ${C.cyan}anthropic${C.reset} - Anthropic-style skill bundle

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /write inventory tskill    ${C.dim}Create new tskill${C.reset}
  ${C.green}>${C.reset} /write equipment           ${C.dim}Update existing skill${C.reset}

${C.bold}${C.yellow}What Happens:${C.reset}
  For new skills, creates a directory with a template file.
  For existing skills, opens for editing (or updates via LLM).
`,
    },

    validate: {
        title: '/validate - Validate Skill',
        content: `
${C.bold}${C.cyan}/validate - Validate Skill Against Schema${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/validate <skill-name>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Checks the skill definition file against its type schema.
  Reports missing required sections, warnings for optional sections,
  and type-specific validation errors.

${C.bold}${C.yellow}What It Checks:${C.reset}
  ${C.green}•${C.reset} Required sections are present (e.g., ## Table Purpose)
  ${C.green}•${C.reset} File starts with a # title
  ${C.green}•${C.reset} Type-specific requirements (e.g., fields for tskill)
  ${C.green}•${C.reset} Specs validation if specs/ files exist

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /validate equipment
  ${C.dim}✓ Skill is valid

  Warnings:
    • Optional section not present: ## Derived Fields${C.reset}
`,
    },

    generate: {
        title: '/generate - Generate Code',
        content: `
${C.bold}${C.cyan}/generate - Generate Code from tskill${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/generate <skill-name>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Generates runtime code for supported generated skill types.
  The generated code includes validators, presenters, resolvers, and
  enumerators based on the field definitions.

${C.bold}${C.yellow}Prerequisites:${C.reset}
  ${C.green}•${C.reset} The skill must be a tskill
  ${C.green}•${C.reset} The tskill.md file must be valid

${C.bold}${C.yellow}What Gets Generated:${C.reset}
  ${C.green}•${C.reset} validateRecord() - Validates a record against rules
  ${C.green}•${C.reset} presentRecord() - Formats record for display
  ${C.green}•${C.reset} resolveDefaults() - Applies default values
  ${C.green}•${C.reset} Field-specific validators, enumerators, resolvers

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /generate equipment
  ${C.dim}Generated: skills/equipment/src/tskill.generated.mjs${C.reset}

${C.bold}${C.yellow}After Generation:${C.reset}
  Run ${C.cyan}/test equipment${C.reset} to verify the generated code works.
`,
    },

    build: {
        title: '/build - Build Pending Skills',
        content: `
${C.bold}${C.cyan}/build - Build Pending Skills from specs${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/build${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Manually runs skill build for discovered skills. This generates code for
  skills that have specs and are missing generated entrypoints.

${C.bold}${C.yellow}When to Use:${C.reset}
  ${C.green}•${C.reset} After creating a new cskill/tskill with specs
  ${C.green}•${C.reset} After editing specs and wanting to refresh generated code
  ${C.green}•${C.reset} When webchat/REPL starts and you want explicit control

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /build
  ${C.dim}Skills build complete.${C.reset}
`,
    },

    test: {
        title: '/test - Test Skill Code',
        content: `
${C.bold}${C.cyan}/test - Test Skill Code${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/test${C.reset}               Interactive test picker
  ${C.green}/test <skill-name>${C.reset}  Test specific skill

${C.bold}${C.yellow}Description:${C.reset}
  Runs the test file for a skill. Tests are located in the tests/ folder
  and named {skill-name}.tests.mjs.

${C.bold}${C.yellow}Test File Location:${C.reset}
  ${C.cyan}tests/equipment.tests.mjs${C.reset} for the "equipment" skill

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /test                  ${C.dim}Shows picker with all tests${C.reset}
  ${C.green}>${C.reset} /test equipment        ${C.dim}Runs equipment tests${C.reset}

${C.bold}${C.yellow}Output:${C.reset}
  Shows pass/fail counts and any error messages.
  Tests run in isolated subprocesses for safety.

${C.dim}See /help testing for more details on writing tests.${C.reset}
`,
    },

    refine: {
        title: '/refine - Iterative Improvement',
        content: `
${C.bold}${C.cyan}/refine - Iteratively Improve Skill${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/refine <skill-name>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Automatically improves a skill until its tests pass. This is a powerful
  command that combines testing, analysis, and regeneration in a loop.

${C.bold}${C.yellow}How It Works:${C.reset}
  1. Run tests for the skill
  2. If tests fail, analyze the errors
  3. Update the skill definition based on errors
  4. Regenerate the code
  5. Repeat until tests pass (max 5 iterations)

${C.bold}${C.yellow}Prerequisites:${C.reset}
  ${C.green}•${C.reset} The skill must have a test file (tests/{skill}.tests.mjs)
  ${C.green}•${C.reset} The skill should have specs/ files when generated code depends on detailed requirements

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /refine equipment
  ${C.dim}Iteration 1: 3 passed, 2 failed
  Analyzing failures...
  Updating skill definition...
  Iteration 2: 4 passed, 1 failed
  ...
  Iteration 3: 5 passed, 0 failed
  ✓ All tests passing!${C.reset}
`,
    },

    exec: {
        title: '/exec - Execute Any Skill',
        content: `
${C.bold}${C.cyan}/exec - Execute Any Skill Directly${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/exec <skill-name>${C.reset}           Execute with skill name as input
  ${C.green}/exec <skill-name> <input>${C.reset}   Execute with custom input

${C.bold}${C.yellow}Description:${C.reset}
  Directly executes any registered skill, including built-in skills.
  Bypasses the orchestrator and runs the skill with the provided input.

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /exec list-skills          ${C.dim}Run list-skills skill${C.reset}
  ${C.green}>${C.reset} /exec read-skill equipment ${C.dim}Read equipment skill${C.reset}
  ${C.green}>${C.reset} /exec my-cskill "process this data"

${C.bold}${C.yellow}When to Use:${C.reset}
  ${C.green}•${C.reset} Testing a specific skill directly
  ${C.green}•${C.reset} Running built-in skills
  ${C.green}•${C.reset} Debugging skill behavior
`,
    },

    specs: {
        title: '/specs - Read Specifications',
        content: `
${C.bold}${C.cyan}/specs - Read Skill Specifications${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/specs <skill-name>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Displays specs/ files for a skill. These files contain requirements
  and constraints used during code generation.

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /specs equipment

${C.dim}Related: /specs-write creates or updates specs/ files.${C.reset}
${C.dim}See /help specs for more about specifications.${C.reset}
`,
    },

    'specs-write': {
        title: '/specs-write - Create/Update Specifications',
        content: `
${C.bold}${C.cyan}/specs-write - Create/Update Specifications${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/specs-write <skill-name>${C.reset}           Generate template
  ${C.green}/specs-write <skill-name> <content>${C.reset}  Write specific content

${C.bold}${C.yellow}Description:${C.reset}
  Creates or updates a specs/ file for a skill. If called without
  content, generates a template based on the skill type.

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /specs-write equipment     ${C.dim}Generate template${C.reset}

${C.dim}See /help specs for more about specifications.${C.reset}
`,
    },

    update: {
        title: '/update - Update Section',
        content: `
${C.bold}${C.cyan}/update - Update Skill Section${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/update <skill-name> <section>${C.reset}
  ${C.green}/update repos${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Updates a specific section of a skill definition. The LLM will
  analyze the skill and generate new content for the specified section.
  With ${C.green}/update repos${C.reset}, pulls every cloned repository in
  .achilles-cli/repos/ and reports any per-repository git errors.

${C.bold}${C.yellow}Common Sections:${C.reset}
  ${C.cyan}tskill:${C.reset} Table Purpose, Fields, Business Rules
  ${C.cyan}cskill:${C.reset} Description, Input Format, Output Format, Constraints
  ${C.cyan}oskill:${C.reset} Preparation, Allowed-Prep-Skills, Instructions, Allowed-Skills, Session-Type, Description

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /update equipment Fields
  ${C.green}>${C.reset} /update my-skill "Business Rules"
  ${C.green}>${C.reset} /update repos
`,
    },

    template: {
        title: '/template - Get Blank Template',
        content: `
${C.bold}${C.cyan}/template - Get Blank Skill Template${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/template <type>${C.reset}

${C.bold}${C.yellow}Types:${C.reset}
  ${C.cyan}tskill${C.reset}  - Database table skill template
  ${C.cyan}cskill${C.reset}  - Code skill template (spec-based)
  ${C.cyan}dcgskill${C.reset} - Dynamic code generation skill template
  ${C.cyan}oskill${C.reset}  - Orchestrator skill template
  ${C.cyan}mskill${C.reset}  - MCP skill template
  ${C.cyan}anthropic${C.reset} - Anthropic-style skill template

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /template tskill
  ${C.green}>${C.reset} /template dcgskill

${C.bold}${C.yellow}Output:${C.reset}
  Displays the full template text that you can copy and customize.
`,
    },

    raw: {
        title: '/raw - Toggle Markdown Rendering',
        content: `
${C.bold}${C.cyan}/raw - Toggle Markdown Rendering${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/raw${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Toggles markdown rendering on or off. When off, output is shown
  as plain text without ANSI styling.

${C.bold}${C.yellow}When to Use:${C.reset}
  ${C.green}•${C.reset} Copying output to another application
  ${C.green}•${C.reset} Troubleshooting display issues
  ${C.green}•${C.reset} Personal preference
`,
    },

    tasks: {
        title: '/tasks - Show Background Tasks',
        content: `
${C.bold}${C.cyan}/tasks - Show Background Tasks${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/tasks${C.reset}             Show the 10 most recently updated tasks
  ${C.green}/tasks <count>${C.reset}     Show 1 to 100 recent tasks
  ${C.green}/tasks all${C.reset}         Show the complete workspace task journal

${C.bold}${C.yellow}Description:${C.reset}
  Reads task status from the current workspace without changing task state.
  Ongoing tasks show metadata only. Finished, stopped, and failed tasks may
  include the final five log lines, bounded to 2 KiB per task.
`,
    },

    task: {
        title: '/task - Manage Background Tasks',
        aliases: ['task-view', 'task-stop', 'task-continue'],
        content: `
${C.bold}${C.cyan}/task - Manage Background Tasks${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/task view <task-id>${C.reset}
  ${C.green}/task stop <task-id>${C.reset}
  ${C.green}/task continue <task-id> <prompt>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Views task metadata and the latest five stored log lines, bounded to 2 KiB,
  stops queued or running remote work, or continues a terminal task using its
  saved continuation handle. Press Tab after an action to select a compatible
  task by name and insert its task id.
`,
    },

    delete: {
        title: '/delete - Delete Skill',
        content: `
${C.bold}${C.cyan}/delete - Delete a Skill${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/delete <skill-name>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Deletes the skill directory and all its files. This action
  cannot be undone (unless using version control).

${C.bold}${C.yellow}What Gets Deleted:${C.reset}
  ${C.green}•${C.reset} The skill definition file (tskill.md, cskill.md, etc.)
  ${C.green}•${C.reset} Generated code (src/tskill.generated.mjs or src/index.mjs)
  ${C.green}•${C.reset} Specifications (specs/)
  ${C.green}•${C.reset} The entire skill directory

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /delete old-skill

${C.bold}${C.red}Warning:${C.reset} This permanently deletes the skill!
`,
    },

    'run-tests': {
        title: '/run-tests - Run Test Suite',
        content: `
${C.bold}${C.cyan}/run-tests - Run Test Suite${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/run-tests${C.reset}               Interactive picker
  ${C.green}/run-tests <skill-name>${C.reset}  Run tests for one skill
  ${C.green}/run-tests all${C.reset}           Run all test files

${C.bold}${C.yellow}Description:${C.reset}
  Runs .tests.mjs files from the tests/ directory. Unlike /test which
  runs the test-code skill, this directly executes test files.

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /run-tests all
  ${C.dim}Running all tests...
  ✓ equipment (3 passed)
  ✓ material (5 passed)
  ✗ area (2 passed, 1 failed)

  Total: 3 tests, 10 passed, 1 failed${C.reset}
`,
    },

    scaffold: {
        title: '/scaffold - Create Documentation Skill',
        content: `
${C.bold}${C.cyan}/scaffold - Create Documentation Skill${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/scaffold <doc-type> <skill-name>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Creates a documentation skill with full directory structure including
  SKILL.md, resources/, and scripts/ directories. Uses the Anthropic-style
  skill format.

${C.bold}${C.yellow}Available Doc Types:${C.reset}
  ${C.green}doc-scientific${C.reset}       Scientific article (IEEE, APA, ACM)
  ${C.green}doc-eu-deliverable${C.reset}  EU Horizon Europe project deliverable
  ${C.green}doc-technical${C.reset}       Technical documentation (API docs, runbooks)
  ${C.green}doc-book${C.reset}            Book/manual (non-fiction, textbooks)
  ${C.green}doc-review${C.reset}          Interactive document reviewer

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /scaffold doc-scientific my-paper
  ${C.dim}Creates skills/my-paper/ with SKILL.md + resources/ + scripts/${C.reset}

  ${C.green}>${C.reset} /scaffold doc-review my-reviewer
  ${C.dim}Creates a document review skill${C.reset}

${C.dim}After scaffolding, use /exec <skill-name> to run the skill.${C.reset}
`,
    },

    tier: {
        title: '/tier - Switch LLM Tier',
        content: `
${C.bold}${C.cyan}/tier - Switch LLM Tier${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/tier${C.reset}              Show available tiers and current models
  ${C.green}/tier <tier-name>${C.reset}  Switch to a specific tier

${C.bold}${C.yellow}Description:${C.reset}
  Controls which LLM tier is used for skill execution. Tiers map to
  different models with varying speed/capability trade-offs.

${C.bold}${C.yellow}Common Tiers:${C.reset}
  ${C.green}fast${C.reset}    Quick responses, lower cost (default in REPL)
  ${C.green}deep${C.reset}    More capable, slower (default in single-shot)
  ${C.green}plan${C.reset}    Optimized for planning tasks
  ${C.green}write${C.reset}   Optimized for content generation
  ${C.green}code${C.reset}    Optimized for code generation
  ${C.green}ultra${C.reset}   Most capable tier

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /tier
  ${C.dim}Shows all available tiers with their model assignments${C.reset}

  ${C.green}>${C.reset} /tier deep
  ${C.dim}Switches to deep tier for more capable responses${C.reset}

${C.dim}Available tiers depend on Soul Gateway configuration.${C.reset}
`,
    },

    model: {
        title: '/model - Select an LLM Model',
        content: `
${C.bold}${C.cyan}/model - Select an LLM Model${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/model${C.reset}              Interactive model picker in the terminal
  ${C.green}/model <name>${C.reset}       Select a Soul Gateway model

${C.bold}${C.yellow}Description:${C.reset}
  Selects the model used for subsequent AchillesCLI LLM calls and stores
  it in .achilles-cli/settings.json for the current workspace. WebChat
  provides searchable autocomplete after typing /model and a space.
  Switching tiers with /tier removes the saved model selection.

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /model
  ${C.dim}Shows interactive picker with all available models${C.reset}

  ${C.green}>${C.reset} /model anthropic/claude-sonnet-4-6
  ${C.dim}Selects and saves anthropic/claude-sonnet-4-6${C.reset}

${C.dim}The model catalog is loaded from Soul Gateway.${C.reset}
`,
    },

    permissions: {
        title: '/permissions - Configure Bash Approvals',
        content: `
${C.bold}${C.cyan}/permissions - Configure Bash Approvals${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/permissions${C.reset}                     Show the current mode
  ${C.green}/permissions ask-for-approval${C.reset}    Ask before each new Bash command
  ${C.green}/permissions full-access${C.reset}         Run Bash automatically inside the workspace

${C.bold}${C.yellow}Description:${C.reset}
  Controls Bash only. Other tools continue to run normally. Full access is
  still confined to the current workspace. Paths outside that workspace are
  unavailable in both modes; approval never widens the filesystem sandbox.

  The selected mode is saved in .achilles-cli/settings.json for this
  workspace and restored the next time AchillesCLI starts in the folder.

  Always allow is remembered only for the exact Bash tool parameters and
  only for the current agent session.
`,
    },

    'add-repo': {
        title: '/add-repo - Clone a Repository',
        content: `
${C.bold}${C.cyan}/add-repo - Clone a Repository${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/add-repo <URL>${C.reset}           Clone with name from URL
  ${C.green}/add-repo <URL> <name>${C.reset}    Clone with custom name

${C.bold}${C.yellow}Description:${C.reset}
  Clones a git repository into .achilles-cli/repos/.
  If no name is provided, it is derived from the URL.

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /add-repo https://github.com/foo/bar.git
  ${C.dim}Clones into .achilles-cli/repos/bar/${C.reset}

  ${C.green}>${C.reset} /add-repo https://github.com/foo/bar.git my-repo
  ${C.dim}Clones into .achilles-cli/repos/my-repo/${C.reset}

${C.bold}${C.yellow}After Cloning:${C.reset}
  Run ${C.cyan}reload${C.reset} to re-scan skills from the new repository.
`,
    },

    'list-repos': {
        title: '/list-repos - List Repositories',
        content: `
${C.bold}${C.cyan}/list-repos - List Cloned Repositories${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/list-repos${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Shows all repositories cloned into .achilles-cli/repos/,
  including their git remote URLs and local paths.

${C.bold}${C.yellow}Example Output:${C.reset}
  ${C.dim}Repositories (2):

    my-skill-repo
      URL: https://github.com/foo/skills.git
      Path: /path/to/.achilles-cli/repos/my-skill-repo

    utils
      URL: https://github.com/bar/utils.git
      Path: /path/to/.achilles-cli/repos/utils${C.reset}
`,
    },

    'remove-repo': {
        title: '/remove-repo - Remove a Repository',
        content: `
${C.bold}${C.cyan}/remove-repo - Remove a Repository${C.reset}

${C.bold}${C.yellow}Usage:${C.reset}
  ${C.green}/remove-repo <name>${C.reset}

${C.bold}${C.yellow}Description:${C.reset}
  Removes a cloned repository from .achilles-cli/repos/.
  This permanently deletes the repository directory.

${C.bold}${C.yellow}Examples:${C.reset}
  ${C.green}>${C.reset} /remove-repo my-repo
  ${C.dim}Deletes .achilles-cli/repos/my-repo/${C.reset}

${C.bold}${C.red}Warning:${C.reset} This permanently deletes the repository!
`,
    },

};

/**
 * Display help for a topic or command
 * @param {string} topic - Topic name (optional)
 * @returns {string} Formatted help text
 */
export function showHelp(topic = null) {
    if (!topic) {
        // Show quick reference (same as HelpPrinter.printHelp)
        return getQuickReference();
    }

    const normalizedTopic = topic.toLowerCase().trim();

    // Check if it's a command (remove leading / if present)
    const commandName = normalizedTopic.startsWith('/') ? normalizedTopic.slice(1) : normalizedTopic;

    // Check command help first
    if (COMMAND_HELP[commandName]) {
        return COMMAND_HELP[commandName].content;
    }

    // Check topic help
    for (const [key, topicData] of Object.entries(HELP_TOPICS)) {
        if (key === normalizedTopic || topicData.aliases?.includes(normalizedTopic)) {
            return topicData.content;
        }
    }

    // Topic not found - suggest similar
    const allTopics = Object.keys(HELP_TOPICS);
    const allCommands = Object.keys(COMMAND_HELP);
    const suggestions = [...allTopics, ...allCommands]
        .filter(t => t.includes(normalizedTopic) || normalizedTopic.includes(t))
        .slice(0, 5);

    if (suggestions.length > 0) {
        return `
${C.bold}${C.yellow}Topic "${topic}" not found.${C.reset}

${C.bold}Did you mean:${C.reset}
${suggestions.map(s => `  ${C.green}/help ${s}${C.reset}`).join('\n')}

${C.dim}Type /help topics to see all available help topics.${C.reset}
`;
    }

    return `
${C.bold}${C.yellow}Topic "${topic}" not found.${C.reset}

Type ${C.green}/help topics${C.reset} to see all available help topics.
Type ${C.green}/help commands${C.reset} to see the command reference.
`;
}

/**
 * Get quick reference help (main help screen)
 */
export function getQuickReference() {
    return `
${C.bold}${C.cyan}┌──────────────────────────────────────────────────────────┐${C.reset}
${C.bold}${C.cyan}│${C.reset}${C.bold}                   Achilles CLI                      ${C.cyan}│${C.reset}
${C.bold}${C.cyan}└──────────────────────────────────────────────────────────┘${C.reset}

${C.bold}${C.yellow}Quick Commands${C.reset} ${C.dim}(no LLM)${C.reset}
  ${C.green}list${C.reset}, ${C.green}ls${C.reset}         List user skills
  ${C.green}list all${C.reset}        List all skills (including built-in)
  ${C.green}reload${C.reset}          Refresh skills from disk
  ${C.green}history${C.reset}         Show command history
  ${C.green}help${C.reset}            Show this help
  ${C.green}exit${C.reset}            Exit the CLI

${C.bold}${C.yellow}Common Slash Commands${C.reset}
  ${C.cyan}/read${C.reset} <skill>     Read skill definition
  ${C.cyan}/write${C.reset} <skill>    Create/update skill
  ${C.cyan}/build${C.reset}            Build pending skills
  ${C.cyan}/generate${C.reset} <skill> Generate code from tskill
  ${C.cyan}/test${C.reset} <skill>     Test generated code
  ${C.cyan}/refine${C.reset} <skill>   Improve until tests pass
  ${C.cyan}/update repos${C.reset}      Pull cloned repositories
  ${C.cyan}/permissions${C.reset} [mode] Show/set Bash approval mode
  ${C.cyan}/tasks${C.reset} [count|all] Show background task summaries
  ${C.cyan}/task${C.reset} <action> <id> View, stop, or continue a task
  ${C.cyan}/add-repo${C.reset} <URL>   Clone a repository
  ${C.cyan}/list-repos${C.reset}       List cloned repositories
  ${C.cyan}/remove-repo${C.reset}      Remove a repository
  ${C.cyan}/help${C.reset} [topic]     Detailed help

${C.bold}${C.yellow}Tips${C.reset}
  ${C.green}•${C.reset} Type ${C.cyan}/${C.reset} to open the command picker
  ${C.green}•${C.reset} Use natural language for complex tasks
  ${C.green}•${C.reset} Press ${C.cyan}Esc${C.reset} to cancel operations
  ${C.green}•${C.reset} Use ${C.cyan}↑${C.reset}/${C.cyan}↓${C.reset} for command history

${C.dim}Type /help topics for all help topics, or /help <command> for details.${C.reset}
`;
}

/**
 * Get list of all available help topics
 */
export function getHelpTopics() {
    return Object.entries(HELP_TOPICS).map(([key, data]) => ({
        name: key,
        title: data.title,
        aliases: data.aliases || [],
    }));
}

/**
 * Get list of all command help entries
 */
export function getCommandHelp() {
    return Object.entries(COMMAND_HELP).map(([key, data]) => ({
        name: key,
        title: data.title,
    }));
}

export default {
    showHelp,
    getQuickReference,
    getHelpTopics,
    getCommandHelp,
    HELP_TOPICS,
    COMMAND_HELP,
};
