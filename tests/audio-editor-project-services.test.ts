import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorPreferencesService } from '../src/common/editor/controller/preferences-service.ts';
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts';
import { createProjectSessionService } from '../src/common/editor/controller/project-session-service.ts';
import type { ProjectLinkedOriginalSourceReference } from '../src/common/editor/storage/project-publication-options.ts';

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
	const saveOptions: Array<Readonly<{
		protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
	}>> = [];
	const marked: number[] = [];
	let nextTimer = 1;
	const service = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		admitProjectPublication: async () => undefined,
		saveProject: async (snapshot, options) => {
			saved.push(snapshot.revision);
			saveOptions.push(options);
		},
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
	assert.equal(Object.hasOwn(saveOptions[0] ?? {}, 'protectedLinkedOriginalSourceReferences'), false);
	assert.deepEqual(marked, [2]);
	assert.equal(state.saveState, 'saved');
	assert.equal(state.pendingSaveSnapshots.size, 0);
});

test('autosaves collect immutable deduplicated kindful roots when the queued write starts', async () => {
	const project: TestProject = { id: 'project', revision: 1 };
	let releaseQueue: () => void = () => undefined;
	const queueGate = new Promise<void>((resolve) => { releaseQueue = resolve; });
	const state = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<TestProject>(),
		saveQueue: queueGate as Promise<unknown>,
		saveState: 'saved',
	};
	const timers = new Map<number, () => void>();
	let roots: ProjectLinkedOriginalSourceReference[] = [
		{ kind: 'video', sourceId: 'scheduled-root' },
	];
	let collectionCount = 0;
	const writtenRoots: Array<readonly ProjectLinkedOriginalSourceReference[]> = [];
	const service = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		admitProjectPublication: async () => undefined,
		collectProtectedLinkedOriginalSourceReferences: () => {
			collectionCount += 1;
			return roots;
		},
		saveProject: async (_snapshot, options) => {
			const protectedReferences = options.protectedLinkedOriginalSourceReferences;
			assert.ok(protectedReferences);
			writtenRoots.push(protectedReferences);
		},
		persistActiveProjectId: async () => undefined,
		isCurrentProject: () => true,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
		scheduleTimer(callback) {
			timers.set(1, callback);
			return 1;
		},
		clearTimer: (handle) => { timers.delete(handle); },
	});

	assert.equal(service.scheduleAutosave(), true);
	timers.get(state.autosaveTimer)?.();
	await Promise.resolve();
	assert.equal(collectionCount, 0);
	roots = [
		{ kind: 'video', sourceId: 'write-root' },
		{ kind: 'audio', sourceId: 'shared-root' },
		{ kind: 'video', sourceId: 'shared-root' },
		{ kind: 'audio', sourceId: 'shared-root' },
	];
	releaseQueue();
	await service.drain();

	assert.equal(collectionCount, 1);
	assert.deepEqual(writtenRoots, [[
		{ kind: 'audio', sourceId: 'shared-root' },
		{ kind: 'video', sourceId: 'shared-root' },
		{ kind: 'video', sourceId: 'write-root' },
	]]);
	assert.equal(Object.isFrozen(writtenRoots[0]), true);
	assert.equal(writtenRoots[0]?.every(Object.isFrozen), true);
	roots.push({ kind: 'audio', sourceId: 'later-root' });
	assert.equal(writtenRoots[0]?.some(({ sourceId }) => sourceId === 'later-root'), false);
	assert.throws(() => {
		(writtenRoots[0] as ProjectLinkedOriginalSourceReference[]).push({
			kind: 'audio', sourceId: 'mutation',
		});
	}, TypeError);
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
		admitProjectPublication: async () => undefined,
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
	interface SessionProject {
		readonly schemaVersion?: unknown;
		readonly timelineAnnotations?: unknown;
		readonly tracks: readonly Readonly<{ id: string; type: string }>[];
		readonly clips: readonly Readonly<{ id: string }>[];
	}
	let recent: string[] = [];
	const selectionState = {
		selectedTrackId: 'track' as string | null,
		selectedClipId: 'clip' as string | null,
		selectedAnnotationId: 'annotation' as string | null,
	};
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
		state: selectionState,
		findTrack: (project: SessionProject, trackId) => project.tracks.find((track) => track.id === trackId) ?? null,
		findClip: (project: SessionProject, clipId) => project.clips.find((clip) => clip.id === clipId) ?? null,
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
	assert.deepEqual(metadata, [['first', {
		selectedTrackId: 'track',
		selectedClipId: 'clip',
		selectedAnnotationId: 'annotation',
	}]]);
	service.restoreProjectSelection({
		schemaVersion: 13,
		timelineAnnotations: [{ id: 'restored-annotation' }],
		tracks: [{ id: 'labels', type: 'label' }, { id: 'audio', type: 'audio' }],
		clips: [{ id: 'restored-clip' }],
	}, {
		selectedTrackId: 'labels',
		selectedClipId: 'restored-clip',
		selectedAnnotationId: 'restored-annotation',
	});
	assert.deepEqual(selectionState, {
		selectedTrackId: 'labels',
		selectedClipId: 'restored-clip',
		selectedAnnotationId: 'restored-annotation',
	});
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
