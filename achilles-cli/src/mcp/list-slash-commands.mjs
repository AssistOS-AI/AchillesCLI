#!/usr/bin/env node

import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve, sep } from 'node:path';
import { discoverSkills, discoverSkillsFromRoot } from 'achillesAgentLib/MainAgent';
import { parseSkillDocument } from 'achillesAgentLib/utils/skillDocumentParser.mjs';
import { buildSlashCommandCatalog } from '../repl/SlashCommandHandler.mjs';
import { getDisabledSkills, getSelectedModel } from '../lib/achillesSettings.mjs';
import { ConversationSessionStore } from '../lib/conversationSessionStore.mjs';
import { buildTaskCompletions } from '../lib/workspaceTasks.mjs';
import { loadSoulGatewayModels, toModelCompletions } from '../lib/soulGatewayModels.mjs';
import { PERMISSION_MODES } from '../permissions/protocol.mjs';

const OPTIONAL_SKILL_ARG_COMMANDS = new Set(['/test', '/run-tests']);
const NOOP_LOGGER = { debug() {}, warn() {}, info() {}, log() {}, error() {} };
const BUILT_IN_SKILLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const PERMISSION_MODE_COMPLETIONS = Object.freeze([
    {
        value: PERMISSION_MODES.ASK,
        label: PERMISSION_MODES.ASK,
        description: 'Ask before each new Bash command',
    },
    {
        value: PERMISSION_MODES.FULL,
        label: PERMISSION_MODES.FULL,
        description: 'Run Bash automatically inside the current workspace',
    },
]);

function normalizeHelpText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
}

function getSkillHelp(skill) {
    if (!skill?.filePath) {
        return '';
    }
    const descriptor = parseSkillDocument(skill.filePath);
    return normalizeHelpText(descriptor?.sections?.help);
}

function isDirectory(candidate) {
    try {
        return statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

function discoverBuiltInSkills() {
    if (!isDirectory(BUILT_IN_SKILLS_DIR)) {
        return [];
    }
    return discoverSkillsFromRoot(BUILT_IN_SKILLS_DIR, { logger: NOOP_LOGGER })
        .map((skill) => ({ ...skill, isInternal: true }));
}

function discoverAvailableSkills(dir) {
    return [
        ...discoverSkills(dir || process.cwd(), { logger: NOOP_LOGGER }),
        ...discoverBuiltInSkills(),
    ];
}

export function buildAchillesSkillCatalog(dir) {
    const catalog = new Map();
    const workspaceDir = dir || process.env.WORKSPACE_PATH || process.cwd();
    for (const skill of discoverAvailableSkills(workspaceDir)) {
        const key = String(skill?.name || skill?.shortName || '').trim().toLowerCase();
        const name = String(skill?.shortName || skill?.name || '').trim();
        if (!key || !name || catalog.has(key)) {
            continue;
        }
        catalog.set(key, {
            key,
            name,
            type: String(skill?.type || '').trim(),
            isInternal: Boolean(skill?.isInternal),
        });
    }
    return {
        skills: Array.from(catalog.values())
            .sort((left, right) => left.name.localeCompare(right.name)),
    };
}

function readStdin() {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }

        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(data));
    });
}

function parsePayload(raw) {
    const text = String(raw || '').trim();
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

function extractInput(payload) {
    if (!payload || typeof payload !== 'object') {
        return {};
    }
    if (payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)) {
        return payload.input;
    }
    if (payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)) {
        return payload.arguments;
    }
    if (payload.params?.arguments && typeof payload.params.arguments === 'object' && !Array.isArray(payload.params.arguments)) {
        return payload.params.arguments;
    }
    return {};
}

export function buildSkillCompletions(dir, { includeDisabled = false } = {}) {
    const disabledNames = includeDisabled || !dir ? new Set() : new Set(getDisabledSkills(dir));
    const skills = discoverAvailableSkills(dir)
        .filter((skill) => !disabledNames.has(skill.name));
    const completions = new Map();
    for (const skill of skills) {
        const name = String(skill?.shortName || skill?.name || '').trim();
        if (name) {
            const current = completions.get(name);
            const help = getSkillHelp(skill);
            if (!current || (!current.description && help)) {
                completions.set(name, {
                    value: name,
                    label: name,
                    description: help,
                });
            }
        }
    }
    return Array.from(completions.values())
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function buildSkillDirectoryCompletions(dir) {
    if (!dir) return [];
    const root = resolve(dir);
    const directories = new Set();
    for (const skill of discoverSkills(root, { logger: NOOP_LOGGER })) {
        let current = relative(root, skill.skillDir);
        while (current && current !== '..' && !current.startsWith(`..${sep}`)) {
            directories.add(current.split(sep).join('/'));
            const parent = dirname(current);
            if (!parent || parent === '.' || parent === current) break;
            current = parent;
        }
    }
    return [...directories].sort().map((directory) => ({
        value: directory,
        label: directory,
        description: 'Toggle all registered skills below this directory',
    }));
}

function commandUsesSkillArgument(command) {
    return Boolean(command?.needsSkillArg) || OPTIONAL_SKILL_ARG_COMMANDS.has(command?.name);
}

export function buildSessionCompletions(dir) {
    if (!dir) return [];
    try {
        const payload = new ConversationSessionStore({ workingDir: dir }).listSessions();
        return payload.sessions.map((session) => ({
            value: session.sessionId,
            label: session.preview || 'New session',
            description: [
                session.sessionId === payload.currentSessionId ? 'Current session' : '',
                session.sessionId,
                session.updatedAt,
            ].filter(Boolean).join(' · '),
        }));
    } catch {
        return [];
    }
}

export function buildTaskActionCompletions(dir, action) {
    if (!dir) return [];
    try { return buildTaskCompletions(dir, action); } catch { return []; }
}

function buildArgCompletions(command, skillCompletions, modelCompletions) {
    if (command?.name === '/model') {
        return modelCompletions;
    }
    if (command?.name === '/permissions') {
        return PERMISSION_MODE_COMPLETIONS;
    }
    if (!commandUsesSkillArgument(command)) {
        return [];
    }
    if (command?.name === '/run-tests') {
        return [
            { value: 'all', label: 'all', description: 'Run all tests' },
            ...skillCompletions,
        ];
    }
    return skillCompletions;
}

export function toAutocompleteCatalog(options = {}) {
    const skillCompletions = buildSkillCompletions(options.dir);
    const allSkillCompletions = buildSkillCompletions(options.dir, { includeDisabled: true });
    const modelCompletions = Array.isArray(options.modelCompletions)
        ? options.modelCompletions
        : [];
    const sessionCompletions = Array.isArray(options.sessionCompletions)
        ? options.sessionCompletions
        : [];
    const taskCompletions = options.taskCompletions && typeof options.taskCompletions === 'object'
        ? options.taskCompletions
        : {};
    const skillDirectoryCompletions = Array.isArray(options.skillDirectoryCompletions)
        ? options.skillDirectoryCompletions
        : [];
    const commands = buildSlashCommandCatalog().map((command) => ({
        name: command.name,
        usage: command.usage,
        description: command.description,
        argMatchMode: command.argMatchMode,
        argSuggestionLimit: command.argSuggestionLimit,
        subCommands: Array.isArray(command.subCommands)
            ? command.subCommands.map((subCommand) => {
                const isSessionResume = command.name === '/session' && subCommand.name === 'resume';
                const isTaskAction = command.name === '/task';
                const isSkillsDirectoryAction = command.name === '/skills';
                const isSkillEnableAction = command.name === '/skill' && subCommand.name === 'enable';
                return {
                    name: subCommand.name,
                    usage: subCommand.usage,
                    description: subCommand.description,
                    argCompletions: isSessionResume
                        ? sessionCompletions
                        : (isTaskAction
                            ? (taskCompletions[subCommand.name] || [])
                            : (isSkillsDirectoryAction
                                ? skillDirectoryCompletions
                                : (isSkillEnableAction
                                    ? allSkillCompletions
                                    : (subCommand.needsSkillArg ? skillCompletions : [])))),
                };
            })
            : [],
        argCompletions: buildArgCompletions(command, skillCompletions, modelCompletions),
    }));

    return {
        type: 'achilles-slash-command-catalog',
        version: 1,
        commands,
    };
}

export async function loadAutocompleteCatalog(options = {}) {
    const selectedModel = options.dir ? getSelectedModel(options.dir) : null;
    let models = [];
    try {
        models = await loadSoulGatewayModels({ selectedModel });
    } catch {
        // Keep the command catalog available when Soul Gateway is starting.
    }
    return toAutocompleteCatalog({
        ...options,
        modelCompletions: toModelCompletions(models),
        sessionCompletions: buildSessionCompletions(options.dir),
        skillDirectoryCompletions: buildSkillDirectoryCompletions(options.dir),
        taskCompletions: {
            view: buildTaskActionCompletions(options.dir, 'view'),
            continue: buildTaskActionCompletions(options.dir, 'continue'),
            stop: buildTaskActionCompletions(options.dir, 'stop'),
            model: buildTaskActionCompletions(options.dir, 'model'),
            login: buildTaskActionCompletions(options.dir, 'login'),
        },
    });
}

async function main() {
    const payload = parsePayload(await readStdin());
    const input = extractInput(payload);
    process.stdout.write(`${JSON.stringify(await loadAutocompleteCatalog({ dir: input.dir }))}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    await main();
}
