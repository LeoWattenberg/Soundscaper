/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureAppBinding,
	createFramescaperCaptureAppProjectRepository,
	deriveFramescaperCaptureAppPublicationContext,
	ensureFramescaperCaptureRecoveryOrigin,
	type FramescaperCaptureAppHistory,
	type FramescaperCaptureAppProject,
} from '../src/common/editor/controller/framescaper-capture-app-binding.ts';
import { createFramescaperCaptureAdminInterlock } from '../src/common/editor/controller/framescaper-capture-admin-interlock.ts';
import { FramescaperCaptureOriginProtectedError } from '../src/common/editor/controller/framescaper-capture-origin-guard.ts';
import { framescaperCaptureProjectFence } from '../src/common/editor/controller/framescaper-capture-project-publication-port.ts';
import { completeFramescaperCaptureRuntimeProbe } from '../src/common/editor/controller/framescaper-capture-runtime-probe.ts';
import type { FramescaperCaptureSessionManifestV1 } from '../src/common/editor/framescaper-capture-session-manifest.ts';

test('the app binding exists only on exact maintained Framescaper routes', () => {
	assert.equal(createFramescaperCaptureAppBinding({
		productId: 'soundscaper', routeSchemaVersion: 19, isDesktop: false,
	} as never), null);
	assert.equal(createFramescaperCaptureAppBinding({
		productId: 'framescaper', routeSchemaVersion: 18, isDesktop: false,
	} as never), null);
	assert.equal(createFramescaperCaptureAppBinding({
		productId: 'framescaper', routeSchemaVersion: 19, isDesktop: true,
	} as never), null);
	assert.equal(createFramescaperCaptureAppBinding({
		productId: 'framescaper', routeSchemaVersion: 27, isDesktop: false,
	} as never), null);
	assert.equal(createFramescaperCaptureAppBinding({
		productId: 'framescaper', routeSchemaVersion: 27, isDesktop: true,
	} as never), null);
	assert.throws(() => createFramescaperCaptureAppBinding({
		productId: 'framescaper', routeSchemaVersion: 19, isDesktop: false,
	} as never), /dependencies are incomplete/iu);
	assert.throws(() => createFramescaperCaptureAppBinding({
		productId: 'framescaper', routeSchemaVersion: 20, isDesktop: false,
	} as never), /dependencies are incomplete/iu);
	assert.throws(() => createFramescaperCaptureAppBinding({
		productId: 'framescaper', routeSchemaVersion: 20, isDesktop: true,
	} as never), /dependencies are incomplete/iu);
});

test('the selected V27 route never reaches capture runtime probing', async () => {
	assert.deepEqual(await completeFramescaperCaptureRuntimeProbe({
		productId: 'framescaper', routeSchemaVersion: 27, desktop: null,
	} as never), {
		status: 'unavailable', reason: 'unsupported-platform', detail: null,
	});
});

test('desktop binding without its capture bridge remains available as a truthful unavailable runtime', async () => {
	let activeProject = project(18, 4);
	let activeHistory = history(activeProject);
	const binding = createFramescaperCaptureAppBinding({
		adminInterlock: createFramescaperCaptureAdminInterlock(),
		productId: 'framescaper', routeSchemaVersion: 18, isDesktop: true, embedded: false,
		store: {
			async loadProject() { return activeProject; },
			async saveProject(value: FramescaperCaptureAppProject) { return value; },
			async listProjects() { return [activeProject]; },
		},
		sessionController: sessionController(() => activeHistory),
		projectRuntime: {
			createHistory: history,
			executeCommand() { throw new Error('publication is not reached'); },
		},
		getActiveProject: () => activeProject,
		getActiveHistory: () => activeHistory,
		getActivePlayheadFrame: () => 0,
		setActiveProject(value: FramescaperCaptureAppProject) { activeProject = value; },
		setActiveHistory(value: FramescaperCaptureAppHistory) { activeHistory = value; },
		synchronizeProject() {}, assertProjectWritable() {},
		async acquireProjectWriteAuthority() {
			return { assertCurrent() {}, async release() {} };
		},
		prepareCaptureStart() {}, getAudioContext: () => ({ sampleRate: 48_000 }),
		desktopBridge: null,
	} as never);

	assert.ok(binding);
	await binding.initialize();
	assert.deepEqual(binding.snapshot.availability, {
		status: 'unavailable', reason: 'unsupported-platform', detail: null,
	});
	await binding.dispose();
});

test('desktop project CAS uses the authoritative public store and propagates indeterminate saves', async () => {
	const base = project(18, 4);
	const target = project(18, 5);
	let current = base;
	let localSaves = 0;
	let publicSaves = 0;
	let failSave = false;
	const store = {
		projectRepository: {
			async load() { return current; },
			async saveIfCurrent() { localSaves += 1; throw new Error('local shadow reached'); },
		},
		async loadProject(_projectId: string, options?: Readonly<{ revision?: number }>) {
			return options?.revision === base.revision ? base : current;
		},
		async saveProject(value: FramescaperCaptureAppProject) {
			publicSaves += 1;
			if (failSave) throw new Error('desktop acknowledgement indeterminate');
			current = value;
			return value;
		},
	};
	const repository = createFramescaperCaptureAppProjectRepository({
		isDesktop: true, store,
	} as never);

	assert.deepEqual(await repository.saveIfCurrent(base, target), target);
	assert.equal(publicSaves, 1);
	assert.equal(localSaves, 0);
	assert.equal(await repository.saveIfCurrent(base, project(18, 6)), null);
	assert.equal(publicSaves, 1);

	current = base;
	failSave = true;
	await assert.rejects(
		Promise.resolve(repository.saveIfCurrent(base, target)),
		/acknowledgement indeterminate/iu,
	);
	assert.equal(localSaves, 0);
});

test('publication context reloads the exact inactive origin base and freezes its geometry', async () => {
	const base = project(19, 4, 'project-a');
	const advanced = project(19, 5, 'project-a');
	const loads: unknown[] = [];
	const captures: string[] = [];
	const context = await deriveFramescaperCaptureAppPublicationContext({
		routeSchemaVersion: 19,
		sessionController: {
			captureProjectHistory(projectId: string) {
				captures.push(projectId);
				return { history: history(advanced), token: 5 };
			},
		},
	} as never, {
		async load(projectId, options) {
			loads.push({ projectId, options });
			return projectId === base.id && options?.revision === base.revision ? base : null;
		},
		async saveIfCurrent() { throw new Error('not reached'); },
	}, manifest(base));

	assert.deepEqual(captures, ['project-a']);
	assert.deepEqual(loads, [{ projectId: 'project-a', options: { revision: 4 } }]);
	assert.deepEqual(context, {
		recordStartFrame: 24_000,
		projectSampleRate: 48_000,
		sequence: { id: 'sequence-a', rate: { num: 30, den: 1 } },
		trackInsertionIndex: 2,
	});
	assert.equal(Object.isFrozen(context), true);
});

test('closed recovery origins open as inactive history owners before recovery is exposed', async () => {
	const active = project(19, 4, 'project-active');
	const recovered = project(19, 7, 'project-recovered');
	const tabs = [{ projectId: active.id }];
	const openings: Readonly<Record<string, unknown>>[] = [];
	await ensureFramescaperCaptureRecoveryOrigin({ routeSchemaVersion: 19,
		sessionController: {
			getSnapshot: () => ({ tabs }),
			openProject(value: FramescaperCaptureAppProject, options: Readonly<Record<string, unknown>>) {
				tabs.push({ projectId: value.id }); openings.push(options);
			},
		}, projectRuntime: { createHistory: history },
	} as never, { load: async () => recovered, saveIfCurrent: async () => null }, recovered.id);
	assert.equal(tabs[0]?.projectId, active.id);
	assert.deepEqual(tabs.map(({ projectId }) => projectId), [active.id, recovered.id]);
	assert.equal(openings[0]?.activate, false);
	assert.equal(openings[0]?.readOnly, false);
});

test('binding initialization is media-cold and start reserves one writable origin across flush', async () => {
	const events: string[] = [];
	let mediaOpens = 0;
	let preparationFails = true;
	let mutateDuringPreparation: 'edit' | 'switch' | null = null;
	let writable = true;
	let releasePreparation: () => void = () => undefined;
	let reenterStart = false;
	let reenteredStart: Promise<void> | null = null;
	let reenteredDispose: Promise<void> | null = null;
	let activeProject = project(19, 4);
	let activeHistory = history(activeProject);
	let countdownEntered!: () => void;
	const enteredCountdown = new Promise<void>((resolve) => { countdownEntered = resolve; });
	const store = captureStore(activeProject);
	const adminInterlock = createFramescaperCaptureAdminInterlock();
	let binding: ReturnType<typeof createFramescaperCaptureAppBinding> = null;
	binding = createFramescaperCaptureAppBinding({
		adminInterlock,
		productId: 'framescaper', routeSchemaVersion: 19, isDesktop: false, embedded: false,
		store,
		sessionController: sessionController(() => activeHistory),
		projectRuntime: {
			createHistory: history,
			executeCommand() { throw new Error('publication is not reached'); },
		},
		getActiveProject() { events.push('origin:project'); return activeProject; },
		getActiveHistory() { events.push('origin:history'); return activeHistory; },
		getActivePlayheadFrame() { events.push('origin:playhead'); return 24_000; },
		setActiveProject(value: FramescaperCaptureAppProject) { activeProject = value; },
		setActiveHistory(value: FramescaperCaptureAppHistory) { activeHistory = value; },
		synchronizeProject() {},
		assertProjectWritable() {
			if (!writable) throw new Error('Capture origin is read-only.');
		},
		async acquireProjectWriteAuthority() {
			return { assertCurrent() {}, async release() {} };
		},
		async prepareCaptureStart() {
			events.push('prepare:begin');
			await new Promise<void>((resolve) => { releasePreparation = resolve; });
			if (preparationFails) throw new Error('project flush failed');
			if (mutateDuringPreparation) {
				activeProject = project(19, mutateDuringPreparation === 'edit' ? 5 : 4,
					mutateDuringPreparation === 'edit' ? 'project-a' : 'project-b');
				activeHistory = history(activeProject);
			}
			events.push('prepare:end');
		},
		mediaDevices: {
			async getUserMedia() { mediaOpens += 1; return stream([track('camera-track', 'video')]); },
			async getDisplayMedia() { mediaOpens += 1; return stream([track('display-track', 'video')]); },
			async enumerateDevices() { return []; },
		},
		createStream: (tracks: readonly ReturnType<typeof track>[]) => stream(tracks),
		MediaRecorder: FakeMediaRecorder,
		MediaStreamTrackProcessor: class {},
		getAudioContext: () => ({ sampleRate: 48_000 }),
		videoProbe: async () => ({
			backend: 'test', nominalRate: { num: 30, den: 1 },
			timing: { timescale: 30, presentationTicks: [0n], finalFrameDurationTicks: 1n },
			width: 1_920, height: 1_080,
			characteristics: videoCharacteristics(),
		}),
		waitCountdown: (_durationMs: number, signal: AbortSignal) => new Promise<void>((resolve) => {
			events.push('countdown');
			countdownEntered();
			signal.addEventListener('abort', () => { resolve(); }, { once: true });
		}),
		createId: (prefix: string) => `${prefix}-test`,
		onChange: () => {
			if (!reenterStart || !binding) return;
			reenterStart = false;
			reenteredStart = binding.actions.start();
			reenteredDispose = binding.dispose();
		},
	} as never);
	assert.ok(binding);
	assert.equal(mediaOpens, 0, 'construction does not request capture permission');
	await binding.initialize();
	assert.equal(binding.snapshot.availability.status, 'available');
	assert.equal(mediaOpens, 0, 'initialization only probes capabilities');

	events.length = 0;
	await binding.actions.requestPreview(['camera']);
	assert.equal(mediaOpens, 1);
	binding.actions.arm({ destination: 'both', countdownMs: 3_000 });
	const deletion = adminInterlock.beginAdminOperation({ kind: 'delete', projectId: 'project-a' });
	await assert.rejects(binding.actions.start(), /active delete authority/iu);
	assert.equal(events.includes('prepare:begin'), false);
	deletion.release();
	writable = false;
	await assert.rejects(binding.actions.start(), /read-only/iu);
	assert.equal(events.includes('prepare:begin'), false);
	writable = true;
	events.length = 0;
	const failedStart = binding.actions.start();
	assert.throws(() => binding.assertOriginEditAllowed('project-a'), /protects project-a from edit/iu);
	assert.throws(
		() => adminInterlock.beginAdminOperation({ kind: 'handoff', projectId: 'project-a' }),
		/active capture authority/iu,
	);
	assert.equal(binding.originSnapshot('project-a').editBlocked, true);
	releasePreparation();
	await assert.rejects(failedStart, /project flush failed/iu);
	assert.ok(events.indexOf('origin:project') < events.indexOf('prepare:begin'));
	assert.equal(mediaOpens, 1);
	assert.equal(binding.originSnapshot('project-a').active, false);
	adminInterlock.beginAdminOperation({ kind: 'close', projectId: 'project-a' }).release();

	preparationFails = false;
	mutateDuringPreparation = 'edit';
	events.length = 0;
	const changedStart = binding.actions.start();
	releasePreparation();
	await assert.rejects(changedStart, /origin changed during start admission/iu);
	assert.equal(binding.originSnapshot('project-a').active, false);
	activeProject = project(19, 4);
	activeHistory = history(activeProject);
	mutateDuringPreparation = 'switch';
	const switchedStart = binding.actions.start();
	releasePreparation();
	await assert.rejects(switchedStart, /origin changed during start admission/iu);
	activeProject = project(19, 4);
	activeHistory = history(activeProject);
	mutateDuringPreparation = null;
	events.length = 0;
	const starting = binding.actions.start();
	assert.deepEqual(
		binding.originSnapshot('project-a').origin,
		{ ...framescaperCaptureProjectFence(activeProject), sequenceId: 'sequence-a', playheadMicroseconds: 500_000 },
	);
	releasePreparation();
	await enteredCountdown;
	assert.deepEqual(
		binding.originSnapshot('project-a').origin,
		{ ...framescaperCaptureProjectFence(activeProject), sequenceId: 'sequence-a', playheadMicroseconds: 500_000 },
	);
	const boundSnapshot = binding.originSnapshot('project-a');
	assert.throws(
		() => binding.assertOriginEditAllowed('project-a'),
		(error: unknown) => error instanceof FramescaperCaptureOriginProtectedError
			&& error.generation === boundSnapshot.generation,
		'bound protection errors use the generation exposed by the origin snapshot',
	);
	await binding.actions.stop();
	await starting;
	await binding.actions.requestPreview(['camera']);
	binding.actions.arm({ destination: 'both', countdownMs: 3_000 });
	reenterStart = true;
	const admitted = binding.actions.start();
	assert.equal(reenteredStart, admitted, 'observer reentry shares the synchronously registered start');
	assert.ok(reenteredDispose);
	releasePreparation();
	await assert.rejects(admitted, /disposed during start admission/iu);
	await reenteredDispose;
});

function project(
	schemaVersion: 18 | 19 | 20,
	revision: number,
	id = 'project-a',
): FramescaperCaptureAppProject {
	return Object.freeze({
		id, schemaVersion, revision, updatedAt: '2026-08-20T10:00:00.000Z',
		title: 'Capture origin', sampleRate: 48_000,
		primarySequenceId: 'sequence-a',
		sequences: Object.freeze([Object.freeze({
			id: 'sequence-a', rate: Object.freeze({ num: 30, den: 1 }),
			trackIds: Object.freeze(['track-a', 'track-b']),
		})]),
		sources: Object.freeze([]), clips: Object.freeze([]), tracks: Object.freeze([]),
	});
}

function history(value: FramescaperCaptureAppProject): FramescaperCaptureAppHistory {
	return Object.freeze({ present: value, undoStack: Object.freeze([]), redoStack: Object.freeze([]), limit: 100 });
}

function manifest(value: FramescaperCaptureAppProject): FramescaperCaptureSessionManifestV1 {
	const result: FramescaperCaptureSessionManifestV1 = {
		version: 1, sessionId: 'session-a', generation: 1, state: 'sealed', recoveryDecision: null,
		projectFence: framescaperCaptureProjectFence(value),
		origin: { sequenceId: 'sequence-a', playheadMicroseconds: 500_000, destination: 'both' },
		clock: { monotonicOriginMicroseconds: 1_000, pauseSpans: Object.freeze([]) },
		streams: Object.freeze([{
			streamId: 'camera-stream', role: 'camera', required: true, playability: 'unknown',
			timing: { firstPresentationMicroseconds: 0, lastPresentationEndMicroseconds: 1_000 },
			storage: {
				kind: 'encoded-media', spoolId: 'camera-spool', spoolToken: 'camera-token',
				sourceId: 'camera-source', mimeType: 'video/webm', packetCount: 1,
				chunkCount: 1, byteLength: 1,
			},
		}]),
		createdAt: 1, updatedAt: 1,
	};
	return Object.freeze(result);
}

function sessionController(getHistory: () => FramescaperCaptureAppHistory) {
	const tabs = [{ projectId: getHistory().present.id }];
	return {
		getSnapshot() { return { tabs }; },
		openProject(value: FramescaperCaptureAppProject) { tabs.push({ projectId: value.id }); },
		captureProjectHistory() { return { history: getHistory(), token: 1 }; },
		beginProjectActivation() { return { token: 1, release: () => true }; },
		installCommittedProjectHistory() {},
		getProjectHistory() { return getHistory(); },
		markProjectSaved() {},
	};
}

function captureStore(value: FramescaperCaptureAppProject) {
	return {
		projectRepository: {
			async load(_id: string, options?: Readonly<{ revision?: number }>) {
				return options?.revision === undefined || options.revision === value.revision ? value : null;
			},
			async saveIfCurrent() { throw new Error('publication is not reached'); },
		},
		async listProjects() { return [value]; },
		framescaperCaptureManifestRepository: {
			async create(input: unknown) { return input; }, async load() { return null; },
			async listProject() { return []; }, async replace(_expected: unknown, next: unknown) { return next; },
			async remove() {},
			async createCreation(input: unknown) { return input; },
			async listProjectCreations() { return []; }, async listCreations() { return []; },
			async loadCreation() { return null; },
			async publishCreation(_expected: unknown, input: unknown) { return input; },
			async replaceCreation(_expected: unknown, next: unknown) { return next; },
			async removeCreation() {},
		},
		encodedCaptureSpoolRepository: {
			async create() { throw new Error('not reached'); }, async load() { return null; },
			async append() { throw new Error('not reached'); }, async seal() { throw new Error('not reached'); },
			async delete() {}, async releaseAdopted() {},
			async reconcileAppend(current: unknown) { return current; },
			async restoreAcknowledgedPrefix() { throw new Error('not reached'); }, async *read() {},
		},
		rawPcmSpoolRepository: {
			async create() { throw new Error('not reached'); },
			async createFramescaper() { throw new Error('not reached'); }, async load() { return null; },
			async append() { throw new Error('not reached'); }, async seal() { throw new Error('not reached'); },
			async remove() { return true; }, async releaseReservation() { return true; },
			async reconcileAppend(current: unknown) { return current; },
			async restoreAcknowledgedPrefix() { throw new Error('not reached'); }, async *chunks() {},
		},
		async getSourceMetadata() { return null; }, async beginSourceWrite() { throw new Error('not reached'); },
		async discardSourceIfCurrent() { return true; }, async getMediaAssetMetadata() { return null; },
		async beginMediaAssetWrite() { throw new Error('not reached'); }, async loadMediaAsset() { return null; },
	};
}

function track(id: string, kind: string) {
	return { id, kind, stop() {}, getSettings: () => ({ width: 1_920, height: 1_080 }), getCapabilities: () => ({}) };
}

function stream(tracks: readonly ReturnType<typeof track>[]) {
	return {
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter(({ kind }) => kind === 'audio'),
		getVideoTracks: () => tracks.filter(({ kind }) => kind === 'video'),
	};
}

class FakeMediaRecorder {
	static isTypeSupported(value: string) { return value.startsWith('video/webm'); }
	readonly mimeType = 'video/webm'; readonly state = 'inactive';
	ondataavailable = null; onerror = null; onstop = null;
	start() {} pause() {} resume() {} requestData() {} stop() {}
}

function videoCharacteristics() {
	return {
		backend: 'test', codedWidth: 1_920, codedHeight: 1_080, rotationDegrees: 0,
		pixelAspectRatio: { num: 1, den: 1 }, fieldOrder: 'progressive', hasAlpha: false,
		videoCodec: 'vp8', colour: { primaries: null, transfer: null, matrix: null, range: null },
		audioStreams: null, extractedAudioStreamIndex: null, startTimecode: null,
	};
}
