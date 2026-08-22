/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureAppComposition,
	createFramescaperCapturePublicationIdFactory,
	createFramescaperCaptureVideoProbe,
} from '../src/common/editor/controller/framescaper-capture-app-composition.ts';

const SHA = 'ab'.repeat(32);

test('the complete Framescaper standalone runtime initializes without opening media', async () => {
	const harness = compositionHarness();
	await harness.value.initialize();

	assert.equal(harness.value.snapshot.availability.status, 'available');
	assert.equal(harness.mediaOpens, 0);
	assert.deepEqual(harness.value.actions, harness.value.service.actions);
	assert.equal(harness.manifestLists, 1, 'startup checks only the open project recovery inventory');
});

test('selected V20 initializes the same capture runtime on web and desktop', async () => {
	for (const changes of [{ routeSchemaVersion: 20 }, { routeSchemaVersion: 20, desktop: true }]) {
		const harness = compositionHarness(changes);
		await harness.value.initialize();
		assert.equal(harness.value.snapshot.availability.status, 'available');
		assert.equal(harness.mediaOpens, 0);
		await harness.value.dispose();
	}
});

test('product, embedding, encoder, durability, and probe gaps fail closed', async () => {
	for (const [name, changes, reason] of [
		['Soundscaper', { productId: 'soundscaper' }, 'unsupported-platform'],
		['embedded web', { embedded: true }, 'embedded-route'],
		['video encoder', { MediaRecorder: null }, 'video-encoder-unavailable'],
		['audio packet source', {
			MediaStreamTrackProcessor: null, AudioWorkletNode: null,
		}, 'audio-packet-source-unavailable'],
		['durability', { store: null }, 'durable-storage-unavailable'],
		['incomplete append-intent repositories', {
			store: incompleteCaptureStore(),
		}, 'durable-storage-unavailable'],
		['cross-context spool locking', {
			captureSpoolLockAvailable: () => false,
		}, 'durable-storage-unavailable'],
		['video probe', { videoProbe: null }, 'media-probe-unavailable'],
		['wrong web route', { routeSchemaVersion: 18 }, 'unsupported-platform'],
	] as const) {
		const harness = compositionHarness(changes);
		await harness.value.initialize();
		assert.deepEqual(harness.value.snapshot.availability, {
			status: 'unavailable', reason, detail: null,
		}, name);
		await assert.rejects(
			harness.value.actions.requestPreview(['camera']),
			/not available/iu,
		);
		assert.equal(harness.mediaOpens, 0, name);
	}
});

test('desktop source selection preserves explicit opaque generation and tears it down with the lease', async () => {
	const harness = compositionHarness({ embedded: true, desktop: true });
	await harness.value.initialize();
	assert.equal(harness.value.snapshot.availability.status, 'available');
	assert.equal(harness.value.snapshot.displaySelectionMode, 'source-list');

	await harness.value.actions.listDisplaySources();
	assert.deepEqual(harness.value.snapshot.displaySources, [
		{ token: 'a'.repeat(32), name: 'Screen 1', kind: 'screen' },
	]);
	harness.value.actions.selectDisplaySource('a'.repeat(32));
	await harness.value.actions.requestPreview(['display']);
	assert.equal(harness.mediaOpens, 1);
	assert.deepEqual(harness.desktopEvents, [
		'status', 'list:1', `grant:1:${'a'.repeat(32)}:display+system-audio`,
	]);
	await harness.value.actions.release();
	assert.deepEqual(harness.desktopEvents, [
		'status', 'list:1', `grant:1:${'a'.repeat(32)}:display+system-audio`, 'teardown:1',
	]);
});

test('desktop display grants stay video-only when loopback is unavailable', async () => {
	const events: string[] = [];
	const harness = compositionHarness({
		embedded: true,
		desktop: true,
		desktopBridge: desktopBridge(events, 'none'),
	});
	await harness.value.initialize();
	await harness.value.actions.listDisplaySources();
	harness.value.actions.selectDisplaySource('a'.repeat(32));
	await harness.value.actions.requestPreview(['display']);

	assert.deepEqual(events, [
		'status', 'list:1', `grant:1:${'a'.repeat(32)}:display`,
	]);
	await harness.value.dispose();
});

test('Web VCR page audio remains available without desktop OS loopback', async () => {
	const desktopEvents: string[] = [];
	const webEvents: string[] = [];
	const displayVideoRequests: unknown[] = [];
	const video = track('video');
	const audio = cloneableAudioTrack();
	const restoreAudioContext = installPreviewAudioContext();
	const harness = compositionHarness({
		embedded: true,
		desktop: true,
		desktopBridge: desktopBridge(desktopEvents, 'none'),
		webVcrBridge: webVcrBridge(webEvents),
		webVcrEnabled: true,
		startAdmission: testStartAdmission(),
		MediaStreamTrackGenerator: class {},
		VideoFrame: class {},
		mediaDevices: {
			async getUserMedia() { return stream([]); },
			async getDisplayMedia(constraints: Readonly<Record<string, unknown>>) {
				displayVideoRequests.push(constraints.video);
				return stream([video, audio]);
			},
			async enumerateDevices() { return []; },
		},
		getAudioContext: () => monitorAudioContext(),
	});
	try {
		await harness.value.initialize();
		assert.equal(harness.value.webVcrSnapshot.capability.status, 'available');
		assert.ok(harness.value.snapshot.availability.status === 'available'
			&& !harness.value.snapshot.availability.sourceRoles.includes('system-audio'));

		await harness.value.webVcrActions.activate();
		assert.ok(harness.value.snapshot.availability.status === 'available'
			&& harness.value.snapshot.availability.sourceRoles.includes('system-audio'));
		assert.deepEqual(harness.value.snapshot.sources.map(({ role }) => role), [
			'display', 'system-audio',
		]);
		assert.deepEqual(desktopEvents, ['status']);
		assert.deepEqual(webEvents.slice(0, 3), [
			'handshake', 'open:1080p', `prepare:${'c'.repeat(32)}:1`,
		]);
		await harness.value.webVcrActions.setResolution('720p');
		assert.deepEqual(displayVideoRequests, [
			{ width: { ideal: 1_920, max: 1_920 }, height: { ideal: 1_080, max: 1_080 } },
			{ width: { ideal: 1_280, max: 1_280 }, height: { ideal: 720, max: 720 } },
		]);
		await harness.value.webVcrActions.close();
		assert.ok(harness.value.snapshot.availability.status === 'available'
			&& !harness.value.snapshot.availability.sourceRoles.includes('system-audio'));
	} finally {
		await harness.value.dispose();
		restoreAudioContext();
	}
});

test('an unavailable Web VCR handshake never augments ordinary source roles', async () => {
	const events: string[] = [];
	const available = webVcrBridge(events);
	const harness = compositionHarness({
		embedded: true,
		desktop: true,
		desktopBridge: desktopBridge([], 'none'),
		webVcrEnabled: true,
		startAdmission: testStartAdmission(),
		webVcrBridge: {
			...available,
			async handshake() {
				events.push('handshake');
				return { version: 1 as const, capability: {
					status: 'unavailable' as const, reason: 'unsupported-platform' as const, detail: null,
				}, captureGrantTtlMs: 15_000 };
			},
		},
		MediaStreamTrackGenerator: class {},
		VideoFrame: class {},
	});
	await harness.value.initialize();
	assert.equal(harness.value.webVcrSnapshot.capability.status, 'unavailable');
	assert.ok(harness.value.snapshot.availability.status === 'available'
		&& !harness.value.snapshot.availability.sourceRoles.includes('system-audio'));
	await assert.rejects(() => harness.value.webVcrActions.activate(), /unavailable/iu);
	await harness.value.dispose();
});

test('an enabled Web VCR composition rejects a missing app start-admission authority', () => {
	assert.throws(() => compositionHarness({ webVcrEnabled: true }), /requires exact app capture start admission/iu);
});

test('a dormant Web VCR preload does not expose desktop loopback to device capture', async () => {
	const desktopEvents: string[] = [];
	const webEvents: string[] = [];
	const harness = compositionHarness({
		embedded: true,
		desktop: true,
		desktopBridge: desktopBridge(desktopEvents, 'none'),
		webVcrBridge: webVcrBridge(webEvents),
		webVcrEnabled: false,
		MediaStreamTrackGenerator: class {},
		VideoFrame: class {},
	});
	await harness.value.initialize();
	assert.deepEqual(harness.value.webVcrSnapshot.capability, {
		status: 'unavailable', reason: 'roadmap-gate',
	});
	assert.ok(harness.value.snapshot.availability.status === 'available'
		&& !harness.value.snapshot.availability.sourceRoles.includes('system-audio'));
	assert.deepEqual(desktopEvents, ['status']);
	assert.deepEqual(webEvents, []);
	await harness.value.dispose();
});

test('initialization corruption fails capture closed without rejecting editor readiness', async () => {
	const warnings: unknown[] = [];
	const harness = compositionHarness({
		store: captureStore(() => { throw new Error('manifest index corrupt'); }),
		onWarning: (error: unknown) => { warnings.push(error); },
	});

	await harness.value.initialize();
	assert.deepEqual(harness.value.snapshot.availability, {
		status: 'unavailable', reason: 'runtime-error', detail: 'manifest index corrupt',
	});
	assert.equal(warnings.length, 1);
	await assert.rejects(harness.value.actions.requestPreview(['camera']), /disposed/iu);
});

test('composition disposal releases a desktop grant exactly once', async () => {
	const harness = compositionHarness({ embedded: true, desktop: true });
	await harness.value.initialize();
	await harness.value.actions.listDisplaySources();
	harness.value.actions.selectDisplaySource('a'.repeat(32));
	await harness.value.actions.requestPreview(['display']);

	await harness.value.dispose();
	assert.equal(harness.desktopEvents.filter((event) => event === 'teardown:1').length, 1);
	await assert.rejects(harness.value.actions.requestPreview(['display']), /disposed/iu);
});

test('publication IDs are deterministic per session, prefix, and call order', () => {
	const first = createFramescaperCapturePublicationIdFactory('session-a');
	const second = createFramescaperCapturePublicationIdFactory('session-a');
	const different = createFramescaperCapturePublicationIdFactory('session-b');
	const expected = [first('capture-track'), first('capture-clip'), first('capture-track')];

	assert.deepEqual(expected, [
		second('capture-track'), second('capture-clip'), second('capture-track'),
	]);
	assert.notEqual(expected[0], different('capture-track'));
	assert.equal(new Set(expected).size, expected.length);
	assert.ok(expected.every((value) => value.length <= 160));
});

test('the canonical probe adapter requires exact timing and reported coded geometry', async () => {
	const adapter = createFramescaperCaptureVideoProbe({
		helperTimingProbe: {
			id: 'qualified-probe',
			async probe() {
				return {
					timescale: 30, presentationTicks: [0n, 1n], finalFrameDurationTicks: 1n,
					nominalRate: { num: 30, den: 1 },
					characteristics: characteristics(1_920, 1_080),
				};
			},
		},
	});
	assert.ok(adapter);
	const result = await adapter(new Blob([new Uint8Array([1])]), {
		manifest: {} as never, stream: {} as never, signal: null,
	});
	assert.equal(result.backend, 'qualified-probe');
	assert.equal(result.width, 1_920);
	assert.equal(result.height, 1_080);

	const incomplete = createFramescaperCaptureVideoProbe({
		helperTimingProbe: {
			id: 'incomplete-probe',
			async probe() {
				return {
					timescale: 30, presentationTicks: [0n], finalFrameDurationTicks: 1n,
					nominalRate: { num: 30, den: 1 },
				};
			},
		},
	});
	assert.ok(incomplete);
	await assert.rejects(async () => incomplete(new Blob([new Uint8Array([1])]), {
		manifest: {} as never, stream: {} as never, signal: null,
	}), /coded geometry/iu);
});

function compositionHarness(changes: Readonly<Record<string, unknown>> = {}) {
	let mediaOpens = 0;
	let manifestLists = 0;
	const desktopEvents: string[] = [];
	const videoTrack = track('video');
	const emptyStream = stream([]);
	const videoStream = stream([videoTrack]);
	const store = captureStore(() => { manifestLists += 1; });
	const options = {
		productId: 'framescaper', routeSchemaVersion: changes.desktop ? 18 : 19, embedded: false,
		store,
		mediaDevices: {
			async getUserMedia() { mediaOpens += 1; return emptyStream; },
			async getDisplayMedia() { mediaOpens += 1; return videoStream; },
			async enumerateDevices() { return []; },
		},
		createStream: (tracks: readonly ReturnType<typeof track>[]) => stream(tracks),
		MediaRecorder: FakeMediaRecorder,
		MediaStreamTrackProcessor: class {},
		getAudioContext: () => ({ sampleRate: 48_000 }),
		videoProbe: async () => ({
			backend: 'test', nominalRate: { num: 30, den: 1 },
			timing: { timescale: 30, presentationTicks: [0n], finalFrameDurationTicks: 1n },
			width: 1_920, height: 1_080, characteristics: characteristics(1_920, 1_080),
		}),
		projectPublication: {
			async assertProjectFence() {},
			async commitAtomic() { return { status: 'committed' as const }; },
		},
		captureOrigin: () => ({
			projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: SHA },
			origin: { sequenceId: 'sequence-a', playheadMicroseconds: 0, destination: 'both' as const },
		}),
		capturePublicationContext: () => ({
			recordStartFrame: 0, projectSampleRate: 48_000,
			sequence: { id: 'sequence-a', rate: { num: 30, den: 1 } }, trackInsertionIndex: 0,
		}),
		createId: (prefix: string) => `${prefix}-id`,
		...(changes.desktop ? { desktopBridge: desktopBridge(desktopEvents) } : {}),
		...changes,
	};
	delete (options as Record<string, unknown>).desktop;
	const value = createFramescaperCaptureAppComposition(options as never);
	return {
		value, desktopEvents,
		get mediaOpens() { return mediaOpens; },
		get manifestLists() { return manifestLists; },
	};
}

function captureStore(onManifestList: () => void) {
	return {
		framescaperCaptureManifestRepository: {
			async create(value: unknown) { return value; },
			async load() { return null; },
			async listProject() { onManifestList(); return []; },
			async replace(_expected: unknown, next: unknown) { return next; },
			async remove() {},
			async createCreation(value: unknown) { return value; },
			async listProjectCreations() { return []; }, async listCreations() { return []; },
			async loadCreation() { return null; },
			async publishCreation(_expected: unknown, value: unknown) { return value; },
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
			async remove() { return true; },
			async releaseReservation() { return true; }, async reconcileAppend(current: unknown) { return current; },
			async restoreAcknowledgedPrefix() { throw new Error('not reached'); }, async *chunks() {},
		},
		async getSourceMetadata() { return null; }, async beginSourceWrite() { throw new Error('not reached'); },
		async discardSourceIfCurrent() { return true; }, async getMediaAssetMetadata() { return null; },
		async beginMediaAssetWrite() { throw new Error('not reached'); }, async loadMediaAsset() { return null; },
	};
}

function incompleteCaptureStore() {
	const store = captureStore(() => {});
	delete (store.rawPcmSpoolRepository as unknown as Record<string, unknown>).reconcileAppend;
	return store;
}

function desktopBridge(events: string[], systemAudio: 'windows-loopback' | 'none' = 'windows-loopback') {
	return {
		async status() {
			events.push('status');
			return {
				version: 1 as const, available: true, unavailableReason: null,
				selectionMode: 'source-list' as const, systemAudio,
				sourceLimit: 64, sourceListTtlMs: 300_000, grantTtlMs: 15_000,
			};
		},
		async listSources(generation: number) {
			events.push(`list:${String(generation)}`);
			return {
				generation, selectionMode: 'source-list' as const, expiresAtMs: 300_000,
				sources: [{ token: 'a'.repeat(32), name: 'Screen 1', kind: 'screen' as const }],
			};
		},
		async grant(request: Readonly<{ generation: number; sourceToken: string | null; roles: readonly string[] }>) {
			events.push(`grant:${String(request.generation)}:${request.sourceToken ?? 'picker'}:${request.roles.join('+')}`);
			return { grantId: 'b'.repeat(32), generation: request.generation, expiresAtMs: 15_000, roles: request.roles };
		},
		async teardown(generation: number) { events.push(`teardown:${String(generation)}`); return true; },
	};
}

function webVcrBridge(events: string[]) {
	const snapshot = {
		version: 1 as const, sessionId: 'c'.repeat(32), generation: 1, phase: 'ready' as const,
		capability: { status: 'available' as const, resolutions: ['720p', '1080p'] as const },
		resolution: '1080p' as const, aspect: 'free' as const,
		crop: { x: 0, y: 0, width: 1, height: 1 }, autoCrop: false,
		monitorMuted: false, autoStop: false, visible: true,
		navigation: {
			generation: 1, url: 'about:blank', canGoBack: false, canGoForward: false, isLoading: false,
		},
		target: null, targetEndedRecordingToken: null,
		captureSurface: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_920, height: 1_080 }, metrics: null, failure: null,
	};
	return {
		async handshake() {
			events.push('handshake');
			return { version: 1 as const, capability: snapshot.capability, captureGrantTtlMs: 15_000 };
		},
		async open({ resolution }: Readonly<{ resolution: string }>) {
			events.push(`open:${resolution}`);
			return snapshot;
		},
		async dispatch(command: Readonly<{ readonly kind?: string; readonly resolution?: string }>) {
			const next = command.kind === 'set-resolution' && command.resolution === '720p'
				? { ...snapshot, resolution: '720p' as const,
					captureSurface: { width: 1_280, height: 720 }, outputSize: { width: 1_280, height: 720 } }
				: snapshot;
			return { version: 1 as const, kind: 'snapshot' as const, snapshot: next };
		},
		async prepareCapture(reference: Readonly<{ sessionId: string; generation: number }>) {
			events.push(`prepare:${reference.sessionId}:${String(reference.generation)}`);
		},
		async setCaptureState() { return true; },
		subscribe() { return () => {}; },
		async dispose() { events.push('dispose'); return true; },
	};
}

function testStartAdmission() {
	return {
		begin() {
			return {
				captured: {
					projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: SHA },
					origin: { sequenceId: 'sequence-a', playheadMicroseconds: 0, destination: 'both' as const },
				},
				async prepare() {},
				release: () => true,
			};
		},
	};
}

function cloneableAudioTrack() {
	return { ...track('audio'), clone: () => track('audio') };
}

function monitorAudioContext() {
	const node = () => ({ connect() {}, disconnect() {} });
	return {
		sampleRate: 48_000, state: 'running', destination: {},
		createMediaStreamSource: node,
		createGain: () => ({ ...node(), gain: { value: 1 } }),
	};
}

function installPreviewAudioContext(): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
	class PreviewAudioContext {
		readonly state = 'running';
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
		createAnalyser() {
			return {
				fftSize: 0, frequencyBinCount: 1,
				getFloatTimeDomainData() {}, disconnect() {},
			};
		}
		async close() {}
	}
	Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: PreviewAudioContext });
	return () => {
		if (descriptor) Object.defineProperty(globalThis, 'AudioContext', descriptor);
		else Reflect.deleteProperty(globalThis, 'AudioContext');
	};
}

function characteristics(width: number, height: number) {
	return {
		backend: 'test', codedWidth: width, codedHeight: height, rotationDegrees: 0,
		pixelAspectRatio: { num: 1, den: 1 }, fieldOrder: 'progressive', hasAlpha: false,
		videoCodec: 'vp8', colour: { primaries: null, transfer: null, matrix: null, range: null },
		audioStreams: null, extractedAudioStreamIndex: null, startTimecode: null,
	};
}

function track(kind: string) {
	return { kind, stop() {}, getSettings: () => ({ width: 1_920, height: 1_080 }), getCapabilities: () => ({}) };
}

function stream(tracks: readonly ReturnType<typeof track>[]) {
	return {
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter(({ kind }) => kind === 'audio'),
		getVideoTracks: () => tracks.filter(({ kind }) => kind === 'video'),
	};
}

class FakeMediaRecorder {
	static isTypeSupported(value: string) { return value === 'video/webm'; }
	readonly mimeType = 'video/webm';
	readonly state = 'inactive';
	ondataavailable = null;
	onerror = null;
	onstop = null;
	start() {}
	pause() {}
	resume() {}
	requestData() {}
	stop() {}
}
