/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureAppBinding,
	createFramescaperCaptureAppProjectRepository,
	deriveFramescaperCaptureAppPublicationContext,
	type FramescaperCaptureAppHistory,
	type FramescaperCaptureAppProject,
} from '../src/common/editor/controller/framescaper-capture-app-binding.ts';
import { framescaperCaptureProjectFence } from '../src/common/editor/controller/framescaper-capture-project-publication-port.ts';
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
	assert.throws(() => createFramescaperCaptureAppBinding({
		productId: 'framescaper', routeSchemaVersion: 19, isDesktop: false,
	} as never), /dependencies are incomplete/iu);
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

test('binding initialization is media-cold and capture start flushes before reading its origin', async () => {
	const events: string[] = [];
	let mediaOpens = 0;
	let preparationFails = true;
	let activeProject = project(19, 4);
	let activeHistory = history(activeProject);
	let countdownEntered!: () => void;
	const enteredCountdown = new Promise<void>((resolve) => { countdownEntered = resolve; });
	const store = captureStore(activeProject);
	const binding = createFramescaperCaptureAppBinding({
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
		async prepareCaptureStart() {
			events.push('prepare:begin');
			await Promise.resolve();
			if (preparationFails) throw new Error('project flush failed');
			activeProject = project(19, 5);
			activeHistory = history(activeProject);
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
	events.length = 0;
	await assert.rejects(binding.actions.start(), /project flush failed/iu);
	assert.deepEqual(events, ['prepare:begin']);
	assert.equal(mediaOpens, 1);
	assert.equal(binding.originSnapshot('project-a').active, false);

	preparationFails = false;
	events.length = 0;
	const starting = binding.actions.start();
	await enteredCountdown;
	assert.ok(events.indexOf('prepare:end') < events.indexOf('origin:project'));
	assert.deepEqual(
		binding.originSnapshot('project-a').origin,
		{ ...framescaperCaptureProjectFence(activeProject), sequenceId: 'sequence-a', playheadMicroseconds: 500_000 },
	);
	await binding.actions.stop();
	await starting;
	await binding.dispose();
});

function project(
	schemaVersion: 18 | 19,
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
	return {
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
		},
		encodedCaptureSpoolRepository: {
			async create() { throw new Error('not reached'); }, async load() { return null; },
			async append() { throw new Error('not reached'); }, async seal() { throw new Error('not reached'); },
			async delete() {}, async *read() {},
		},
		rawPcmSpoolRepository: {
			async create() { throw new Error('not reached'); }, async load() { return null; },
			async append() { throw new Error('not reached'); }, async seal() { throw new Error('not reached'); },
			async remove() { return true; }, async *chunks() {},
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
