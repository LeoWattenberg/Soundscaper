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

test('product, embedding, encoder, durability, and probe gaps fail closed', async () => {
	for (const [name, changes, reason] of [
		['Soundscaper', { productId: 'soundscaper' }, 'unsupported-platform'],
		['embedded web', { embedded: true }, 'embedded-route'],
		['video encoder', { MediaRecorder: null }, 'video-encoder-unavailable'],
		['audio packet source', {
			MediaStreamTrackProcessor: null, AudioWorkletNode: null,
		}, 'audio-packet-source-unavailable'],
		['durability', { store: null }, 'durable-storage-unavailable'],
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
		'status', 'list:1', `grant:1:${'a'.repeat(32)}:display`,
	]);
	await harness.value.actions.release();
	assert.deepEqual(harness.desktopEvents, [
		'status', 'list:1', `grant:1:${'a'.repeat(32)}:display`, 'teardown:1',
	]);
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

function desktopBridge(events: string[]) {
	return {
		async status() {
			events.push('status');
			return {
				version: 1 as const, available: true, unavailableReason: null,
				selectionMode: 'source-list' as const, systemAudio: 'windows-loopback' as const,
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
