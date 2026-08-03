/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectAdminService,
	type ProjectAdminServiceRuntime,
} from '../src/common/editor/controller/project-admin-service.ts';

function deferred() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

function createFixture() {
	let project: { id: string; title: string; revision: number } | null = {
		id: 'project-a', title: 'Project A', revision: 3,
	};
	const save = deferred();
	let duplicateCalls = 0;
	let openCalls = 0;
	let releaseCalls = 0;
	const handoffCalls: string[] = [];
	let flush: () => Promise<void> = async () => undefined;
	let prepareHandoff: () => Promise<void> = async () => undefined;
	const sourceBuffers = new Map<string, unknown>();
	const sourceChunkProviders = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const state = {
		readOnly: false,
		recordingRouting: {},
		missingSourceIds: new Set<string>(),
		disposed: false,
		sourceGcTimer: 0,
		history: {},
		projects: [],
	};
	const noop = () => undefined;
	const runtime: ProjectAdminServiceRuntime = {
		cancelPlaybackCachePreparation: noop,
		clearScheduledTimer: noop,
		clearWaveformPcmWindows: noop,
		clipTimePitchCache: {},
		commit: noop,
		copy: {
			projectNotFound: 'Project not found.',
			projectReadOnly: 'Project is read-only.',
			projectTitleRequired: 'A title is required.',
			projectCopySuffix: 'copy',
		},
		currentTimeMs: () => 1_000,
		disposeRenderEngines: async () => undefined,
		editorHistoryProjects: () => [],
		engine: { stop: noop },
		evictUnreferencedSourceCaches: noop,
		flushProject: () => flush(),
		getProject: () => project,
		handleError: noop,
		liveSessionClipIds: () => new Set<string>(),
		liveSessionLinkedOriginalSourceReferences: () => [],
		liveSessionSourceIds: () => new Set<string>(),
		newProject: async () => undefined,
		openProject: async () => { openCalls += 1; },
		persistSetting: async () => undefined,
		projectSaveService: { cancelScheduled: noop, pendingSnapshots: [] },
		projectSessionService: { clearRecentProjects: async () => [] },
		publishDocumentSnapshot: noop,
		recordingRoutingSettingKey: (id) => `routing:${id}`,
		releaseProjectLock: async () => {
			handoffCalls.push('release');
			releaseCalls += 1;
		},
		revokeVideoVisuals: noop,
		saveNow: () => save.promise,
		scheduleTimer: () => 1,
		sessionController: {
			getSnapshot: () => ({ tabs: [] }),
			closeProject: () => ({ closed: false }),
			clearClipboard: noop,
			markProjectSaved: noop,
		},
		sessionTab: () => null,
		setProject: (value) => { project = value; },
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		state,
		stopProjectBinPreview: async () => undefined,
		stopRecording: async () => undefined,
		store: {
			async duplicateProject() {
				duplicateCalls += 1;
				return { id: 'copy', title: 'Copy', revision: 1 };
			},
			async listProjects() { return []; },
			async prepareProjectHandoff() {
				handoffCalls.push('prepare');
				await prepareHandoff();
			},
		},
		switchProject: async () => undefined,
	};
	return {
		service: createProjectAdminService(runtime),
		save,
		duplicateCalls: () => duplicateCalls,
		openCalls: () => openCalls,
		releaseCalls: () => releaseCalls,
		handoffCalls,
		replaceProject() { project = { id: 'project-b', title: 'Project B', revision: 1 }; },
		setFlush(value: () => Promise<void>) { flush = value; },
		setPrepareHandoff(value: () => Promise<void>) { prepareHandoff = value; },
	};
}

test('duplicate completion cannot act on a project replaced while saving', async () => {
	const fixture = createFixture();
	const pending = fixture.service.duplicateProject('Copy');
	fixture.replaceProject();
	fixture.save.resolve();
	assert.equal(await pending, null);
	assert.equal(fixture.duplicateCalls(), 0);
	assert.equal(fixture.openCalls(), 0);
});

test('handoff checks project ownership again after its flush', async () => {
	const fixture = createFixture();
	fixture.setFlush(async () => { fixture.replaceProject(); });
	await assert.rejects(() => fixture.service.prepareProjectHandoff(), /not found/u);
	assert.equal(fixture.releaseCalls(), 0);
});

test('handoff prepares durable media before lock release and returns a frozen identity', async () => {
	const fixture = createFixture();
	const handoff = await fixture.service.prepareProjectHandoff();
	assert.deepEqual(handoff, { projectId: 'project-a', revision: 3 });
	assert.equal(Object.isFrozen(handoff), true);
	assert.equal(fixture.releaseCalls(), 1);
	assert.deepEqual(fixture.handoffCalls, ['prepare', 'release']);
});

test('handoff preparation failure retains the shared project lock', async () => {
	const fixture = createFixture();
	const failure = new Error('managed media publication failed');
	fixture.setPrepareHandoff(async () => { throw failure; });

	await assert.rejects(() => fixture.service.prepareProjectHandoff(), (error) => error === failure);
	assert.equal(fixture.releaseCalls(), 0);
	assert.deepEqual(fixture.handoffCalls, ['prepare']);
});
