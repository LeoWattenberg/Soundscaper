/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts';
import type { ProjectLifecycleLock } from '../src/common/editor/controller/project-lifecycle-types.ts';
import { PLAYBACK_PROJECT_APPLY_TASK } from '../src/common/editor/controller/playback-project-service.ts';
import { PROJECT_BIN_LINKED_VIDEO_RELINK_TASK } from '../src/common/editor/controller/project-bin-linked-video-relink-service.ts';
import { SCAPE_INSPECTION_TASK, createScapeInspectionService } from '../src/common/editor/controller/scape-inspection-service.ts';
import { SCAPE_OPEN_REQUEST_TASK } from '../src/common/editor/controller/scape-open-request-service.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_SCHEMA_VERSION } from '../src/common/editor/project-schema-identity.ts';
import { createFixture, deferred, lock, project } from './helpers/audio-editor-project-switch-fixture.ts';

test('project activation resets scoped state and publishes only after sources are loaded', async () => {
	const fixture = createFixture();
	const nativeSave = fixture.lifetime.startTask('native-project-save'), playbackApply = fixture.lifetime.startTask(PLAYBACK_PROJECT_APPLY_TASK), linkedVideoRelink = fixture.lifetime.startTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK);
	playbackApply.signal.addEventListener('abort', () => { fixture.events.push('abort-playback-apply'); }, { once: true });
	const next = project('next-project', [
		{ id: 'labels', type: 'label' }, { id: 'audio', type: 'audio' },
	]);

	await fixture.service.switchProject(next, { save: true });

	assert.equal(fixture.getProject(), next);
	assert.equal(fixture.state.selectedTrackId, 'audio');
	assert.equal(fixture.state.analysisResult, null);
	assert.equal(fixture.state.sampleEditMode, null);
	assert.equal(fixture.state.missingSourceIds.size, 0);
	assert.equal(fixture.state.outputUrl, null);
	assert.deepEqual(fixture.revokedUrls, ['blob:old-output']);
	assert.equal(fixture.initialLock.releases, 1);
	assert.ok(fixture.events.indexOf('load-sources:next-project') < fixture.events.indexOf('engine-load:next-project'));
	assert.ok(fixture.events.indexOf('stop-engine') < fixture.events.indexOf('stop-preview') && fixture.events.indexOf('stop-preview') < fixture.events.indexOf('dispose-render-engines') && fixture.events.indexOf('dispose-render-engines') < fixture.events.indexOf('begin-provider-replacement'));
	assert.ok(fixture.events.indexOf('engine-load:next-project') < fixture.events.indexOf('publish'));
	assert.ok(fixture.events.includes('save-now'));
	assert.ok(fixture.events.includes('save-project:next-project') && !fixture.events.includes('maintain-opened:next-project'));
	assert.equal(fixture.state.readOnly, false);
	assert.equal(fixture.getTabMetadata(next.id)?.featureRequirementsReport != null, true);
	assert.equal(fixture.getTabMetadata(next.id)?.featureRequirementsAudioEffectPlaybackBypass, null);
	assert.equal(nativeSave.signal.aborted, true);
	assert.ok(playbackApply.signal.aborted && playbackApply.signal.reason instanceof DOMException && playbackApply.signal.reason.name === 'AbortError'); assert.equal(linkedVideoRelink.signal.aborted, true);
	assert.ok(fixture.events.indexOf('abort-playback-apply') < fixture.events.indexOf('stop-recording'));
	fixture.projectGeneration.assertCurrent(fixture.projectGeneration.capture('next-project'));
	const previewFailure = new Error('preview disposal failed');
	fixture.setStopPreview(async () => { fixture.events.push('stop-preview:failed'); throw previewFailure; });
	await assert.rejects(fixture.service.switchProject(project('preview-failure')), (error) => error === previewFailure);
	assert.equal(fixture.events.filter((event) => event === 'begin-provider-replacement').length, 1);
	fixture.setStopPreview(async () => { fixture.events.push('stop-preview'); }); const renderFailure = new Error('render-engine disposal failed');
	fixture.setDisposeRenderEngines(async () => { fixture.events.push('dispose-render-engines:failed'); throw renderFailure; });
	await assert.rejects(fixture.service.switchProject(project('render-failure')), (error) => error === renderFailure); assert.equal(fixture.events.filter((event) => event === 'begin-provider-replacement').length, 1);
});

test('reactivating the active project preserves playback and project-scoped tasks', async () => {
	const fixture = createFixture();
	const activeProject = fixture.getProject();
	assert.ok(activeProject);
	fixture.projectGeneration.activate(activeProject.id);
	const projectGeneration = fixture.projectGeneration.capture(activeProject.id);
	const tasks = [
		fixture.lifetime.startTask('native-project-save'),
		fixture.lifetime.startTask(PLAYBACK_PROJECT_APPLY_TASK),
		fixture.lifetime.startTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK),
		fixture.lifetime.startTask(SCAPE_INSPECTION_TASK),
		fixture.lifetime.startTask(SCAPE_OPEN_REQUEST_TASK),
	];
	const exportAbort = fixture.state.exportAbort;
	const sampleEditAbort = fixture.state.sampleEditAbort;
	const sameIdReload = { ...activeProject, title: 'Newer same-ID document' };

	await fixture.service.switchProject(activeProject);
	await fixture.service.openProject(sameIdReload);

	assert.deepEqual(fixture.events, []);
	assert.ok(tasks.every(({ signal }) => !signal.aborted));
	assert.equal(exportAbort?.signal.aborted, false);
	assert.equal(sampleEditAbort?.signal.aborted, false);
	assert.strictEqual(fixture.state.exportAbort, exportAbort);
	assert.strictEqual(fixture.state.sampleEditAbort, sampleEditAbort);
	assert.strictEqual(fixture.getProject(), activeProject);
	assert.notStrictEqual(fixture.getProject(), sameIdReload);
	assert.equal(fixture.initialLock.releases, 0);
	fixture.projectGeneration.assertCurrent(projectGeneration);
});

test('active-project deduplication preserves a queued reversal intent', async () => {
	const fixture = createFixture();
	const activeProject = fixture.getProject();
	assert.ok(activeProject);
	const queueGate = deferred<void>();
	fixture.state.projectQueue = queueGate.promise;

	const away = fixture.service.switchProject(project('next-project'));
	const back = fixture.service.switchProject(activeProject);
	queueGate.resolve();
	await Promise.all([away, back]);

	assert.strictEqual(fixture.getProject(), activeProject);
	assert.deepEqual(fixture.events.filter((event) => event.startsWith('engine-load:')), [
		'engine-load:next-project',
		'engine-load:old-project',
	]);
});

test('project switch waits for a suspended origin save and flushes its edit before activation', async () => {
	const fixture = createFixture();
	type FixtureProject = NonNullable<ReturnType<typeof fixture.getProject>>;
	const editedOrigin = { ...fixture.getProject() as FixtureProject, revision: 1 };
	fixture.setProject(editedOrigin);
	let dirty = true;
	const written: FixtureProject[] = [];
	const flushStarted = deferred<void>();
	const saveState = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<FixtureProject>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'dirty',
	};
	const saves = createProjectSaveService<FixtureProject>({
		state: saveState,
		getProject: fixture.getProject,
		hasHistory: () => true,
		hasUnsavedProjectChanges: () => dirty,
		isReadOnly: () => false,
		cloneProject: structuredClone,
		admitProjectPublication: async () => undefined,
		saveProject: async (snapshot) => { written.push(snapshot); },
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => fixture.getProject()?.id === projectId,
		hasSessionTab: () => true,
		markProjectSaved: () => { dirty = false; },
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: () => undefined,
	});
	fixture.setSaveNow(async () => {
		flushStarted.resolve();
		await saves.flushProject();
	});
	saves.suspendProject(editedOrigin.id);

	const switching = fixture.service.switchProject(project('next-project'));
	await flushStarted.promise;
	let settled = false;
	void switching.finally(() => { settled = true; });
	await Promise.resolve();
	assert.equal(settled, false);
	assert.strictEqual(fixture.getProject(), editedOrigin);
	assert.deepEqual(written, []);

	assert.equal(saves.resumeProject(editedOrigin.id), true);
	await switching;
	assert.deepEqual(written.map(({ id, revision }) => ({ id, revision })), [{
		id: editedOrigin.id,
		revision: editedOrigin.revision,
	}]);
	assert.equal(dirty, false);
	assert.equal(fixture.getProject()?.id, 'next-project');
});

test('pending recovery inspects before open mutations and resumes them in authority order', async () => {
	const fixture = createFixture();
	fixture.setPendingRecovery('pending-project');
	await fixture.service.switchProject(project('pending-project'), { save: true });

	const inspection = fixture.events.indexOf('inspect-recovery:pending-project');
	assert.ok(inspection < fixture.events.indexOf('load-routing:pending-project'));
	assert.equal(fixture.events.includes('record-opened:pending-project'), false);
	assert.equal(fixture.events.includes('save-project:pending-project'), false);
	assert.equal(fixture.events.includes('gc'), false);
	assert.deepEqual(fixture.events.filter((event) => event.startsWith('defer:')), [
		'defer:record', 'defer:save', 'defer:gc',
	]);
	await fixture.resolveRecovery();
	assert.deepEqual(fixture.events.filter((event) => (
		event === 'record-opened:pending-project'
		|| event === 'save-project:pending-project'
		|| event === 'gc'
	)), ['record-opened:pending-project', 'save-project:pending-project', 'gc']);
});

test('switching away from pending recovery never flushes the old project', async () => {
	const fixture = createFixture();
	fixture.setRecoveryBlocked(true);
	await fixture.service.switchProject(project('clean-project'));
	assert.equal(fixture.events.includes('save-now'), false);
	assert.equal(fixture.events.includes('record-opened:clean-project'), true);
});

test('project activation aborts in-flight Scape ownership before a queued switch can start', async () => {
	const fixture = createFixture();
	const queueGate = deferred<void>();
	fixture.state.projectQueue = queueGate.promise;
	const inspection = fixture.lifetime.startTask(SCAPE_INSPECTION_TASK);
	const openRequest = fixture.lifetime.startTask(SCAPE_OPEN_REQUEST_TASK);
	inspection.signal.addEventListener('abort', () => { fixture.events.push('abort-inspection'); }, { once: true });
	openRequest.signal.addEventListener('abort', () => { fixture.events.push('abort-open-request'); }, { once: true });

	const switching = fixture.service.switchProject(project('next-project'));

	assert.equal(inspection.signal.aborted, true);
	assert.ok(inspection.signal.reason instanceof DOMException);
	assert.equal(inspection.signal.reason.name, 'AbortError');
	assert.equal(openRequest.signal.aborted, true);
	assert.ok(openRequest.signal.reason instanceof DOMException);
	assert.equal(openRequest.signal.reason.name, 'AbortError');
	assert.equal(fixture.events.includes('stop-recording'), false);
	queueGate.resolve();
	await switching;
	assert.ok(fixture.events.indexOf('abort-inspection') < fixture.events.indexOf('stop-recording'));
	assert.ok(fixture.events.indexOf('abort-open-request') < fixture.events.indexOf('stop-recording'));
});

test('project activation joins every superseded Scape inspection before project work', async () => {
	const fixture = createFixture();
	const firstStarted = deferred<void>();
	const secondStarted = deferred<void>();
	const firstCleanup = deferred<string>();
	const secondCleanup = deferred<string>();
	const signals: AbortSignal[] = [];
	let calls = 0;
	const inspection = createScapeInspectionService<string>({
		lifetime: fixture.lifetime,
		scapeInspectionQuiescence: fixture.scapeInspectionQuiescence,
		store: null,
		inspectScapeProject: async (_file, _store, options) => {
			const index = calls++;
			signals[index] = options.signal;
			if (index === 0) {
				firstStarted.resolve();
				return firstCleanup.promise;
			}
			secondStarted.resolve();
			return secondCleanup.promise;
		},
	});

	const first = inspection.inspect(new Blob(['first']));
	await firstStarted.promise;
	const firstRejected = assert.rejects(first, (error) => error === signals[0]?.reason);
	const second = inspection.inspect(new Blob(['second']));
	await secondStarted.promise;
	const secondRejected = assert.rejects(second, (error) => error === signals[1]?.reason);
	assert.equal(signals[0]?.aborted, true, 'replacement must synchronously cancel the older generation');

	const switching = fixture.service.switchProject(project('next-project'));
	assert.equal(signals[1]?.aborted, true, 'switch admission must synchronously cancel the current generation');
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(fixture.events.includes('stop-recording'), false);

	secondCleanup.resolve('late second result');
	await secondRejected;
	await Promise.resolve();
	assert.equal(
		fixture.events.includes('stop-recording'),
		false,
		'a superseded predecessor must remain joined after the current generation cleans up',
	);

	firstCleanup.resolve('late first result');
	await firstRejected;
	await switching;
	assert.ok(fixture.events.includes('stop-recording'));
});

test('direct project activation fences and joins Scape inspection cleanup', async () => {
	const fixture = createFixture();
	const started = deferred<void>();
	const cleanup = deferred<string>();
	const capture: { signal: AbortSignal | null } = { signal: null };
	const inspection = createScapeInspectionService<string>({
		lifetime: fixture.lifetime,
		scapeInspectionQuiescence: fixture.scapeInspectionQuiescence,
		store: null,
		inspectScapeProject: (_file, _store, options) => {
			capture.signal = options.signal;
			started.resolve();
			return cleanup.promise;
		},
	});
	const pending = inspection.inspect(new Blob(['direct']));
	await started.promise;
	const rejected = assert.rejects(pending, (error) => error === capture.signal?.reason);

	const switching = fixture.service.performProjectSwitch(project('direct-project'));
	assert.equal(capture.signal?.aborted, true);
	assert.ok(capture.signal?.reason instanceof DOMException);
	await Promise.resolve();
	assert.equal(fixture.events.includes('stop-recording'), false);

	cleanup.resolve('late result');
	await rejected;
	await switching;
	assert.ok(fixture.events.includes('stop-recording'));
	assert.equal(await inspection.inspect(new Blob(['after direct switch'])), 'late result');
});

test('Scape cleanup failure rejects activation before project work and releases its fence', async () => {
	const fixture = createFixture();
	const cleanupStarted = deferred<void>();
	const cleanupRelease = deferred<void>();
	const cleanupFailure = new AggregateError(
		[new Error('archive close failed')],
		'The .scape operation and archive-reader cleanup both failed.',
	);
	let calls = 0;
	const capture: { signal: AbortSignal | null } = { signal: null };
	const inspection = createScapeInspectionService<string>({
		lifetime: fixture.lifetime,
		scapeInspectionQuiescence: fixture.scapeInspectionQuiescence,
		store: null,
		inspectScapeProject: async (_file, _store, options) => {
			calls += 1;
			if (calls > 1) return 'inspection after failed switch';
			capture.signal = options.signal;
			await new Promise<void>((resolve) => {
				options.signal.addEventListener('abort', () => resolve(), { once: true });
			});
			cleanupStarted.resolve();
			await cleanupRelease.promise;
			throw cleanupFailure;
		},
	});
	const pending = inspection.inspect(new Blob(['cleanup failure']));
	const inspectionRejected = assert.rejects(pending, (error) => error === cleanupFailure);

	const switching = fixture.service.switchProject(project('blocked-project'));
	assert.equal(capture.signal?.aborted, true);
	await cleanupStarted.promise;
	await Promise.resolve();
	assert.equal(fixture.events.includes('stop-recording'), false);

	cleanupRelease.resolve();
	await inspectionRejected;
	await assert.rejects(switching, (error) => error === cleanupFailure);
	assert.equal(fixture.events.includes('stop-recording'), false);
	assert.equal(fixture.getProject()?.id, 'old-project');
	assert.equal(
		await inspection.inspect(new Blob(['after failed switch'])),
		'inspection after failed switch',
		'a failed quiescence drain must still release its temporary admission fence',
	);
});

test('queued project switches keep Scape inspection fenced until the last switch exits', async () => {
	const fixture = createFixture();
	const firstStarted = deferred<void>();
	const firstRelease = deferred<void>();
	const secondStarted = deferred<void>();
	const secondRelease = deferred<void>();
	fixture.setLoadSources(async (value) => {
		if (value.id === 'first') {
			firstStarted.resolve();
			await firstRelease.promise;
		}
		if (value.id === 'second') {
			secondStarted.resolve();
			await secondRelease.promise;
		}
	});
	let inspectionCalls = 0;
	const inspection = createScapeInspectionService<string>({
		lifetime: fixture.lifetime,
		scapeInspectionQuiescence: fixture.scapeInspectionQuiescence,
		store: null,
		inspectScapeProject: () => {
			inspectionCalls += 1;
			return 'accepted';
		},
	});
	const assertInspectionFenced = async () => {
		await assert.rejects(
			inspection.inspect(new Blob(['blocked'])),
			(error) => error instanceof DOMException && error.name === 'AbortError',
		);
		assert.equal(inspectionCalls, 0);
	};

	const first = fixture.service.switchProject(project('first'));
	await firstStarted.promise;
	const second = fixture.service.switchProject(project('second'));
	await assertInspectionFenced();

	firstRelease.resolve();
	await first;
	await assertInspectionFenced();
	await secondStarted.promise;
	await assertInspectionFenced();

	secondRelease.resolve();
	await second;
	assert.equal(await inspection.inspect(new Blob(['accepted'])), 'accepted');
	assert.equal(inspectionCalls, 1);
});

test('the project queue prevents a second activation from overlapping source loading', async () => {
	const fixture = createFixture();
	const firstGate = deferred<void>();
	const firstStarted = deferred<void>();
	fixture.setLoadSources(async (value) => {
		if (value.id !== 'first') return;
		firstStarted.resolve();
		await firstGate.promise;
	});

	const first = fixture.service.switchProject(project('first'));
	await firstStarted.promise;
	const second = fixture.service.switchProject(project('second'));
	await Promise.resolve();
	assert.equal(fixture.events.includes('acquire-lock:second'), false);

	firstGate.resolve();
	await Promise.all([first, second]);
	assert.deepEqual(
		fixture.events.filter((event) => event.startsWith('engine-load:')),
		['engine-load:first', 'engine-load:second'],
	);
	assert.equal(fixture.getProject()?.id, 'second');
	assert.deepEqual(fixture.events.filter((event) => event.startsWith('maintain-opened:')), ['maintain-opened:first', 'maintain-opened:second']);
});
test('a lock acquired after terminal disposal is released without activating the project', async () => {
	const fixture = createFixture();
	const acquired = deferred<ProjectLifecycleLock>();
	const acquisitionStarted = deferred<void>();
	const lateLock = lock('late-project');
	fixture.setAcquire(async () => {
		acquisitionStarted.resolve();
		return acquired.promise;
	});

	const activation = fixture.service.switchProject(project('late-project'));
	await acquisitionStarted.promise;
	fixture.lifetime.beginDisposal();
	acquired.resolve(lateLock);

	await assert.rejects(() => activation, { code: 'DISPOSED' });
	assert.equal(lateLock.releases, 1);
	assert.equal(fixture.getProject()?.id, 'old-project');
	assert.equal(fixture.events.includes('engine-load:late-project'), false);
	assert.ok(fixture.events.includes('clear-source-caches'));
});

test('new and loaded projects preserve preparation and read-only semantics', async () => {
	const fixture = createFixture();
	await fixture.service.newProject({ title: '   ', sampleRate: 44_100 });
	assert.deepEqual([fixture.getProject()?.title, fixture.getProject()?.sampleRate, fixture.getProject()?.tracks[0]?.name], ['Untitled', 44_100, 'Track 1']);
	assert.equal(Object.hasOwn(fixture.getProject()?.tracks[0] ?? {}, 'schemaVersion'), false);
	assert.deepEqual(fixture.assignedTracks, ['prepared-track']);

	fixture.setLoadReadOnly(true);
	const future = { ...project('future-project'), schemaVersion: PROJECT_SCHEMA_VERSION + 1,
		get featureRequirements(): never { throw new Error('future feature metadata was traversed'); } };
	await fixture.service.openProject(future);
	assert.equal(fixture.getProject(), future);
	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.getTabMetadata(future.id)?.featureRequirementsReport, null);
	assert.deepEqual(fixture.statuses.at(-1), ['Future project', 'error']);
	await fixture.service.switchProject(project(future.id), { readOnly: false });
	assert.equal(fixture.getProject(), future);
	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.events.includes('maintain-opened:future-project'), false);
});
test('read-only foreign custody never enters source garbage collection', async () => {
	const fixture = createFixture();
	fixture.setLoadReadOnly(true);
	const foreign = {
		...project('foreign-project'),
		schemaFamily: 'framescaper' as const,
	};

	await fixture.service.openProject(foreign);

	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.getProject(), foreign);
	assert.equal(fixture.events.includes('gc'), false);
});
test('new selected-schema projects use create-only initial publication', async () => {
	const fixture = createFixture(undefined, { createOnly: true });
	await fixture.service.newProject({ title: 'Created once' });
	assert.deepEqual(
		fixture.events.filter((event) => event.startsWith('create-project:') || event.startsWith('save-project:')),
		['create-project:created-1'],
	);
	assert.equal(fixture.createdProjects[0]?.revision, 0);
	assert.equal(fixture.createdProjects[0]?.tracks[0]?.name, 'Track 1');
});
test('feature compatibility transiently bypasses affected audio effects before engine activation', async () => {
	const fixture = createFixture({ audioEffects: false, videoEffects: false });
	const effect = { id: 'compressor-a', type: 'compressor', enabled: true, bypassed: false, params: { threshold: -24 } };
	const next = { ...project('feature-project', [{ id: 'audio-a', type: 'audio', effectsActive: true, effects: [effect] }]), schemaVersion: PROJECT_SCHEMA_VERSION,
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'audio-effects', featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects, displayName: 'Audio effects', disposition: 'bypass', fallback: null,
		}],
	} };
	await fixture.service.switchProject(next, { save: true });
	const metadata = fixture.getTabMetadata(next.id);
	const report = metadata?.featureRequirementsReport as Readonly<Record<string, unknown>>;
	assert.equal(fixture.state.readOnly, true);
	assert.equal(report.compatible, false);
	assert.equal(metadata?.featureRequirementsReadOnly, true);
	assert.deepEqual(metadata?.featureRequirementsAudioEffectPlaybackBypass, {
		schemaVersion: 1, featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		requirementIds: ['audio-effects'], placeholders: [{ scope: 'track', ownerId: 'audio-a', effectId: 'compressor-a', effectType: 'compressor' }],
	});
	assert.strictEqual(fixture.getProject()?.tracks[0]?.effects?.[0], effect);
	assert.deepEqual(fixture.getLoadedEngineProject()?.tracks[0]?.effects?.[0], { id: 'compressor-a', type: 'compressor', enabled: true, bypassed: true, params: {} });
	assert.equal(fixture.events.includes('save-project:feature-project'), false);
	assert.deepEqual(fixture.statuses.at(-1), ['Read-only', 'error']);
	await fixture.service.switchProject(project(next.id));
	assert.equal(fixture.getProject(), next);
	assert.equal(fixture.getLoadedEngineProject()?.tracks[0]?.effects?.[0]?.bypassed, true);
	assert.equal(fixture.state.readOnly, true);
	assert.equal((fixture.getTabMetadata(next.id)?.featureRequirementsReport as typeof report).compatible, false);
	const historyProject = { ...next, id: 'history-project', title: 'history-project' };
	await fixture.service.switchProject(project(historyProject.id), { history: { present: historyProject } });
	assert.deepEqual(fixture.getProject(), historyProject);
	assert.equal(fixture.state.readOnly, true);
});
test('malformed current feature metadata rejects before project activation side effects', async () => {
	const fixture = createFixture();
	const malformed = {
		...project('malformed-feature-project'), schemaVersion: PROJECT_SCHEMA_VERSION,
		featureRequirements: { schemaVersion: 1, requirements: {} },
	};
	await assert.rejects(fixture.service.switchProject(malformed), /requirements must be an array/iu);
assert.equal(fixture.getProject()?.id, 'old-project');
	assert.deepEqual(fixture.events, []);
});
