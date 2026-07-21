# Achilles CLI Agent v2.0

A CLI agent specialized in managing, generating, and testing skill definition files in `skills` directories.

## Features

- **Native File Tools** - Fast, reliable file operations (no LLM-generated code for file ops)
- **Schema Validation** - Validate skill files against their type schemas
- **Code Generation** - Generate runtime `.mjs` code for `tskill.md`/`dbtable` and `cskill.md` definitions
- **Test Sandbox** - Run and test generated code safely
- **Diff Preview** - See changes before applying them
- **Full CRUD** - Create, read, update, delete skills
- **Interactive REPL** - Natural language interface
- **Workspace Sandbox** - MainAgent and Bash run through bubblewrap with only the selected workspace writable
- **Brokered Bash Approval** - `/permissions` controls approval prompts without putting policy in the Bash skill

## Installation

The AchillesCliAgent is part of achillesAgentLib. No separate installation needed.

```bash
# Make the CLI executable
chmod +x /path/to/achillesAgentLib/bin/achilles-cli
```

## Quick Start

```bash
# Start interactive REPL
achilles-cli --dir /path/to/your/project

# Or single-shot commands
achilles-cli "list all skills"
achilles-cli "create a tskill called inventory"
```

## Usage

### CLI Options

```
achilles-cli [options] [prompt]

Options:
  -d, --dir <path>       Sandboxed working directory (default: cwd)
  --permissions <mode>  ask-for-approval or full-access
  -v, --verbose          Enable verbose logging
  --fast                 Use fast LLM mode (cheaper, quicker)
  --deep                 Use deep LLM mode (default, more capable)
  -h, --help             Show help
  --version              Show version
```

`full-access` means full Bash access inside the selected workspace. Access to
paths outside it still requires an explicit approval through the outer broker.

### REPL Mode

```bash
$ achilles-cli --dir ./my-project

╔══════════════════════════════════════════════════════════╗
║           Achilles CLI Agent - Interactive CLI          ║
╚══════════════════════════════════════════════════════════╝

Working directory: /path/to/my-project
Skills directory: /path/to/my-project/skills
Loaded 3 skill(s):
  • [dbtable] equipment
  • [code] import
  • [orchestrator] main

AchillesCli> list
AchillesCli> read equipment
AchillesCli> validate equipment
AchillesCli> generate code for equipment
AchillesCli> exit
```

### Single-Shot Mode

```bash
# List skills
achilles-cli "list all skills"

# Read a skill
achilles-cli "read the equipment skill"

# Create a new skill
achilles-cli "create a tskill called inventory with fields: item_id, name, quantity, location"

# Update a section
achilles-cli "update the Description section of inventory to say 'Tracks warehouse inventory'"

# Validate
achilles-cli "validate inventory"

# Generate code
achilles-cli "generate code for inventory"

# Test generated code
achilles-cli "test the generated code for inventory"
```

### Programmatic Usage

```javascript
import { AchillesCliAgent } from 'achillesAgentLib/AchillesCliAgent';

const agent = new AchillesCliAgent({
    workingDir: '/path/to/project',
});

// Process a single prompt
const result = await agent.processPrompt('list all skills');
console.log(result);

// Or start interactive REPL
await agent.startREPL();
```

## Available Tools

### Core File Tools (Native - Fast)

| Tool | Description | Args |
|------|-------------|------|
| `list_skills` | List all discovered skills | none |
| `read_skill` | Read skill .md content | `skillName` |
| `read_file` | Read any file | `filePath` |
| `write_skill` | Create/write skill file | `{skillName, fileName, content}` |
| `write_file` | Write any file | `{filePath, content}` |
| `update_skill_section` | Update specific section | `{skillName, section, content}` |
| `delete_skill` | Delete skill directory | `skillName` |
| `list_skill_files` | List files in skill dir | `skillName` |
| `reload_skills` | Rescan for skills | none |

### Skill Management Tools

| Tool | Description | Args |
|------|-------------|------|
| `validate_skill` | Validate against schema | `skillName` |
| `get_skill_template` | Get blank template | `skillType` |
| `preview_changes` | Show diff before writing | `{skillName, fileName, newContent}` |

### Code Generation Tools

| Tool | Description | Args |
|------|-------------|------|
| `generate_skill_code` | Generate runtime .mjs for tskill/dbtable or cskill | `skillName` |
| `test_generated_code` | Test generated code | `{skillName, testInput?}` |

### Dynamic Skill Execution

Each discovered skill is exposed as `execute_<skillName>` tool.

## Skill Types

### tskill (Database Table)

Defines entity schemas with fields, validators, enumerators, presenters, and business rules.

```markdown
# Equipment

## Table Purpose
Tracks equipment items in the warehouse.

## Fields

### equipment_id
- Description: Unique identifier
- Type: string
- PrimaryKey: true

#### Field Value Validator
Must match pattern: EQP-####

### name
- Description: Equipment name
- Required: true

## Derived Fields

### is_available
- Calculation: status === "available"
```

### cskill (Code Skill)

LLM generates and executes code based on instructions.

```markdown
# Data Parser

## Description
Parses CSV and JSON data files.

## Input Format
- **input**: CSV or JSON text

## Output Format
- **Type**: `object`
```


### oskill (Orchestrator)

Routes user intents to appropriate skills.

```markdown
# Main Orchestrator

## Instructions
Route requests to the appropriate skill.

## Allowed-Skills
- equipment: Equipment management
- inventory: Stock tracking
```

### mskill (MCP)

Integrates with Model Context Protocol tools.

## Code Generation Workflow

1. **Create tskill.md or cskill.md** - Define your entity schema or code skill contract
2. **Validate** - `validate_skill skillName`
3. **Generate** - `generate_skill_code skillName`
4. **Test** - `test_generated_code skillName`

The generated `.mjs` file includes:
- `validator_<field>()` functions
- `enumerator_<field>()` functions
- `presenter_<field>()` functions
- `selectRecords()` for filtering
- `prepareRecord()` for transformation
- `validateRecord()` for full validation

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Claude (required) |
| `OPENAI_API_KEY` | Alternative: OpenAI API key |

## Architecture

```
User Input → LLM Supervisor → Native Tools (fast, reliable)
                              ├── read_skill
                              ├── write_skill
                              ├── validate_skill
                              ├── generate_skill_code
                              ├── test_generated_code
                              └── execute_* (discovered skills)
```

Key improvements over v1:
- **Native file tools** instead of LLM-generated code for file ops
- **Schema validation** with detailed error messages
- **Full templates** for each skill type
- **Diff preview** before applying changes
- **Code sandbox** for testing generated code

## File Structure

```
AchillesCliAgent/
├── index.mjs              # CLI entry point
├── AchillesCliAgent.mjs  # Main agent class
├── skillSchemas.mjs       # Schema definitions & templates
├── README.md              # This file
└── skills/       # Built-in skills (optional)
```

## Examples

### Creating a Complete Skill

```
AchillesCli> create a tskill called product with these fields:
- product_id (primary key, format PROD-####)
- name (required, unique, 2-100 chars)
- category (enum: electronics, clothing, food)
- price (number, required, min 0)
- stock_quantity (number, default 0)
- is_active (derived: status === "active")
```

### Updating a Section

```
AchillesCli> update the Business Rules section of product to include:
1. Products cannot be deleted if stock > 0
2. Price changes require manager approval
3. Category cannot be changed after creation
```

### Testing Generated Code

```
AchillesCli> test the generated code for product with input:
{
  "name": "Test Product",
  "category": "electronics",
  "price": 99.99
}
```

## Troubleshooting

**"No skills found"**
- Check that `skills` directory exists
- Run `reload_skills` after creating new skills

**"Skill type not detected"**
- Ensure skill file has required sections
- Use `get_skill_template` to see expected format

**"Code generation failed"**
- Verify the skill validates successfully first
- Check LLM API key is set

**"Test failed to load module"**
- Check generated code for syntax errors
- Ensure all imports are valid
