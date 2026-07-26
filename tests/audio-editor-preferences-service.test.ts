/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorPreferencesService,
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
