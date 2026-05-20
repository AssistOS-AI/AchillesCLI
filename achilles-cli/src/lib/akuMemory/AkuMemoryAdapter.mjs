import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { analyzeAKUMemoryIntent } from './akuIntentAnalyzer.mjs';
import { buildAKUPlanningPacket } from './akuPlanningPacket.mjs';
import { applyAKUTypePolicyDefaults } from './akuTypePolicies.mjs';
import { createAKUSessionState } from './akuSessionState.mjs';

const require = createRequire(import.meta.url);
const HIGH_IMPACT_OPERATIONS = new Set([
    'updateKUState',
    'setKUStatus',
    'discardKU',
    'deleteKU',
    'update_state',
    'set_status',
    'discard',
    'delete',
]);
const SENSITIVE_KEY_RE = /(secret|password|credential|token|private[_-]?key|api[_-]?key|hidden[_-]?reasoning|chain[_-]?of[_-]?thought|raw[_-]?prompt|private[_-]?prompt|content)$/i;

export class AkuMemoryAdapter {
    constructor(options = {}) {
        this.rootDir = path.resolve(options.rootDir ?? options.workingDir ?? process.cwd());
        this.workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null;
        this.actor = options.actor ?? 'achilles-cli';
        this.contextBudgetChars = options.contextBudgetChars ?? 5000;
        this.AgenticKnowledgeUnitsClass = options.AgenticKnowledgeUnitsClass ?? null;
        this.logger = options.logger ?? null;
        this.sessionState = options.sessionState && typeof options.sessionState.rememberActiveKU === 'function'
            ? options.sessionState
            : createAKUSessionState(options.sessionState ?? {});
        this.akuByRoot = new Map();
    }

    async preparePromptMemory(packetInput, options = {}) {
        const packet = typeof packetInput === 'string'
            ? buildAKUPlanningPacket({
                prompt: packetInput,
                workingDir: this.rootDir,
                workspaceRoot: this.workspaceRoot ?? this.rootDir,
                previousSessionState: this.sessionState.toJSON(),
            })
            : packetInput?.promptText || packetInput?.rawUserText
            ? packetInput
            : buildAKUPlanningPacket({
                ...packetInput,
                workingDir: packetInput?.workingDir ?? this.rootDir,
                workspaceRoot: packetInput?.workspaceRoot ?? this.workspaceRoot ?? this.rootDir,
                previousSessionState: packetInput?.previousSessionState ?? this.sessionState.toJSON(),
            });
        const intentPlan = options.intentPlan ?? analyzeAKUMemoryIntent(packet);
        const rootDir = this.resolveRootDir(packet, options);
        const aku = await this.getAKU(rootDir);
        const diagnostics = [];
        let exists = false;

        try {
            exists = await aku.exists();
        } catch (error) {
            diagnostics.push(`AKU exists() failed: ${error.message}`);
            return this.emptyPreflight({ packet, intentPlan, rootDir, diagnostics, enabled: false });
        }

        const output = {
            enabled: Boolean(exists || intentPlan.shouldUseAKU || options.enabled),
            initialized: exists,
            rootDir,
            packet,
            intentPlan,
            contextPack: null,
            candidates: [],
            activeScope: this.resolveActiveScope(packet, intentPlan),
            diagnostics,
        };

        if (!exists) {
            diagnostics.push(intentPlan.shouldInitializeAKU
                ? 'AKU is not initialized; durable memory action may initialize it later.'
                : 'AKU is not initialized; ordinary prompt execution can continue.');
            return output;
        }

        try {
            await aku.loadAKU();
            const query = buildSearchQuery(packet, intentPlan);
            const hasScopedSignal = Boolean(
                output.activeScope.activeKuId
                    || output.activeScope.explicitKuIds.length
                    || output.activeScope.folderPath,
            );
            const search = query
                ? await aku.search(query, {
                    explain: true,
                    limit: options.searchLimit ?? 8,
                    maxResultsPerKU: options.maxResultsPerKU ?? 3,
                })
                : { results: [] };
            output.candidates = search.results ?? [];
            output.contextPack = query
                ? hasScopedSignal
                    ? await aku.buildScopedContextPack(query, {
                        activeKuId: output.activeScope.activeKuId,
                        explicitKuIds: output.activeScope.explicitKuIds,
                        folderPath: output.activeScope.folderPath,
                        budgetChars: options.budgetChars ?? this.contextBudgetChars,
                        explain: true,
                        maxResultsPerKU: options.maxResultsPerKU ?? 3,
                    })
                    : await aku.buildContextPack(query, {
                        budgetChars: options.budgetChars ?? this.contextBudgetChars,
                        explain: true,
                        maxResultsPerKU: options.maxResultsPerKU ?? 3,
                    })
                : null;
        } catch (error) {
            diagnostics.push(`AKU preflight failed: ${error.message}`);
        }

        return output;
    }

    createActionSurface() {
        return {
            initializeAKU: (metadata) => this.initializeAKU(metadata),
            createKU: (metadata) => this.createKU(metadata),
            resolveKUCandidates: (query, options) => this.resolveKUCandidates(query, options),
            updateKUState: (kuId, update, options) => this.updateKUState(kuId, update, options),
            setKUStatus: (kuId, status, reason, options) => this.setKUStatus(kuId, status, reason, options),
            recordEvent: (kuId, event) => this.recordEvent(kuId, event),
            recordDocument: (kuId, document) => this.recordDocument(kuId, document),
            registerFile: (kuId, file) => this.registerFile(kuId, file),
            recordResult: (kuId, result) => this.recordResult(kuId, result),
            recordRun: (kuId, run) => this.recordRun(kuId, run),
            recordValidation: (kuId, validation) => this.recordValidation(kuId, validation),
            registerFolderScope: (kuId, folder) => this.registerFolderScope(kuId, folder),
            linkKU: (sourceKuId, targetKuId, link) => this.linkKU(sourceKuId, targetKuId, link),
            buildScopedContext: (query, options) => this.buildScopedContext(query, options),
            executeAction: (action, options) => this.executeAction(action, options),
            executeIntentPlan: (intentPlan, options) => this.executeIntentPlan(intentPlan, options),
        };
    }

    async executeAction(action = {}, options = {}) {
        const operation = String(action.operation ?? action.type ?? '').trim();
        if (!operation) {
            return { ok: false, error: 'Missing AKU memory action operation.' };
        }
        const disambiguation = this.checkMutationAmbiguity(operation, action, options);
        if (disambiguation) {
            return disambiguation;
        }

        try {
            switch (operation) {
                case 'initialize':
                case 'initAKU':
                    return { ok: true, result: await this.initializeAKU(action.metadata ?? action) };
                case 'create':
                case 'createKU':
                case 'initKU':
                    return { ok: true, result: await this.createKU(action.metadata ?? action) };
                case 'resolve':
                case 'search':
                    return { ok: true, result: await this.resolveKUCandidates(action.query ?? action.text ?? '', action.options ?? options) };
                case 'update':
                case 'update_state':
                case 'updateKUState':
                    return { ok: true, result: await this.updateKUState(action.kuId ?? action.ku_id, action.update ?? action, options) };
                case 'set_status':
                case 'setKUStatus':
                    return { ok: true, result: await this.setKUStatus(action.kuId ?? action.ku_id, action.status, action.reason, options) };
                case 'record_event':
                case 'recordEvent':
                    return { ok: true, result: await this.recordEvent(action.kuId ?? action.ku_id, action.event ?? action) };
                case 'record_document':
                case 'recordDocument':
                    return { ok: true, result: await this.recordDocument(action.kuId ?? action.ku_id, action.document ?? action) };
                case 'register_file':
                case 'registerFile':
                    return { ok: true, result: await this.registerFile(action.kuId ?? action.ku_id, action.file ?? action) };
                case 'record_result':
                case 'recordResult':
                    return { ok: true, result: await this.recordResult(action.kuId ?? action.ku_id, action.result ?? action) };
                case 'record_run':
                case 'recordRun':
                    return { ok: true, result: await this.recordRun(action.kuId ?? action.ku_id, action.run ?? action) };
                case 'record_validation':
                case 'recordValidation':
                    return { ok: true, result: await this.recordValidation(action.kuId ?? action.ku_id, action.validation ?? action) };
                case 'register_folder_scope':
                case 'registerFolderScope':
                    return { ok: true, result: await this.registerFolderScope(action.kuId ?? action.ku_id, action.folder ?? action) };
                case 'link':
                case 'linkKU':
                    return { ok: true, result: await this.linkKU(action.sourceKuId ?? action.source_ku_id, action.targetKuId ?? action.target_ku_id, action.link ?? action) };
                case 'build_scoped_context':
                case 'buildScopedContext':
                    return { ok: true, result: await this.buildScopedContext(action.query ?? '', action.options ?? options) };
                default:
                    return { ok: false, error: `Unsupported AKU memory action: ${operation}` };
            }
        } catch (error) {
            return {
                ok: false,
                error: error.message,
            };
        }
    }

    async executeIntentPlan(intentPlan = {}, options = {}) {
        if (intentPlan.ambiguity?.requiresDisambiguation) {
            return {
                ok: false,
                requiresDisambiguation: true,
                ambiguity: intentPlan.ambiguity,
            };
        }
        const durableUnits = Array.isArray(intentPlan.durableUnits) ? intentPlan.durableUnits : [];
        if (!durableUnits.length) {
            return { ok: true, createdKUs: [], links: [], folderScopes: [] };
        }

        await this.ensureInitialized(options.initMetadata);
        const createdKUs = [];
        const reusedKUs = [];
        const links = [];
        const folderScopes = [];
        let parent = null;

        for (const unit of durableUnits) {
            const metadata = this.metadataForDurableUnit(unit, parent);
            const existing = await this.findExistingDurableKU(unit, parent);
            const manifest = existing ?? await this.createKU(metadata);
            const created = {
                ...manifest,
                ku_name: manifest.ku_name ?? manifest.title ?? metadata.ku_name,
                ku_type: manifest.ku_type ?? manifest.type ?? metadata.ku_type,
                label: unit.label,
                scopeRole: unit.scopeRole ?? null,
                folderPath: unit.folderPath ?? null,
            };
            if (existing) {
                reusedKUs.push(created);
            } else {
                createdKUs.push(created);
            }

            if (unit.scopeRole === 'folder_scoped_parent') {
                parent = created;
                if (unit.folderPath) {
                    try {
                        folderScopes.push(await this.ensureFolderScopeRegistered(manifest.ku_id, {
                            path: unit.folderPath,
                            title: `Folder scope: ${unit.folderPath}`,
                            summary: `Folder scope for ${unit.label}`,
                            tags: ['folder-scope'],
                            keywords: [unit.folderPath, unit.label],
                        }));
                    } catch (error) {
                        folderScopes.push({
                            error: error.message,
                            path: unit.folderPath,
                            ku_id: manifest.ku_id,
                        });
                    }
                }
                this.sessionState.rememberActiveKU(created, {
                    scopeRole: unit.scopeRole,
                    folderPath: unit.folderPath,
                });
                continue;
            }

            if (parent) {
                links.push(await this.ensureKULink(parent.ku_id, manifest.ku_id, {
                    relation: 'contains',
                    title: `${parent.ku_name} contains ${created.ku_name}`,
                    summary: `${parent.ku_name} contains ${created.ku_name}`,
                    tags: ['contains'],
                    keywords: [manifest.ku_type, unit.label],
                }));
            }
            if (unit.ordinal) {
                this.sessionState.rememberOrdinal(`${unit.kuType} ${unit.ordinal}`, manifest.ku_id);
            }
        }

        const outcome = {
            ok: true,
            createdKUs,
            reusedKUs,
            links,
            folderScopes,
            activeKuId: parent?.ku_id ?? createdKUs.at(-1)?.ku_id ?? reusedKUs.at(-1)?.ku_id ?? null,
        };
        this.sessionState.updateFromActionOutcome(outcome);
        return outcome;
    }

    async initializeAKU(metadata = {}) {
        const aku = await this.getAKU();
        if (await aku.exists()) {
            return { alreadyExists: true };
        }
        assertSafePayload(metadata);
        return aku.initAKU({
            name: 'AchillesCLI AKU memory',
            ...metadata,
        });
    }

    async createKU(metadata = {}) {
        await this.ensureInitialized();
        assertSafePayload(metadata);
        const aku = await this.getAKU();
        const manifest = await aku.initKU(applyAKUTypePolicyDefaults({
            ku_name: metadata.ku_name ?? metadata.title ?? metadata.label ?? 'Knowledge Unit',
            summary: metadata.summary ?? '',
            ...metadata,
        }));
        this.sessionState.rememberActiveKU(manifest);
        return manifest;
    }

    async resolveKUCandidates(query, options = {}) {
        const aku = await this.getLoadedAKU();
        return aku.search(query, {
            explain: true,
            limit: options.limit ?? 8,
            ...options,
        });
    }

    async updateKUState(kuId, update = {}, options = {}) {
        const disambiguation = this.checkMutationAmbiguity('updateKUState', { kuId, update }, options);
        if (disambiguation) {
            return disambiguation;
        }
        assertSafePayload(update);
        const aku = await this.getLoadedAKU();
        return aku.updateKUState(kuId, update);
    }

    async setKUStatus(kuId, status, reason = '', options = {}) {
        const disambiguation = this.checkMutationAmbiguity('setKUStatus', { kuId, status, reason }, options);
        if (disambiguation) {
            return disambiguation;
        }
        const aku = await this.getLoadedAKU();
        return aku.setKUStatus(kuId, status, reason);
    }

    async recordEvent(kuId, event = {}) {
        assertSafePayload(event);
        const aku = await this.getLoadedAKU();
        return aku.recordEvent(kuId, event);
    }

    async recordDocument(kuId, document = {}) {
        assertSafePayload(document);
        const aku = await this.getLoadedAKU();
        return aku.recordDocument(kuId, document);
    }

    async registerFile(kuId, file = {}) {
        assertSafePayload(file);
        const aku = await this.getLoadedAKU();
        return aku.registerFile(kuId, file);
    }

    async recordResult(kuId, result = {}) {
        assertSafePayload(result);
        const aku = await this.getLoadedAKU();
        return aku.recordResult(kuId, result);
    }

    async recordRun(kuId, run = {}) {
        assertSafePayload(run);
        const aku = await this.getLoadedAKU();
        return aku.recordRun(kuId, run);
    }

    async recordValidation(kuId, validation = {}) {
        assertSafePayload(validation);
        const aku = await this.getLoadedAKU();
        return aku.recordValidation(kuId, validation);
    }

    async registerFolderScope(kuId, folder = {}) {
        assertSafePayload(folder);
        const aku = await this.getLoadedAKU();
        return aku.registerFolderScope(kuId, folder);
    }

    async linkKU(sourceKuId, targetKuId, link = {}) {
        assertSafePayload(link);
        const aku = await this.getLoadedAKU();
        return aku.linkKU(sourceKuId, targetKuId, link);
    }

    async findExistingDurableKU(unit = {}, parent = null) {
        const kuType = unit.kuType || unit.ku_type || 'knowledge_unit';
        const label = unit.label || unit.summary || kuType;
        const normalizedLabel = normalizeComparable(label);
        if (!normalizedLabel) {
            return null;
        }
        const aku = await this.getLoadedAKU();
        const records = await aku.listKUs({ kuType });
        const candidates = records.filter((record) => {
            if (parent && record.parent_ku_id !== parent.ku_id) {
                return false;
            }
            const title = record.ku_name ?? record.title ?? record.name;
            const titleMatches = normalizeComparable(title) === normalizedLabel;
            const keywordMatches = asArray(record.keywords).some((keyword) => normalizeComparable(keyword) === normalizedLabel);
            return titleMatches || keywordMatches;
        });
        return candidates
            .sort((a, b) => String(a.ku_id).localeCompare(String(b.ku_id)))[0] ?? null;
    }

    async ensureFolderScopeRegistered(kuId, folder = {}) {
        const aku = await this.getLoadedAKU();
        const expectedPath = normalizePathForCompare(folder.path);
        const existing = (await aku.listFolderScopes({ kuId }))
            .find((record) => normalizePathForCompare(record.path) === expectedPath);
        if (existing) {
            return { ...existing, reused: true };
        }
        return this.registerFolderScope(kuId, folder);
    }

    async ensureKULink(sourceKuId, targetKuId, link = {}) {
        const aku = await this.getLoadedAKU();
        const relation = String(link.relation ?? 'references').trim();
        const existing = (await aku.listKULinks(sourceKuId))
            .find((record) => record.target_ku_id === targetKuId && record.relation === relation);
        if (existing) {
            return { ...existing, reused: true };
        }
        return this.linkKU(sourceKuId, targetKuId, link);
    }

    async buildScopedContext(query, options = {}) {
        const aku = await this.getLoadedAKU();
        return aku.buildScopedContextPack(query, options);
    }

    async ensureInitialized(metadata = {}) {
        const aku = await this.getAKU();
        if (!(await aku.exists())) {
            await this.initializeAKU(metadata);
        } else {
            await aku.loadAKU();
        }
        return aku;
    }

    async getLoadedAKU(rootDir = this.rootDir) {
        const aku = await this.getAKU(rootDir);
        if (!(await aku.exists())) {
            throw new Error('AKU is not initialized.');
        }
        await aku.loadAKU();
        return aku;
    }

    async getAKU(rootDir = this.rootDir) {
        const resolvedRoot = path.resolve(rootDir);
        if (this.akuByRoot.has(resolvedRoot)) {
            return this.akuByRoot.get(resolvedRoot);
        }
        const AgenticKnowledgeUnits = this.AgenticKnowledgeUnitsClass
            ?? await loadDefaultAgenticKnowledgeUnits();
        const aku = new AgenticKnowledgeUnits({
            rootDir: resolvedRoot,
            actor: this.actor,
            contextBudgetChars: this.contextBudgetChars,
        });
        this.akuByRoot.set(resolvedRoot, aku);
        return aku;
    }

    resolveRootDir(packet, options = {}) {
        return path.resolve(
            options.rootDir
                ?? packet.workspaceRoot
                ?? packet.workingDir
                ?? this.workspaceRoot
                ?? this.rootDir,
        );
    }

    resolveActiveScope(packet, intentPlan) {
        const previous = packet.previousSessionState && typeof packet.previousSessionState === 'object'
            ? packet.previousSessionState
            : this.sessionState.toJSON();
        const activeKuId = previous.activeKuId ?? previous.active_ku_id ?? previous.activeScope?.kuId ?? null;
        const ordinalKuIds = resolveOrdinalLabelKuIds(previous, intentPlan, packet);
        const explicitKuIds = uniqueStrings([
            ...asArray(intentPlan.explicitKuIds),
            ...ordinalKuIds,
            ...asArray(previous.activeScope?.kuId),
        ]).filter((kuId) => kuId !== activeKuId);
        return {
            activeKuId,
            explicitKuIds,
            folderPath: packet.folderScopeHint?.path ?? previous.activeScope?.folderPath ?? null,
        };
    }

    metadataForDurableUnit(unit, parent) {
        const kuType = unit.kuType || unit.ku_type || 'knowledge_unit';
        const name = unit.label || unit.summary || kuType;
        return applyAKUTypePolicyDefaults({
            ku_name: name,
            ku_type: kuType,
            summary: unit.summary || `Durable ${kuType}: ${name}`,
            parent_ku_id: parent?.ku_id ?? null,
            tags: [
                unit.scopeRole === 'folder_scoped_parent' ? 'folder-scope' : null,
                unit.ordinal ? `ordinal-${unit.ordinal}` : null,
            ].filter(Boolean),
            keywords: [
                name,
                unit.folderPath,
                unit.ordinal ? `${kuType} ${unit.ordinal}` : null,
            ].filter(Boolean),
            source_operation: 'achilles_cli_memory_action',
        });
    }

    emptyPreflight({ packet, intentPlan, rootDir, diagnostics, enabled }) {
        return {
            enabled,
            initialized: false,
            rootDir,
            packet,
            intentPlan,
            contextPack: null,
            candidates: [],
            activeScope: this.resolveActiveScope(packet, intentPlan),
            diagnostics,
        };
    }

    checkMutationAmbiguity(operation, action = {}, options = {}) {
        if (!HIGH_IMPACT_OPERATIONS.has(operation)) {
            return null;
        }
        if (options.intentPlan?.ambiguity?.requiresDisambiguation) {
            return {
                ok: false,
                requiresDisambiguation: true,
                ambiguity: options.intentPlan.ambiguity,
            };
        }
        const kuId = action.kuId ?? action.ku_id;
        const targetCount = asArray(action.candidateKuIds ?? action.candidate_ku_ids).length;
        if (!kuId && targetCount !== 1) {
            return {
                ok: false,
                requiresDisambiguation: true,
                ambiguity: {
                    requiresDisambiguation: true,
                    impact: 'high',
                    reason: 'Mutation action requires one resolved Knowledge Unit target.',
                },
            };
        }
        return null;
    }
}

export async function loadDefaultAgenticKnowledgeUnits() {
    try {
        const mod = await import('achillesAgentLib/AgenticKnowledgeUnits');
        return mod.AgenticKnowledgeUnits;
    } catch (_) {
        try {
            const packagePath = require.resolve('achillesAgentLib/package.json');
            const mod = await import(pathToFileURL(path.join(path.dirname(packagePath), 'AgenticKnowledgeUnits', 'index.mjs')).href);
            return mod.AgenticKnowledgeUnits;
        } catch {
            const fallback = findWorkspaceAgenticKnowledgeUnits();
            const mod = await import(pathToFileURL(fallback).href);
            return mod.AgenticKnowledgeUnits;
        }
    }
}

export function buildSearchQuery(packet, intentPlan) {
    return uniqueStrings([
        packet.rawUserText,
        packet.promptText,
        ...asArray(intentPlan.readQueries).map((query) => query.query),
        ...asArray(intentPlan.ordinalLabels).map((label) => label.raw || label.label),
        ...asArray(intentPlan.durableUnits).map((unit) => `${unit.label} ${unit.kuType}`),
        ...asArray(packet.pathReferences).map((reference) => `${reference.label ?? ''} ${reference.path}`),
        packet.folderScopeHint?.path,
    ]).join('\n');
}

export function assertSafePayload(value, pathParts = []) {
    if (value === undefined || value === null) {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertSafePayload(item, [...pathParts, String(index)]));
        return;
    }
    if (typeof value !== 'object') {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (SENSITIVE_KEY_RE.test(key)) {
            throw new Error(`Refusing to persist sensitive AKU field: ${[...pathParts, key].join('.')}`);
        }
        assertSafePayload(child, [...pathParts, key]);
    }
}

function findWorkspaceAgenticKnowledgeUnits() {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 12; depth += 1) {
        const candidate = path.join(dir, 'ploinky', 'node_modules', 'achillesAgentLib', 'AgenticKnowledgeUnits', 'index.mjs');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    throw new Error('Unable to resolve AgenticKnowledgeUnits module.');
}

function asArray(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function uniqueStrings(values = []) {
    return [...new Set(values
        .map((value) => String(value ?? '').trim())
        .filter(Boolean))];
}

function resolveOrdinalLabelKuIds(previous = {}, intentPlan = {}, packet = {}) {
    const ordinalLabels = previous.ordinalLabels ?? previous.ordinal_labels ?? {};
    if (!ordinalLabels || typeof ordinalLabels !== 'object' || Array.isArray(ordinalLabels)) {
        return [];
    }
    const requestedLabels = new Set();
    for (const label of asArray(intentPlan.ordinalLabels)) {
        requestedLabels.add(normalizeComparable(label.label));
        requestedLabels.add(normalizeComparable(label.raw));
    }
    const promptText = normalizeComparable(`${packet.rawUserText ?? ''} ${packet.promptText ?? ''}`);
    const matches = [];
    for (const [label, kuId] of Object.entries(ordinalLabels)) {
        const normalizedLabel = normalizeComparable(label);
        if (!normalizedLabel || !kuId) {
            continue;
        }
        if (requestedLabels.has(normalizedLabel) || promptText.includes(normalizedLabel)) {
            matches.push(kuId);
        }
    }
    return matches;
}

function normalizeComparable(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');
}

function normalizePathForCompare(value) {
    return String(value ?? '')
        .trim()
        .replace(/\\+/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

export default AkuMemoryAdapter;
