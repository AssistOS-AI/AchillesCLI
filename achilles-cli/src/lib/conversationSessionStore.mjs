import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
    getCurrentSessionId,
    setCurrentSessionId,
} from './achillesSettings.mjs';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_ID_RE = /^task_[0-9a-f]{24}$/;
const SESSION_STORE_GITIGNORE = '*\n!.gitignore\n';

function isInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertRegularFileOrMissing(filePath) {
    try {
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error('unsafe_session_file');
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

function assertSessionId(sessionId) {
    const normalized = String(sessionId || '').trim().toLowerCase();
    if (!SESSION_ID_RE.test(normalized)) throw new Error('invalid_session_id');
    return normalized;
}

function atomicWriteJson(filePath, value) {
    assertRegularFileOrMissing(filePath);
    const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
            flag: 'wx',
        });
        fs.renameSync(temporaryPath, filePath);
    } finally {
        try {
            fs.unlinkSync(temporaryPath);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }
}

function normalizeConversationMessage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.type === 'task') {
        const taskId = String(raw.taskId || '').trim();
        return TASK_ID_RE.test(taskId) ? { type: 'task', taskId } : null;
    }
    const role = raw.role === 'user' ? 'user' : (raw.role === 'assistant' ? 'assistant' : '');
    if (!role) return null;
    const message = {
        role,
        text: typeof raw.text === 'string' ? raw.text : '',
        timestamp: typeof raw.timestamp === 'string' && Number.isFinite(Date.parse(raw.timestamp))
            ? raw.timestamp
            : new Date(0).toISOString(),
        attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
        references: Array.isArray(raw.references) ? raw.references : [],
    };
    if (role === 'assistant' && Array.isArray(raw.progress)) {
        message.progress = raw.progress
            .filter((entry) => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return message;
}

function normalizeSession(raw, expectedId = '') {
    if (!raw || typeof raw !== 'object') throw new Error('invalid_session_file');
    const sessionId = assertSessionId(raw.sessionId);
    if (expectedId && sessionId !== assertSessionId(expectedId)) throw new Error('invalid_session_file');
    const createdAt = typeof raw.createdAt === 'string' && Number.isFinite(Date.parse(raw.createdAt))
        ? raw.createdAt
        : new Date(0).toISOString();
    const updatedAt = typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
        ? raw.updatedAt
        : createdAt;
    return {
        sessionId,
        createdAt,
        updatedAt,
        messages: Array.isArray(raw.messages)
            ? raw.messages.map(normalizeConversationMessage).filter(Boolean)
            : [],
    };
}

function formatHistoryMessage(message) {
    const parts = [String(message?.text || '').trim()];
    if (message?.attachments?.length) {
        parts.push(`Attachments: ${JSON.stringify(message.attachments)}`);
    }
    if (message?.references?.length) {
        parts.push(`References: ${JSON.stringify(message.references)}`);
    }
    return parts.filter(Boolean).join('\n\n');
}

export function summarizeConversationSession(session) {
    const firstUser = session?.messages?.find((message) => (
        message?.role === 'user' && String(message.text || '').trim()
    ));
    const preview = String(firstUser?.text || 'New session').replace(/\s+/g, ' ').trim();
    return {
        sessionId: session.sessionId,
        preview: preview.length > 96 ? `${preview.slice(0, 93)}...` : preview,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        hasHistory: session.messages.some((message) => (
            message?.role === 'user' || (message?.role === 'assistant' && String(message.text || '').trim())
        )),
    };
}

export function buildConversationInitialHistory(session) {
    const history = [];
    for (const message of session?.messages || []) {
        if (message?.type === 'task') continue;
        const role = message?.role === 'user'
            ? 'user'
            : (message?.role === 'assistant' ? 'assistant' : '');
        const formatted = formatHistoryMessage(message);
        if (role && formatted) history.push({ role, message: formatted });
    }
    return history;
}

export class ConversationSessionStore {
    constructor({ workingDir = process.cwd() } = {}) {
        this.workingDir = fs.realpathSync(path.resolve(workingDir));
        this.achillesDirectory = path.join(this.workingDir, '.achilles-cli');
        this.sessionsDirectory = path.join(this.achillesDirectory, 'sessions');
        this.ensureDirectory();
    }

    ensureDirectory() {
        fs.mkdirSync(this.achillesDirectory, { recursive: true, mode: 0o700 });
        try {
            const stat = fs.lstatSync(this.sessionsDirectory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_sessions_directory');
            const real = fs.realpathSync(this.sessionsDirectory);
            if (!isInside(this.workingDir, real)) throw new Error('unsafe_sessions_directory');
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            fs.mkdirSync(this.sessionsDirectory, { mode: 0o700 });
        }
        const gitignorePath = path.join(this.sessionsDirectory, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, SESSION_STORE_GITIGNORE, {
                encoding: 'utf8',
                mode: 0o600,
                flag: 'wx',
            });
        }
    }

    sessionPath(sessionId) {
        const normalized = assertSessionId(sessionId);
        const filePath = path.join(this.sessionsDirectory, `${normalized}.json`);
        if (!isInside(this.sessionsDirectory, filePath)) throw new Error('invalid_session_id');
        return filePath;
    }

    loadSession(sessionId) {
        const normalized = assertSessionId(sessionId);
        const filePath = this.sessionPath(normalized);
        assertRegularFileOrMissing(filePath);
        return normalizeSession(JSON.parse(fs.readFileSync(filePath, 'utf8')), normalized);
    }

    createSession() {
        const now = new Date().toISOString();
        const session = {
            sessionId: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
            messages: [],
        };
        atomicWriteJson(this.sessionPath(session.sessionId), session);
        setCurrentSessionId(this.workingDir, session.sessionId);
        return session;
    }

    ensureCurrentSession() {
        const currentSessionId = getCurrentSessionId(this.workingDir);
        if (currentSessionId) {
            try {
                return this.loadSession(currentSessionId);
            } catch (_) {
                // A missing or malformed selected session is repaired with a new session.
            }
        }
        return this.createSession();
    }

    resumeSession(sessionId) {
        const session = this.loadSession(sessionId);
        setCurrentSessionId(this.workingDir, session.sessionId);
        return session;
    }

    listSessions() {
        const current = this.ensureCurrentSession();
        const sessions = [];
        for (const entry of fs.readdirSync(this.sessionsDirectory, { withFileTypes: true })) {
            if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
            const sessionId = entry.name.slice(0, -5);
            if (!SESSION_ID_RE.test(sessionId)) continue;
            try {
                sessions.push(summarizeConversationSession(this.loadSession(sessionId)));
            } catch (_) {
                // Invalid session files are excluded from the selector.
            }
        }
        sessions.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
        return {
            currentSessionId: current.sessionId,
            current: summarizeConversationSession(current),
            sessions,
        };
    }

    updateSession(sessionId, updater) {
        const session = this.loadSession(sessionId);
        updater(session);
        session.updatedAt = new Date().toISOString();
        atomicWriteJson(this.sessionPath(session.sessionId), session);
        return session;
    }

    beginTurn({ text = '', attachments = [], references = [] } = {}) {
        const current = this.ensureCurrentSession();
        let userMessageIndex = -1;
        let assistantMessageIndex = -1;
        const timestamp = new Date().toISOString();
        const session = this.updateSession(current.sessionId, (record) => {
            userMessageIndex = record.messages.length;
            record.messages.push({
                role: 'user',
                text: typeof text === 'string' ? text : '',
                timestamp,
                attachments: Array.isArray(attachments) ? attachments : [],
                references: Array.isArray(references) ? references : [],
            });
            assistantMessageIndex = record.messages.length;
            record.messages.push({
                role: 'assistant',
                text: '',
                timestamp,
                attachments: [],
                references: [],
                progress: [],
            });
        });
        return { session, userMessageIndex, assistantMessageIndex };
    }

    appendProgress(sessionId, messageIndex, reason) {
        const progress = String(reason || '').trim();
        if (!progress) return this.loadSession(sessionId);
        return this.updateSession(sessionId, (record) => {
            const message = record.messages[messageIndex];
            if (!message || message.role !== 'assistant') throw new Error('assistant_message_not_found');
            if (!Array.isArray(message.progress)) message.progress = [];
            message.progress.push(progress);
        });
    }

    completeTurn(sessionId, messageIndex, text) {
        return this.updateSession(sessionId, (record) => {
            const message = record.messages[messageIndex];
            if (!message || message.role !== 'assistant') throw new Error('assistant_message_not_found');
            message.text = typeof text === 'string' ? text : String(text ?? '');
        });
    }

    insertTask(sessionId, assistantMessageIndex, taskId) {
        const normalizedTaskId = String(taskId || '').trim();
        if (!TASK_ID_RE.test(normalizedTaskId)) throw new Error('invalid_task_id');
        let messageIndex = -1;
        const session = this.updateSession(sessionId, (record) => {
            const assistant = record.messages[assistantMessageIndex];
            if (!assistant || assistant.role !== 'assistant') throw new Error('assistant_message_not_found');
            const existing = record.messages.findIndex((message) => (
                message?.type === 'task' && message.taskId === normalizedTaskId
            ));
            if (existing >= 0) {
                messageIndex = existing;
                return;
            }
            messageIndex = assistantMessageIndex + 1;
            while (record.messages[messageIndex]?.type === 'task') messageIndex += 1;
            record.messages.splice(messageIndex, 0, { type: 'task', taskId: normalizedTaskId });
        });
        return { session, messageIndex };
    }
}

export const __testables = {
    assertSessionId,
    normalizeSession,
};
