import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    buildConversationInitialHistory,
    ConversationSessionStore,
} from '../src/lib/conversationSessionStore.mjs';
import {
    createCurrentSessionEnvelope,
    createSelectedSessionEnvelope,
    createSessionListEnvelope,
} from '../src/lib/webchatSessionState.mjs';
import { getCurrentSessionId } from '../src/lib/achillesSettings.mjs';
import { SlashCommandHandler } from '../src/repl/SlashCommandHandler.mjs';

function workspace(t) {
    const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-conversations-'));
    t.after(() => fs.rmSync(workingDir, { recursive: true, force: true }));
    return workingDir;
}

test('AchillesCLI creates and restores workspace conversation sessions', (t) => {
    const workingDir = workspace(t);
    const store = new ConversationSessionStore({ workingDir });
    const created = store.ensureCurrentSession();
    const turn = store.beginTurn({
        text: 'Inspect the project',
        references: [{ kind: 'workspace-path', path: 'src/index.mjs' }],
    });
    store.appendProgress(turn.session.sessionId, turn.assistantMessageIndex, 'Reading files');
    store.completeTurn(turn.session.sessionId, turn.assistantMessageIndex, 'The project is ready.');
    store.insertTask(turn.session.sessionId, turn.assistantMessageIndex, 'task_1234567890abcdef12345678');

    const restored = new ConversationSessionStore({ workingDir }).ensureCurrentSession();
    assert.equal(restored.sessionId, created.sessionId);
    assert.equal(getCurrentSessionId(workingDir), created.sessionId);
    assert.equal(restored.messages[0].role, 'user');
    assert.deepEqual(restored.messages[1].progress, ['Reading files']);
    assert.deepEqual(restored.messages[2], { type: 'task', taskId: 'task_1234567890abcdef12345678' });
    assert.equal(fs.existsSync(path.join(workingDir, '.data', 'achilles-cli', 'sessions', `${created.sessionId}.json`)), true);
    assert.equal(fs.existsSync(path.join(workingDir, '.achilles-cli')), false);
    assert.equal(fs.existsSync(path.join(workingDir, '.copilot_history')), false);

    assert.deepEqual(buildConversationInitialHistory(restored), [
        {
            role: 'user',
            message: 'Inspect the project\n\nReferences: [{"kind":"workspace-path","path":"src/index.mjs"}]',
        },
        { role: 'assistant', message: 'The project is ready.' },
    ]);
});

test('conversation storage rejects a symlinked owned sessions directory', (t) => {
    const workingDir = workspace(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-sessions-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    fs.mkdirSync(path.join(workingDir, '.data', 'achilles-cli'), { recursive: true });
    fs.symlinkSync(outside, path.join(workingDir, '.data', 'achilles-cli', 'sessions'), 'dir');

    assert.throws(
        () => new ConversationSessionStore({ workingDir }),
        /sessions directory must not be a symbolic link/,
    );
    assert.deepEqual(fs.readdirSync(outside), []);
});

test('conversation storage revalidates sessions after construction', (t) => {
    const workingDir = workspace(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-sessions-replaced-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const store = new ConversationSessionStore({ workingDir });
    const sessionsDirectory = path.join(workingDir, '.data', 'achilles-cli', 'sessions');

    fs.rmSync(sessionsDirectory, { recursive: true, force: true });
    fs.symlinkSync(outside, sessionsDirectory, 'dir');

    assert.throws(
        () => store.createSession(),
        /sessions directory must not be a symbolic link/,
    );
    assert.deepEqual(fs.readdirSync(outside), []);

    const outsideSessionId = '123e4567-e89b-42d3-a456-426614174000';
    fs.writeFileSync(path.join(outside, `${outsideSessionId}.json`), JSON.stringify({
        sessionId: outsideSessionId,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        messages: [{ role: 'user', text: 'outside-secret' }],
    }));
    assert.throws(
        () => store.loadSession(outsideSessionId),
        /sessions directory must not be a symbolic link/,
    );
});

test('new and resumed sessions update the selected session and list', (t) => {
    const workingDir = workspace(t);
    const store = new ConversationSessionStore({ workingDir });
    const first = store.createSession();
    const firstTurn = store.beginTurn({ text: 'First session' });
    store.completeTurn(first.sessionId, firstTurn.assistantMessageIndex, 'First answer');
    const second = store.createSession();
    assert.equal(getCurrentSessionId(workingDir), second.sessionId);

    const list = store.listSessions();
    assert.equal(list.currentSessionId, second.sessionId);
    assert.equal(list.sessions.length, 2);
    assert.equal(list.sessions.find((entry) => entry.sessionId === first.sessionId).preview, 'First session');

    store.resumeSession(first.sessionId);
    assert.equal(getCurrentSessionId(workingDir), first.sessionId);
    assert.throws(() => store.resumeSession('../settings'), /invalid_session_id/);
});

test('visible command turns persist for rendering but stay outside model history', (t) => {
    const workingDir = workspace(t);
    const store = new ConversationSessionStore({ workingDir });
    const command = store.beginCommand({ text: '/exec launch-opencode hi' });
    store.insertTask(command.session.sessionId, command.assistantMessageIndex, 'task_abcdefabcdefabcdefabcdef');
    const completed = store.completeCommand(
        command.session.sessionId,
        command.assistantMessageIndex,
        'Task started.',
    );

    assert.equal(command.kind, 'command');
    assert.deepEqual(completed.messages.map((message) => ({
        role: message.role,
        type: message.type,
        text: message.text,
        taskId: message.taskId,
        context: message.context,
    })), [
        {
            role: 'user',
            type: undefined,
            text: '/exec launch-opencode hi',
            taskId: undefined,
            context: false,
        },
        {
            role: 'assistant',
            type: undefined,
            text: 'Task started.',
            taskId: undefined,
            context: false,
        },
        {
            role: undefined,
            type: 'task',
            text: undefined,
            taskId: 'task_abcdefabcdefabcdefabcdef',
            context: undefined,
        },
    ]);
    assert.deepEqual(buildConversationInitialHistory(completed), []);

    const reloaded = new ConversationSessionStore({ workingDir }).ensureCurrentSession();
    assert.deepEqual(reloaded.messages, completed.messages);
    assert.equal(reloaded.messages[2].taskId, 'task_abcdefabcdefabcdefabcdef');
    assert.deepEqual(buildConversationInitialHistory(reloaded), []);
});

test('commands without visible output do not persist an empty assistant message', (t) => {
    const workingDir = workspace(t);
    const store = new ConversationSessionStore({ workingDir });
    const command = store.beginCommand({ text: '/tasks' });
    const completed = store.completeCommand(command.session.sessionId, command.assistantMessageIndex, '');

    assert.deepEqual(completed.messages.map(({ role, text, context }) => ({ role, text, context })), [
        { role: 'user', text: '/tasks', context: false },
    ]);
    assert.deepEqual(buildConversationInitialHistory(completed), []);
});

test('slash session commands call the AchillesCLI session owner', async () => {
    const calls = [];
    const session = {
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        createdAt: '2026-07-23T10:00:00.000Z',
        updatedAt: '2026-07-23T10:00:00.000Z',
        messages: [],
    };
    const handler = new SlashCommandHandler({
        executeSkill: async () => null,
        getUserSkills: () => [],
        getSkills: () => [],
        getSessions: () => ({ currentSessionId: session.sessionId, sessions: [] }),
        createSession: async () => { calls.push('new'); return session; },
        resumeSession: async (id) => { calls.push(`resume:${id}`); return session; },
    });

    const sessionCommand = await handler.executeSlashCommand('session', '');
    assert.equal(sessionCommand.showSessionPicker, true);
    assert.equal(sessionCommand.sessionList.currentSessionId, session.sessionId);
    assert.equal(SlashCommandHandler.getCommandCatalog().some((command) => command.name === '/sessions'), false);
    assert.equal((await handler.executeSlashCommand('session', 'new')).sessionChanged.sessionId, session.sessionId);
    assert.equal((await handler.executeSlashCommand('session', `resume ${session.sessionId}`)).sessionChanged.sessionId, session.sessionId);
    assert.deepEqual(calls, ['new', `resume:${session.sessionId}`]);
});

test('WebChat session protocol sends current, list, and selected records', () => {
    const session = {
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        createdAt: '2026-07-23T10:00:00.000Z',
        updatedAt: '2026-07-23T10:00:00.000Z',
        messages: [],
    };
    assert.equal(createCurrentSessionEnvelope(session).event, 'current');
    assert.equal(createSelectedSessionEnvelope(session).event, 'selected');
    assert.deepEqual(createSessionListEnvelope({
        currentSessionId: session.sessionId,
        sessions: [],
    }).sessions, []);
});
