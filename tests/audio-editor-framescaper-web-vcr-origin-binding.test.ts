/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureAppBinding,
	type FramescaperCaptureAppHistory,
	type FramescaperCaptureAppProject,
} from '../src/common/editor/controller/framescaper-capture-app-binding.ts';
import { createFramescaperCaptureAdminInterlock } from '../src/common/editor/controller/framescaper-capture-admin-interlock.ts';
import { framescaperCaptureProjectFence } from '../src/common/editor/controller/framescaper-capture-project-publication-port.ts';

const ID = 'a'.repeat(32);

test('Web VCR keeps the clicked project and playhead protected across a background switch', async () => {
	const first = project('project-a', 4);
	const second = project('project-b', 9);
	const firstFence = framescaperCaptureProjectFence(first);
	let activeProject = first;
	let activeHistory = history(first);
	let playheadFrame = 24_000;
	const preparingEntered = deferred<void>();
	const releasePreparing = deferred<void>();
	const countdownEntered = deferred<void>();
	const adminInterlock = createFramescaperCaptureAdminInterlock();
	const restoreAudioContext = installPreviewAudioContext();
	const binding = createFramescaperCaptureAppBinding({
		adminInterlock,
		productId: 'framescaper', routeSchemaVersion: 18, isDesktop: true, embedded: false,
		store: desktopStore(first, second),
		sessionController: sessionController(() => activeHistory),
		projectRuntime: {
			createHistory: history,
			executeCommand() { throw new Error('publication is not reached'); },
		},
		getActiveProject: () => activeProject,
		getActiveHistory: () => activeHistory,
		getActivePlayheadFrame: () => playheadFrame,
		setActiveProject(value: FramescaperCaptureAppProject) { activeProject = value; },
		setActiveHistory(value: FramescaperCaptureAppHistory) { activeHistory = value; },
		synchronizeProject() {}, assertProjectWritable() {},
		async acquireProjectWriteAuthority() {
			return { assertCurrent() {}, async release() {} };
		},
		prepareCaptureStart() {},
		desktopBridge: desktopBridge(),
		webVcrBridge: webVcrBridge(preparingEntered, releasePreparing),
		webVcrEnabled: true,
		mediaDevices: {
			async getUserMedia() { return stream([]); },
			async getDisplayMedia() { return stream([videoTrack(), audioTrack()]); },
			async enumerateDevices() { return []; },
		},
		createStream: stream,
		MediaRecorder: FakeMediaRecorder,
		MediaStreamTrackProcessor: class {},
		MediaStreamTrackGenerator: class {},
		VideoFrame: class {},
		getAudioContext: monitorAudioContext,
		videoProbe: async () => ({
			backend: 'test', nominalRate: { num: 30, den: 1 },
			timing: { timescale: 30, presentationTicks: [0n], finalFrameDurationTicks: 1n },
			width: 1_920, height: 1_080,
			characteristics: videoCharacteristics(),
		}),
		waitCountdown: (_durationMs: number, signal: AbortSignal) => new Promise<void>((resolve) => {
			countdownEntered.resolve();
			if (signal.aborted) resolve();
			else signal.addEventListener('abort', () => { resolve(); }, { once: true });
		}),
		createId: (prefix: string) => `${prefix}-test`,
	} as never);
	assert.ok(binding);

	try {
		await binding.initialize();
		await binding.webVcrActions.activate();
		const recording = binding.webVcrActions.record();
		await preparingEntered.promise;
		assert.deepEqual(binding.originSnapshot('project-a').origin, {
			...firstFence,
			sequenceId: 'sequence-a', playheadMicroseconds: 500_000,
		});
		assert.throws(() => binding.assertOriginEditAllowed('project-a'), /protects project-a from edit/iu);
		assert.throws(
			() => adminInterlock.beginAdminOperation({ kind: 'delete', projectId: 'project-a' }),
			/active capture authority/iu,
		);

		activeProject = second;
		activeHistory = history(second);
		playheadFrame = 96_000;
		releasePreparing.resolve();
		await countdownEntered.promise;
		assert.equal(binding.snapshot.phase, 'countdown');
		assert.deepEqual(binding.originSnapshot('project-b').origin, {
			...firstFence,
			sequenceId: 'sequence-a', playheadMicroseconds: 500_000,
		});
		assert.equal(binding.originSnapshot('project-b').activeProjectIsOrigin, false);
		assert.throws(() => binding.assertOriginCloseAllowed('project-a'), /protects project-a from close/iu);

		const stopping = binding.webVcrActions.stopAndImport();
		await Promise.all([recording, stopping]);
		assert.equal(binding.originSnapshot('project-b').active, false);
	} finally {
		releasePreparing.resolve();
		await binding.dispose();
		restoreAudioContext();
	}
});

function project(id: string, revision: number): FramescaperCaptureAppProject {
	return Object.freeze({
		id, schemaVersion: 18, revision, sampleRate: 48_000,
		primarySequenceId: 'sequence-a',
		sequences: Object.freeze([Object.freeze({
			id: 'sequence-a', rate: Object.freeze({ num: 30, den: 1 }), trackIds: Object.freeze([]),
		})]),
		sources: Object.freeze([]), clips: Object.freeze([]), tracks: Object.freeze([]),
	});
}

function history(value: FramescaperCaptureAppProject): FramescaperCaptureAppHistory {
	return Object.freeze({ present: value, undoStack: Object.freeze([]), redoStack: Object.freeze([]), limit: 100 });
}

function sessionController(getHistory: () => FramescaperCaptureAppHistory) {
	const tabs = [{ projectId: getHistory().present.id }];
	return {
		getSnapshot: () => ({ tabs }),
		openProject(value: FramescaperCaptureAppProject) { tabs.push({ projectId: value.id }); },
		captureProjectHistory: () => ({ history: getHistory(), token: 1 }),
		beginProjectActivation: () => ({ token: 1, release: () => true }),
		installCommittedProjectHistory() {}, getProjectHistory: getHistory, markProjectSaved() {},
	};
}

function desktopStore(...projects: readonly FramescaperCaptureAppProject[]) {
	const byId = new Map(projects.map((value) => [value.id, value]));
	return {
		async loadProject(id: string) { return byId.get(id) ?? null; },
		async saveProject(value: FramescaperCaptureAppProject) { byId.set(value.id, value); return value; },
		async listProjects() { return projects; },
		framescaperCaptureManifestRepository: {
			async create(value: unknown) { return value; }, async load() { return null; },
			async listProject() { return []; }, async replace(_old: unknown, value: unknown) { return value; },
			async remove() {}, async createCreation(value: unknown) { return value; },
			async loadCreation() { return null; }, async listProjectCreations() { return []; },
			async listCreations() { return []; }, async publishCreation(_old: unknown, value: unknown) { return value; },
			async replaceCreation(_old: unknown, value: unknown) { return value; }, async removeCreation() {},
		},
		encodedCaptureSpoolRepository: repositories(), rawPcmSpoolRepository: repositories(),
		async getSourceMetadata() { return null; }, async beginSourceWrite() { throw new Error('not reached'); },
		async discardSourceIfCurrent() { return true; }, async getMediaAssetMetadata() { return null; },
		async beginMediaAssetWrite() { throw new Error('not reached'); }, async loadMediaAsset() { return null; },
	};
}

function repositories() {
	return {
		async create() { throw new Error('not reached'); }, async createFramescaper() { throw new Error('not reached'); },
		async load() { return null; }, async append() { throw new Error('not reached'); },
		async seal() { throw new Error('not reached'); }, async delete() {}, async remove() { return true; },
		async releaseAdopted() {}, async releaseReservation() { return true; },
		async reconcileAppend(value: unknown) { return value; },
		async restoreAcknowledgedPrefix() { throw new Error('not reached'); }, async *read() {}, async *chunks() {},
	};
}

function desktopBridge() {
	return {
		async status() { return { version: 1 as const, available: true, unavailableReason: null,
			selectionMode: 'source-list' as const, systemAudio: 'none' as const,
			sourceLimit: 64, sourceListTtlMs: 300_000, grantTtlMs: 15_000 }; },
		async listSources() { throw new Error('not reached'); }, async grant() { throw new Error('not reached'); },
		async teardown() { return true; },
	};
}

function webVcrBridge(preparingEntered: ReturnType<typeof deferred<void>>, release: ReturnType<typeof deferred<void>>) {
	const snapshot = hostSnapshot();
	return {
		async handshake() { return { version: 1 as const, capability: snapshot.capability, captureGrantTtlMs: 10_000 }; },
		async open() { return snapshot; },
		async dispatch() { return { version: 1 as const, kind: 'snapshot' as const, snapshot }; },
		async prepareCapture() { return { version: 1 as const, grantId: ID, sessionId: ID, generation: 1, expiresAtMs: 10_000 }; },
		async setCaptureState(value: Readonly<{ state: string }>) {
			if (value.state === 'preparing') { preparingEntered.resolve(); await release.promise; }
			return true;
		},
		subscribe() { return () => {}; }, async dispose() { return true; },
	};
}

function hostSnapshot() {
	return {
		version: 1 as const, sessionId: ID, generation: 1, phase: 'ready' as const,
		capability: { status: 'available' as const, resolutions: ['720p', '1080p'] as const },
		resolution: '1080p' as const, aspect: 'free' as const,
		crop: { x: 0, y: 0, width: 1, height: 1 }, autoCrop: false,
		monitorMuted: false, autoStop: false, visible: true,
		navigation: { generation: 1, url: 'about:blank', canGoBack: false, canGoForward: false, isLoading: false },
		target: null, targetEndedRecordingToken: null,
		captureSurface: { width: 1_920, height: 1_080 }, outputSize: { width: 1_920, height: 1_080 },
		metrics: null, failure: null,
	};
}

function videoTrack() { return track('video'); }
function audioTrack() { return { ...track('audio'), clone: () => track('audio') }; }
function track(kind: string) {
	return { kind, stop() {}, getSettings: () => kind === 'video' ? { width: 1_920, height: 1_080 } : {}, getCapabilities: () => ({}) };
}
function stream(tracks: readonly ReturnType<typeof track>[]) {
	return { getTracks: () => tracks, getAudioTracks: () => tracks.filter(({ kind }) => kind === 'audio'),
		getVideoTracks: () => tracks.filter(({ kind }) => kind === 'video') };
}
function monitorAudioContext() {
	const node = () => ({ connect() {}, disconnect() {} });
	return { sampleRate: 48_000, state: 'running', destination: {}, createMediaStreamSource: node,
		createGain: () => ({ ...node(), gain: { value: 1 } }) };
}

function installPreviewAudioContext(): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
	class PreviewAudioContext {
		readonly state = 'running';
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
		createAnalyser() { return { fftSize: 0, frequencyBinCount: 1, getFloatTimeDomainData() {}, disconnect() {} }; }
		async close() {}
	}
	Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: PreviewAudioContext });
	return () => descriptor
		? Object.defineProperty(globalThis, 'AudioContext', descriptor)
		: void Reflect.deleteProperty(globalThis, 'AudioContext');
}

class FakeMediaRecorder {
	static isTypeSupported(value: string) { return value.startsWith('video/webm'); }
	readonly mimeType = 'video/webm'; readonly state = 'inactive';
	ondataavailable = null; onerror = null; onstop = null;
	start() {} pause() {} resume() {} requestData() {} stop() {}
}

function videoCharacteristics() {
	return { backend: 'test', codedWidth: 1_920, codedHeight: 1_080, rotationDegrees: 0,
		pixelAspectRatio: { num: 1, den: 1 }, fieldOrder: 'progressive', hasAlpha: false,
		videoCodec: 'vp8', colour: { primaries: null, transfer: null, matrix: null, range: null },
		audioStreams: null, extractedAudioStreamIndex: null, startTimecode: null };
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}
