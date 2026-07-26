import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorPreferencesService } from '../src/common/editor/controller/preferences-service.ts';
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts';
import { createProjectSessionService } from '../src/common/editor/controller/project-session-service.ts';

interface TestProject {
	readonly id: string;
	readonly revision: number;
}

test('project saves serialize queued snapshots and only publish the newest generation as saved', async () => {
	let project: TestProject = { id: 'project', revision: 1 };
	const state = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<TestProject>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'saved',
	};
	const timers = new Map<number, () => void>();
	const saved: number[] = [];
	const marked: number[] = [];
	let nextTimer = 1;
	const service = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		saveProject: async (snapshot) => { saved.push(snapshot.revision); },
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => project.id === projectId,
		hasSessionTab: () => true,
		markProjectSaved: () => { marked.push(project.revision); },
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
		scheduleTimer(callback) {
			const handle = nextTimer++;
			timers.set(handle, callback);
			return handle;
		},
		clearTimer: (handle) => { timers.delete(handle); },
	});

	assert.equal(service.scheduleAutosave(), true);
	const firstTimer = state.autosaveTimer;
	project = { id: 'project', revision: 2 };
	assert.equal(service.scheduleAutosave(), true);
	assert.equal(timers.has(firstTimer), false);
	timers.get(state.autosaveTimer)?.();
	await service.drain();
	assert.deepEqual(saved, [2]);
	assert.deepEqual(marked, [2]);
	assert.equal(state.saveState, 'saved');
	assert.equal(state.pendingSaveSnapshots.size, 0);
});

test('terminal project flush waits behind queued work and rejects later autosaves', async () => {
	let project: TestProject = { id: 'project', revision: 1 };
	const state = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<TestProject>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'saved',
	};
	const timers = new Map<number, () => void>();
	const writes: Array<{ snapshot: TestProject; resolve: () => void }> = [];
	let nextTimer = 1;
	const service = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		saveProject: (snapshot) => new Promise<void>((resolve) => { writes.push({ snapshot, resolve }); }),
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => project.id === projectId,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
		scheduleTimer(callback) {
			const handle = nextTimer++;
			timers.set(handle, callback);
			return handle;
		},
		clearTimer: (handle) => { timers.delete(handle); },
	});

	service.scheduleAutosave();
	timers.get(state.autosaveTimer)?.();
	await waitFor(() => writes.length === 1);
	assert.equal(writes[0]?.snapshot.revision, 1);
	project = { id: 'project', revision: 2 };
	const terminal = service.terminalFlush();
	await Promise.resolve();
	assert.equal(writes.length, 1);
	writes[0]?.resolve();
	await waitFor(() => writes.length === 2);
	assert.equal(writes[1]?.snapshot.revision, 2);
	writes[1]?.resolve();
	await terminal;
	assert.equal(service.scheduleAutosave(), false);
	assert.equal(state.pendingSaveSnapshots.size, 0);
});

test('preferences service recovers invalid storage and preserves the read-only schema gate', async () => {
	type Preferences = ReturnType<typeof preferenceFixture>;
	let preferences = preferenceFixture();
	let readOnly = false;
	const persisted: Array<[string, unknown]> = [];
	const service = createEditorPreferencesService<Preferences>({
		productId: 'soundscaper',
		preferenceSettingKey: 'soundscaper:preferences',
		defaultWorkspace: 'modern',
		newerSchemaMessage: 'newer schema',
		getPreferences: () => preferences,
		setPreferences: (value) => { preferences = value; },
		getReadOnly: () => readOnly,
		setReadOnly: (value) => { readOnly = value; },
		loadSetting: async () => ({ invalid: true }),
		persistSetting: async (key, value) => { persisted.push([key, value]); },
		publish: () => undefined,
		loadPreferences: () => { throw new Error('invalid'); },
		createPreferences: (defaultWorkspace) => preferenceFixture(defaultWorkspace),
		applyWorkspace: (value, workspaceId) => ({ ...value, workspace: { ...value.workspace, activeId: workspaceId } }),
		updatePreferences: (value, patch) => ({ ...value, ...patch as Partial<Preferences> }),
		normalizeShortcut: (value) => value.toLowerCase(),
		findShortcutConflicts: () => [],
		createWorkspace: (value) => value,
		updateWorkspace: (value) => value,
		deleteWorkspace: (value) => value,
	});

	await service.load(async (value) => value);
	assert.equal(preferences.workspace.activeId, 'modern');
	assert.equal(persisted[0]?.[0], 'soundscaper:preferences');
	await service.toggleToolbar('transport');
	assert.equal(preferences.workspace.toolbars.transport?.visible, false);
	readOnly = true;
	assert.throws(() => service.update({ playback: { mode: 'staffpad' } }), /newer schema/);
});

test('project session service deduplicates legacy recents and persists active UI metadata', async () => {
	let recent: string[] = [];
	const persisted: Array<[string, unknown]> = [];
	const metadata: Array<[string, Record<string, unknown>]> = [];
	const settings = new Map<string, unknown>([
		['audio-editor-recent-project-ids', ['first', 'first', '', 'second']],
		['last-project-id', 'second'],
	]);
	const service = createProjectSessionService({
		productId: 'soundscaper',
		recentProjectsSettingKey: 'soundscaper:recent',
		lastProjectSettingKey: 'soundscaper:last',
		getRecentProjectIds: () => recent,
		setRecentProjectIds: (value) => { recent = value; },
		getActiveProjectId: () => 'first',
		getSelectedTrackId: () => 'track',
		getSelectedClipId: () => 'clip',
		getTabs: () => [{ projectId: 'first', metadata: {} }],
		updateProjectMetadata: (projectId, value) => { metadata.push([projectId, value]); },
		loadSetting: async (key, fallback) => settings.get(key) ?? fallback,
		persistSetting: async (key, value) => { persisted.push([key, value]); },
		publish: () => undefined,
	});

	const lastProjectId = await service.loadRecentProjectState(async (value) => value);
	assert.equal(lastProjectId, 'second');
	assert.deepEqual(recent, ['first', 'second']);
	service.persistActiveSessionUiState();
	assert.deepEqual(metadata, [['first', { selectedTrackId: 'track', selectedClipId: 'clip' }]]);
	await service.recordOpenedProject('third', async (value) => value);
	assert.deepEqual(recent, ['third', 'first', 'second']);
	assert.deepEqual(persisted.map(([key]) => key), [
		'soundscaper:last', 'last-project-id', 'soundscaper:recent', 'audio-editor-recent-project-ids',
	]);
});

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	assert.fail('Condition was not met before the microtask queue settled.');
}

function preferenceFixture(activeId = 'default') {
	return {
		workspace: {
			activeId,
			toolbars: { transport: { visible: true, order: 0 } },
			panels: { effects: { visible: true, dock: 'right', order: 0 } },
			toolbarButtons: {},
		},
		shortcuts: {} as Record<string, string[]>,
	};
}
