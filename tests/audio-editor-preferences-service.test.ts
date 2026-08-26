/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorPreferenceActionDelegates,
	createEditorPreferencesService,
	type EditorPreferenceActionSource,
	type EditorPreferencesServiceDependencies,
} from '../src/common/editor/controller/preferences-service.ts';

interface Preferences extends Record<string, unknown> {
	readonly workspace: {
		readonly activeId: string;
		readonly toolbars: Record<string, { readonly visible: boolean; readonly order: number }>;
		readonly panels: Record<string, { readonly visible: boolean; readonly dock: unknown; readonly order: number }>;
		readonly toolbarButtons: Record<string, boolean>;
	};
	readonly shortcuts: Record<string, string[]>;
}

function preferenceFixture(activeId = 'modern'): Preferences {
	return {
		workspace: {
			activeId,
			toolbars: {
				transport: { visible: true, order: 0 },
				edit: { visible: true, order: 1 },
			},
			panels: {
				effects: { visible: true, dock: 'right', order: 0 },
				meter: { visible: false, dock: 'right', order: 1 },
				history: { visible: true, dock: 'left', order: 0 },
			},
			toolbarButtons: {},
		},
		shortcuts: {},
	};
}

function mergePreferences(value: Preferences, patch: unknown): Preferences {
	const next = patch as Partial<Preferences>;
	const workspace = next.workspace as Partial<Preferences['workspace']> | undefined;
	return {
		...value,
		...next,
		workspace: {
			...value.workspace,
			...workspace,
			toolbars: { ...value.workspace.toolbars, ...workspace?.toolbars },
			panels: { ...value.workspace.panels, ...workspace?.panels },
			toolbarButtons: { ...value.workspace.toolbarButtons, ...workspace?.toolbarButtons },
		},
		shortcuts: next.shortcuts || value.shortcuts,
	};
}

function createFixture(overrides: Partial<EditorPreferencesServiceDependencies<Preferences>> = {}) {
	let preferences = preferenceFixture();
	let readOnly = false;
	let publishes = 0;
	const persisted: Array<[string, unknown]> = [];
	const dependencies: EditorPreferencesServiceDependencies<Preferences> = {
		productId: 'soundscaper',
		preferenceSettingKey: 'soundscaper:preferences',
		defaultWorkspace: 'modern',
		newerSchemaMessage: 'newer schema',
		shortcutActionRequired: 'action required',
		shortcutConflict: '{binding} already belongs to {action}',
		getPreferences: () => preferences,
		setPreferences: (value) => { preferences = value; },
		getReadOnly: () => readOnly,
		setReadOnly: (value) => { readOnly = value; },
		loadSetting: async () => null,
		persistSetting: async (key, value) => { persisted.push([key, value]); },
		publish: () => { publishes += 1; },
		loadPreferences: (saved) => saved as { readonly readOnly: boolean; readonly preferences: Preferences },
		createPreferences: (workspaceId) => preferenceFixture(workspaceId),
		applyWorkspace: (value, workspaceId) => mergePreferences(value, { workspace: { activeId: workspaceId } }),
		updatePreferences: mergePreferences,
		normalizeShortcut: (binding) => binding.toLowerCase().replace(/\s+/gu, ''),
		findShortcutConflicts: () => [],
		createWorkspace: (value, options) => ({
			...value,
			workspace: { ...value.workspace, activeId: options.id },
			workspaceName: options.name,
		}),
		updateWorkspace: (value, workspaceId, changes) => ({ ...value, updatedWorkspace: { workspaceId, changes } }),
		deleteWorkspace: (value, workspaceId) => ({ ...value, deletedWorkspace: workspaceId }),
		...overrides,
	};
	return {
		dependencies,
		preferences: () => preferences,
		readOnly: () => readOnly,
		setReadOnly: (value: boolean) => { readOnly = value; },
		persisted,
		publishes: () => publishes,
	};
}

test('preferences load current, legacy, read-only, migrated, and invalid values', async () => {
	const empty = createFixture();
	assert.equal(await createEditorPreferencesService(empty.dependencies).load(async (value) => value), empty.preferences());

	const legacy = preferenceFixture('legacy');
	const loadedKeys: string[] = [];
	const legacyFixture = createFixture({
		loadSetting: async (key) => {
			loadedKeys.push(key);
			return key === 'audio-editor-preferences-v1' ? { readOnly: false, preferences: legacy } : null;
		},
	});
	await createEditorPreferencesService(legacyFixture.dependencies).load(async (value) => value);
	assert.deepEqual(loadedKeys, ['soundscaper:preferences', 'audio-editor-preferences-v1']);
	assert.equal(legacyFixture.preferences().workspace.activeId, 'legacy');
	assert.equal(legacyFixture.persisted.length, 1);

	const readOnlyFixture = createFixture({
		loadSetting: async () => ({ readOnly: true, preferences: preferenceFixture('future') }),
	});
	await createEditorPreferencesService(readOnlyFixture.dependencies).load(async (value) => value);
	assert.equal(readOnlyFixture.readOnly(), true);
	assert.equal(readOnlyFixture.preferences().workspace.activeId, 'modern');

	const migratedFixture = createFixture({
		loadSetting: async () => ({ readOnly: false, preferences: preferenceFixture('video-editor') }),
	});
	await createEditorPreferencesService(migratedFixture.dependencies).load(async (value) => value);
	assert.equal(migratedFixture.preferences().workspace.activeId, 'modern');

	const invalidFixture = createFixture({
		loadSetting: async () => ({ invalid: true }),
		loadPreferences: () => { throw new Error('invalid'); },
	});
	await createEditorPreferencesService(invalidFixture.dependencies).load(async (value) => value);
	assert.equal(invalidFixture.preferences().workspace.activeId, 'modern');
	assert.equal(invalidFixture.persisted.length, 1);
});

test('preferences mutations cover toolbar, panel, shortcut, and workspace operations', async () => {
	const fixture = createFixture();
	const service = createEditorPreferencesService(fixture.dependencies);

	await service.update({ arbitrary: true });
	await service.toggleToolbar('transport');
	assert.equal(fixture.preferences().workspace.toolbars.transport?.visible, false);
	await service.moveToolbar('transport', 99);
	assert.equal(fixture.preferences().workspace.toolbars.transport?.order, 1);
	await service.moveToolbar('transport', Number.NaN);
	assert.equal(fixture.preferences().workspace.toolbars.transport?.order, 0);
	await service.setToolbarButton(' zoom ', true);
	assert.equal(fixture.preferences().workspace.toolbarButtons[' zoom '], true);

	await service.togglePanel('effects');
	assert.equal(fixture.preferences().workspace.panels.effects?.visible, false);
	await service.setPanel('effects', { visible: true });
	await service.movePanel('effects', 'left', 0);
	assert.equal(fixture.preferences().workspace.panels.effects?.dock, 'left');
	await service.movePanel('meter', 'bottom', 4);
	assert.equal(fixture.preferences().workspace.panels.meter?.dock, 'bottom');

	await service.setShortcut('play', [' Ctrl + P ', 'CTRL+P', '', 'Shift+P']);
	assert.deepEqual(fixture.preferences().shortcuts.play, ['ctrl+p', 'shift+p']);
	await service.setShortcut('play', []);
	assert.equal('play' in fixture.preferences().shortcuts, false);

	await service.setWorkspace('compact');
	assert.equal(fixture.preferences().workspace.activeId, 'compact');
	await service.createWorkspace('  Editing  ', 'editing');
	assert.equal(fixture.preferences().workspace.activeId, 'editing');
	assert.equal(fixture.preferences().workspaceName, 'Editing');
	await service.updateWorkspace('editing', { name: 'Updated' });
	assert.deepEqual(fixture.preferences().updatedWorkspace, { workspaceId: 'editing', changes: { name: 'Updated' } });
	await service.deleteWorkspace('editing');
	assert.equal(fixture.preferences().deletedWorkspace, 'editing');

	fixture.setReadOnly(true);
	await service.revertFactorySettings();
	assert.equal(fixture.readOnly(), false);
	assert.equal(fixture.preferences().workspace.activeId, 'modern');
	assert.equal(fixture.publishes() > 10, true);
	assert.equal(fixture.persisted.some(([key]) => key === 'audio-editor-preferences-v1'), true);
});

test('preferences reject invalid targets and shortcut conflicts without persisting', async () => {
	const fixture = createFixture({
		findShortcutConflicts: () => [{ binding: 'ctrl+x', actionIds: ['cut', 'custom'] }],
	});
	const service = createEditorPreferencesService(fixture.dependencies);

	assert.throws(() => service.toggleToolbar('missing'), /Toolbar missing/u);
	assert.throws(() => service.moveToolbar('missing', 0), /Toolbar missing/u);
	assert.throws(() => service.setToolbarButton('', true), /ID is required/u);
	assert.throws(() => service.setToolbarButton('play', 'yes' as unknown as boolean), /must be boolean/u);
	assert.throws(() => service.togglePanel('missing'), /Panel missing/u);
	assert.throws(() => service.setPanel('missing'), /Panel missing/u);
	assert.throws(() => service.movePanel('missing', 'left', 0), /Panel missing/u);
	assert.throws(() => service.setShortcut('', 'ctrl+x'), /action required/u);
	assert.throws(() => service.setShortcut('custom', 'ctrl+x'), /ctrl\+x already belongs to cut/u);

	fixture.setReadOnly(true);
	assert.throws(() => service.update({}), /newer schema/u);
});

test('failed persistence rolls back the exact optimistic preference publication', async () => {
	const observed: Preferences[] = [];
	const fixture = createFixture({
		persistSetting: async () => { throw new Error('settings unavailable'); },
	});
	const service = createEditorPreferencesService({
		...fixture.dependencies,
		publish: () => { observed.push(fixture.preferences()); },
	});
	const original = fixture.preferences();

	await assert.rejects(service.setWorkspace('compact'), /settings unavailable/u);

	assert.strictEqual(fixture.preferences(), original);
	assert.deepEqual(observed.map(({ workspace }) => workspace.activeId), ['compact', 'modern']);
});

test('a stale persistence failure cannot roll back a newer preference publication', async () => {
	let rejectFirst = (_error: Error): void => { throw new Error('The first persistence operation was not captured.'); };
	let persistenceCall = 0;
	const fixture = createFixture({
		productId: 'framescaper',
		persistSetting: () => {
			persistenceCall += 1;
			if (persistenceCall === 1) return new Promise((_resolve, reject) => { rejectFirst = reject; });
			return Promise.resolve();
		},
	});
	const service = createEditorPreferencesService(fixture.dependencies);
	const stale = service.setWorkspace('compact');
	const newer = service.setWorkspace('editing');
	await Promise.resolve();
	rejectFirst(new Error('stale failure'));

	await assert.rejects(stale, /stale failure/u);
	await newer;
	assert.equal(fixture.preferences().workspace.activeId, 'editing');
});

test('Soundscaper preference persistence commits the compatibility mirror before its authoritative key', async () => {
	const calls: Array<readonly [string, string]> = [];
	const fixture = createFixture({
		persistSetting: async (key, value) => {
			calls.push([key, (value as Preferences).workspace.activeId]);
		},
	});

	await createEditorPreferencesService(fixture.dependencies).setWorkspace('compact');

	assert.deepEqual(calls, [
		['audio-editor-preferences-v1', 'compact'],
		['soundscaper:preferences', 'compact'],
	]);
});

test('concurrent Soundscaper preference writes preserve invocation order in both durable keys', async () => {
	let releaseFirstWrite = (): void => undefined;
	const firstWritePending = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
	const calls: Array<readonly [string, string]> = [];
	const durable = new Map<string, string>();
	let writeCount = 0;
	const fixture = createFixture({
		persistSetting: async (key, value) => {
			writeCount += 1;
			const activeId = (value as Preferences).workspace.activeId;
			calls.push([key, activeId]);
			if (writeCount === 1) await firstWritePending;
			durable.set(key, activeId);
		},
	});
	const service = createEditorPreferencesService(fixture.dependencies);

	const first = service.setWorkspace('compact');
	const second = service.setWorkspace('editing');
	await Promise.resolve();
	releaseFirstWrite();
	await Promise.all([first, second]);

	assert.equal(fixture.preferences().workspace.activeId, 'editing');
	assert.deepEqual(calls, [
		['audio-editor-preferences-v1', 'compact'],
		['soundscaper:preferences', 'compact'],
		['audio-editor-preferences-v1', 'editing'],
		['soundscaper:preferences', 'editing'],
	]);
	assert.deepEqual(Object.fromEntries(durable), {
		'audio-editor-preferences-v1': 'editing',
		'soundscaper:preferences': 'editing',
	});
});

test('a failed compatibility write never attempts the authoritative preference commit', async () => {
	const calls: string[] = [];
	const fixture = createFixture({
		persistSetting: async (key) => {
			calls.push(key);
			if (key === 'audio-editor-preferences-v1') throw new Error('compatibility unavailable');
		},
	});
	const original = fixture.preferences();

	await assert.rejects(
		createEditorPreferencesService(fixture.dependencies).setWorkspace('compact'),
		/compatibility unavailable/u,
	);

	assert.deepEqual(calls, ['audio-editor-preferences-v1']);
	assert.strictEqual(fixture.preferences(), original);
});

test('a failed authoritative write restores the compatibility mirror before rolling memory back', async () => {
	const calls: Array<readonly [string, string]> = [];
	const fixture = createFixture({
		persistSetting: async (key, value) => {
			const activeId = (value as Preferences).workspace.activeId;
			calls.push([key, activeId]);
			if (key === 'soundscaper:preferences') throw new Error('authoritative unavailable');
		},
	});
	const original = fixture.preferences();

	await assert.rejects(
		createEditorPreferencesService(fixture.dependencies).setWorkspace('compact'),
		/authoritative unavailable/u,
	);

	assert.deepEqual(calls, [
		['audio-editor-preferences-v1', 'compact'],
		['soundscaper:preferences', 'compact'],
		['audio-editor-preferences-v1', 'modern'],
	]);
	assert.strictEqual(fixture.preferences(), original);
});

test('compatibility rollback failure is surfaced with the authoritative error', async () => {
	let compatibilityWrites = 0;
	const fixture = createFixture({
		persistSetting: async (key) => {
			if (key === 'soundscaper:preferences') throw new Error('authoritative unavailable');
			compatibilityWrites += 1;
			if (compatibilityWrites === 2) throw new Error('compatibility rollback unavailable');
		},
	});
	const original = fixture.preferences();

	await assert.rejects(
		createEditorPreferencesService(fixture.dependencies).setWorkspace('compact'),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(error.message, /rollback both failed/u);
			assert.deepEqual(error.errors.map((entry: Error) => entry.message), [
				'authoritative unavailable',
				'compatibility rollback unavailable',
			]);
			return true;
		},
	);
	assert.strictEqual(fixture.preferences(), original);
});

test('durable mutations use the required writer without changing best-effort load recovery', async () => {
	const calls: string[] = [];
	const fixture = createFixture({
		loadSetting: async () => ({ invalid: true }),
		loadPreferences: () => { throw new Error('invalid'); },
		persistSetting: async () => { calls.push('best-effort'); },
		persistSettingRequired: async () => {
			calls.push('required');
			throw new Error('required unavailable');
		},
	});
	const service = createEditorPreferencesService(fixture.dependencies);

	await service.load(async (value) => value);
	assert.deepEqual(calls, ['best-effort']);
	await assert.rejects(service.setWorkspace('compact'), /required unavailable/u);
	assert.deepEqual(calls, ['best-effort', 'required']);
});

test('preference action delegates forward every editor action to its service method', async () => {
	const calls: Array<readonly unknown[]> = [];
	const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return name; };
	const source: EditorPreferenceActionSource = {
		setWorkspace: record('setWorkspace'),
		toggleToolbar: record('toggleToolbar'),
		moveToolbar: record('moveToolbar'),
		setToolbarButton: record('setToolbarButton'),
		togglePanel: record('togglePanel'),
		setPanel: record('setPanel'),
		movePanel: record('movePanel'),
		setShortcut: record('setShortcut'),
		createWorkspace: record('createWorkspace'),
		updateWorkspace: record('updateWorkspace'),
		deleteWorkspace: record('deleteWorkspace'),
	};
	const delegates = createEditorPreferenceActionDelegates(source, (prefix) => `${prefix}-1`);

	assert.equal(delegates.setWorkspacePreference('compact'), 'setWorkspace');
	delegates.toggleToolbarPreference('tools');
	delegates.moveToolbarPreference('tools', 2);
	delegates.setToolbarButtonPreference('play', false);
	delegates.togglePanelPreference('mixer');
	delegates.setPanelPreference('mixer');
	delegates.movePanelPreference('mixer', 'left', 1);
	delegates.setShortcutPreference('play', ['Space']);
	delegates.createWorkspacePreference('Mine');
	delegates.updateWorkspacePreference('mine');
	delegates.deleteWorkspacePreference('mine');

	assert.deepEqual(calls, [
		['setWorkspace', 'compact'],
		['toggleToolbar', 'tools'],
		['moveToolbar', 'tools', 2],
		['setToolbarButton', 'play', false],
		['togglePanel', 'mixer'],
		['setPanel', 'mixer', {}],
		['movePanel', 'mixer', 'left', 1],
		['setShortcut', 'play', ['Space']],
		['createWorkspace', 'Mine', 'workspace-1'],
		['updateWorkspace', 'mine', {}],
		['deleteWorkspace', 'mine'],
	]);
});

test('preference action delegates keep an explicitly supplied workspace identifier', () => {
	const created: unknown[] = [];
	const delegates = createEditorPreferenceActionDelegates({
		setWorkspace: () => undefined,
		toggleToolbar: () => undefined,
		moveToolbar: () => undefined,
		setToolbarButton: () => undefined,
		togglePanel: () => undefined,
		setPanel: () => undefined,
		movePanel: () => undefined,
		setShortcut: () => undefined,
		createWorkspace: (name, workspaceId) => { created.push([name, workspaceId]); },
		updateWorkspace: () => undefined,
		deleteWorkspace: () => undefined,
	}, () => { throw new Error('identifier generation is not expected'); });

	delegates.createWorkspacePreference('Mine', 'workspace-explicit');
	assert.deepEqual(created, [['Mine', 'workspace-explicit']]);
});
