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
	let flush: () => Promise<void> = async () => undefined;
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
		editorHistoryProjects: () => [],
		engine: { stop: noop },
		evictUnreferencedSourceCaches: noop,
		flushProject: () => flush(),
		getProject: () => project,
		handleError: noop,
		liveSessionClipIds: () => new Set<string>(),
		liveSessionSourceIds: () => new Set<string>(),
		newProject: async () => undefined,
		openProject: async () => { openCalls += 1; },
		persistSetting: async () => undefined,
		projectSaveService: { cancelScheduled: noop, pendingSnapshots: [] },
		projectSessionService: { clearRecentProjects: async () => [] },
		publishDocumentSnapshot: noop,
		recordingRoutingSettingKey: (id) => `routing:${id}`,
		releaseProjectLock: async () => { releaseCalls += 1; },
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
		stopRecording: async () => undefined,
		store: {
			async duplicateProject() {
				duplicateCalls += 1;
				return { id: 'copy', title: 'Copy', revision: 1 };
			},
			async listProjects() { return []; },
		},
		switchProject: async () => undefined,
	};
	return {
		service: createProjectAdminService(runtime),
		save,
		duplicateCalls: () => duplicateCalls,
		openCalls: () => openCalls,
		releaseCalls: () => releaseCalls,
		replaceProject() { project = { id: 'project-b', title: 'Project B', revision: 1 }; },
		setFlush(value: () => Promise<void>) { flush = value; },
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

test('handoff returns a frozen identity only after flush and lock release', async () => {
	const fixture = createFixture();
	const handoff = await fixture.service.prepareProjectHandoff();
	assert.deepEqual(handoff, { projectId: 'project-a', revision: 3 });
	assert.equal(Object.isFrozen(handoff), true);
	assert.equal(fixture.releaseCalls(), 1);
});
