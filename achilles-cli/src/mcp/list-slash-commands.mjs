#!/usr/bin/env node

import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { discoverSkills, discoverSkillsFromRoot } from 'achillesAgentLib/MainAgent';
import { parseSkillDocument } from 'achillesAgentLib/utils/skillDocumentParser.mjs';
import { buildSlashCommandCatalog } from '../repl/SlashCommandHandler.mjs';
import { getSelectedModel } from '../lib/achillesSettings.mjs';
import { loadSoulGatewayModels, toModelCompletions } from '../lib/soulGatewayModels.mjs';

const OPTIONAL_SKILL_ARG_COMMANDS = new Set(['/test', '/run-tests']);
const NOOP_LOGGER = { debug() {}, warn() {}, info() {}, log() {}, error() {} };
const BUILT_IN_SKILLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

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

export function buildSkillCompletions(dir) {
    const skills = [
        ...discoverSkills(dir || process.cwd(), { logger: NOOP_LOGGER }),
        ...discoverBuiltInSkills(),
    ];
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

function commandUsesSkillArgument(command) {
    return Boolean(command?.needsSkillArg) || OPTIONAL_SKILL_ARG_COMMANDS.has(command?.name);
}

function buildArgCompletions(command, skillCompletions, modelCompletions) {
    if (command?.name === '/model') {
        return modelCompletions;
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
    const modelCompletions = Array.isArray(options.modelCompletions)
        ? options.modelCompletions
        : [];
    const commands = buildSlashCommandCatalog().map((command) => ({
        name: command.name,
        usage: command.usage,
        description: command.description,
        argMatchMode: command.argMatchMode,
        argSuggestionLimit: command.argSuggestionLimit,
        subCommands: Array.isArray(command.subCommands)
            ? command.subCommands.map((subCommand) => ({
                name: subCommand.name,
                usage: subCommand.usage,
                description: subCommand.description,
                argCompletions: subCommand.needsSkillArg ? skillCompletions : [],
            }))
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
