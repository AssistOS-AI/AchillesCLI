import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getDisabledSkills } from '../src/lib/achillesSettings.mjs';
import {
    applyPersistedWorkspaceSkillState,
    createWorkspaceSkillsSnapshot,
    setWorkspaceDirectoryEnabled,
    setWorkspaceSkillEnabled,
} from '../src/lib/workspaceSkillsState.mjs';
import { SlashCommandHandler } from '../src/repl/SlashCommandHandler.mjs';

function createFixture() {
    const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-workspace-skills-'));
    const records = [
        { name: 'alpha-cskill', shortName: 'alpha', type: 'cskill', skillDir: path.join(workingDir, 'skills', 'alpha'), enabled: true, isInternal: false },
        { name: 'beta-orchestrator', shortName: 'beta', type: 'orchestrator', skillDir: path.join(workingDir, 'packages', 'tools', 'beta'), enabled: true, isInternal: false },
        { name: 'internal-cskill', shortName: 'internal', type: 'cskill', skillDir: '/runtime/skills/internal', enabled: true, isInternal: true },
    ];
    const aliases = new Map();
    for (const record of records) {
        aliases.set(record.name, record);
        aliases.set(record.shortName, record);
    }
    const agent = {
        getSkills: () => records,
        getSkillRecord: (name) => aliases.get(name) || null,
        enableSkills(names) {
            for (const name of names) aliases.get(name).enabled = true;
        },
        disableSkills(names) {
            for (const name of names) aliases.get(name).enabled = false;
        },
    };
    return { workingDir, records, agent };
}

test('workspace snapshots expose relative paths, descriptor types, and disabled state', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.workingDir, { recursive: true, force: true }));

    setWorkspaceSkillEnabled(fixture.agent, fixture.workingDir, 'alpha', false);
    assert.deepEqual(getDisabledSkills(fixture.workingDir), ['alpha-cskill']);
    assert.deepEqual(createWorkspaceSkillsSnapshot(fixture.agent, fixture.workingDir), [
        { name: 'beta-orchestrator', displayName: 'beta', relativePath: 'packages/tools/beta', type: 'oskill', enabled: true },
        { name: 'alpha-cskill', displayName: 'alpha', relativePath: 'skills/alpha', type: 'cskill', enabled: false },
    ]);
});

test('directory toggles are recursive, confined, and persisted', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.workingDir, { recursive: true, force: true }));

    setWorkspaceDirectoryEnabled(fixture.agent, fixture.workingDir, 'packages', false);
    assert.equal(fixture.records[0].enabled, true);
    assert.equal(fixture.records[1].enabled, false);
    assert.deepEqual(getDisabledSkills(fixture.workingDir), ['beta-orchestrator']);
    assert.throws(
        () => setWorkspaceDirectoryEnabled(fixture.agent, fixture.workingDir, '../outside', false),
        /inside the working directory/,
    );
});

test('persisted disabled names are reapplied only to workspace skills', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.workingDir, { recursive: true, force: true }));
    setWorkspaceSkillEnabled(fixture.agent, fixture.workingDir, 'beta', false);
    fixture.records.forEach((record) => { record.enabled = true; });

    applyPersistedWorkspaceSkillState(fixture.agent, fixture.workingDir);
    assert.equal(fixture.records[1].enabled, false);
    assert.equal(fixture.records[2].enabled, true);
});

test('slash commands preserve singular and plural skill-control contracts', async (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.workingDir, { recursive: true, force: true }));
    const handler = new SlashCommandHandler({
        executeSkill: async () => null,
        getUserSkills: () => fixture.records,
        getSkills: () => fixture.records,
        getSkillState: () => createWorkspaceSkillsSnapshot(fixture.agent, fixture.workingDir),
        setSkillEnabled: (name, enabled) => setWorkspaceSkillEnabled(fixture.agent, fixture.workingDir, name, enabled),
        setSkillsDirectoryEnabled: (directory, enabled) => setWorkspaceDirectoryEnabled(fixture.agent, fixture.workingDir, directory, enabled),
    });

    const one = await handler.executeSlashCommand('skill', 'disable alpha-cskill');
    assert.equal(one.skillStateEvent, 'changed');
    assert.equal(fixture.records[0].enabled, false);
    const folder = await handler.executeSlashCommand('skills', 'disable packages');
    assert.equal(folder.skillOperation.scope, 'directory');
    assert.equal(fixture.records[1].enabled, false);
    const list = await handler.executeSlashCommand('skills', '');
    assert.equal(list.skillState.length, 2);
});
