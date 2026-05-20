/**
 * Centralized constants for achilles-cli
 * Single source of truth for skill names, timeouts, and configuration
 */

/**
 * Built-in skill names registry
 * Use these constants instead of hardcoding skill name strings
 */
export const BUILT_IN_SKILLS = {
  // Core CRUD operations
  LIST: 'list-skills',
  READ: 'read-skill',
  WRITE: 'write-skill',
  DELETE: 'delete-skill',

  // Validation and templates
  VALIDATE: 'validate-skill',
  GET_TEMPLATE: 'get-template',
  PREVIEW: 'preview-changes',
  UPDATE_SECTION: 'update-section',

  // Code generation and testing
  GENERATE_CODE: 'generate-code',
  TEST_CODE: 'test-code',
  RUN_TESTS: 'run-tests',
  WRITE_TESTS: 'write-tests',

  // Specs management
  READ_SPECS: 'read-specs',
  WRITE_SPECS: 'write-specs',

  // Execution and refinement
  EXECUTE: 'execute-skill',
  SKILL_REFINER: 'skill-refiner',
  AKU_MEMORY: 'aku-memory',

  // Documentation scaffolding
  SCAFFOLD_DOC: 'scaffold-doc-skill',
};

/**
 * Skill type name strings
 * Use these instead of hardcoding type names like 'tskill', 'cskill', etc.
 */
export const SKILL_TYPE_NAMES = {
  TSKILL: 'tskill',
  CSKILL: 'cskill',
  OSKILL: 'oskill',
  MSKILL: 'mskill',
  DCGSKILL: 'dcgskill',
  ANTHROPIC: 'anthropic',
};

/**
 * Get all skill type names as an array
 * @returns {string[]}
 */
export function getAllSkillTypeNames() {
  return Object.values(SKILL_TYPE_NAMES);
}

/**
 * Documentation scaffold type names
 */
export const DOC_SCAFFOLD_TYPES = [
  'doc-scientific',
  'doc-eu-deliverable',
  'doc-technical',
  'doc-book',
  'doc-review',
];

/**
 * Well-known file names used across the codebase
 */
export const FILE_NAMES = {
  HISTORY: '.achilles-cli-history',
  TSKILL_GENERATED: 'tskill.generated.mjs',
};

/**
 * Valid skill file names recognized by the system
 */
export const SKILL_FILE_NAMES = [
  'SKILL.md',
  'dcgskill.md',
  'cskill.md',
  'mskill.md',
  'oskill.md',
  'tskill.md',
];

/**
 * Generated file extensions
 */
export const FILE_EXTENSIONS = {
};

/**
 * UI style/theme identifiers
 */
export const UI_STYLES = {
  CLAUDE_CODE: 'claude-code',
  MINIMAL: 'minimal',
};

/**
 * LLM execution tier names
 */
export const TIERS = {
  FAST: 'fast',
  PLAN: 'plan',
  WRITE: 'write',
  CODE: 'code',
  DEEP: 'deep',
  ULTRA: 'ultra',
};

/**
 * LLM response shape identifiers
 */
export const RESPONSE_SHAPES = {
  CODE: 'code',
  JSON: 'json',
};

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  DEFAULT: 60000,
  ORCHESTRATOR: 90000,
  DBTABLE: 60000,
  LLM_REQUEST: 120000,
};

/**
 * Configuration file version
 */
export const CONFIG_VERSION = 1;

/**
 * Default configuration values
 */
export const DEFAULTS = {
  UI_STYLE: UI_STYLES.CLAUDE_CODE,
  ORCHESTRATOR_MODE: TIERS.FAST,
  HISTORY_MAX_ENTRIES: 1000,
  MAX_VISIBLE_ITEMS: 15,
};

/**
 * Error codes for typed errors
 */
export const ERROR_CODES = {
  // Configuration errors
  CONFIG_ERROR: 'CONFIG_ERROR',
  REPO_CONFIG_ERROR: 'REPO_CONFIG_ERROR',

  // Operation errors
  OPERATION_ERROR: 'OPERATION_ERROR',
  GIT_ERROR: 'GIT_ERROR',
  SKILL_EXEC_ERROR: 'SKILL_EXEC_ERROR',
  SKILL_CANCELLED: 'SKILL_CANCELLED',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SCHEMA_VALIDATION_ERROR: 'SCHEMA_VALIDATION_ERROR',
  FIELD_VALIDATION_ERROR: 'FIELD_VALIDATION_ERROR',

  // Resource errors
  RESOURCE_ERROR: 'RESOURCE_ERROR',
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  REPO_NOT_FOUND: 'REPO_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
};

/**
 * Get all built-in skill names as an array
 * @returns {string[]}
 */
export function getAllBuiltInSkillNames() {
  return Object.values(BUILT_IN_SKILLS);
}

/**
 * Check if a skill name is a built-in skill
 * @param {string} skillName
 * @returns {boolean}
 */
export function isBuiltInSkill(skillName) {
  return getAllBuiltInSkillNames().includes(skillName);
}
