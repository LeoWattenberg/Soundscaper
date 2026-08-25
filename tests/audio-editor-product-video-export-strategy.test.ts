/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { createEditorVideoExportAction } from '../src/common/editor/controller/video-export-service.ts';
import type {
	ProductVideoExportPlan,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
} from '../src/common/editor/controller/product-video-export-strategy.ts';
import {
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import { createVideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import { registeredVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';
import { createFixture as createExportServiceFixture } from './helpers/export-service-fixture.ts';
import { withWebCodecsSupport } from './helpers/webcodecs-test-environment.ts';

const SAMPLE_RATE = 48_000;
const ACTIVE_SOURCE_ID = 'active-video';
const OFF_RANGE_SOURCE_ID = 'off-range-video';
const ACTIVE_DIGEST = 'ab'.repeat(32);
const OFF_RANGE_DIGEST = 'cd'.repeat(32);
const TIMING_PUBLICATION = createVideoTimingAssetPublication(ACTIVE_DIGEST, {
	timescale: 1_000,
	presentationTicks: [0n, 100n, 300n],
	finalFrameDurationTicks: 200n,
});
const OFF_RANGE_TIMING_PUBLICATION = createVideoTimingAssetPublication(OFF_RANGE_DIGEST, {
	timescale: 1_000,
	presentationTicks: [0n, 200n, 350n],
	finalFrameDurationTicks: 150n,
});

test('keyed strategy plans before exact timing and excludes off-range timing media', async () => {
	const fixture = createFixture({ mode: 'blob' });
	const result = await fixture.exportVideo({
		format: 'video-mp4',
		range: { startFrame: 0, endFrame: SAMPLE_RATE },
	});

	assert.deepEqual(result, {
		url: 'blob:keyed-video',
		fileName: 'Keyed-video.mp4',
		mimeType: 'video/mp4',
		size: 4,
		method: 'object-url',
	});
	assertOrder(fixture.events, [
		'product-plan', 'active-timing-load', 'prepare', 'active-video-load',
		'render-audio', 'product-encode', 'download',
	]);
	assert.equal(fixture.events.includes('off-range-timing-load'), false);
	assert.equal(fixture.events.includes('legacy-plan'), false);
	assert.equal(fixture.events.includes('legacy-encode'), false);
	assert.equal(registeredVideoTimingIndex(fixture.activeSource), undefined);
	assert.deepEqual(fixture.errors, []);
});

test('keyed strategy retains exact timing through direct encoding and releases it after success', async () => {
	const fixture = createFixture({ mode: 'direct' });
	const result = await fixture.exportVideo({ format: 'video-mp4' });

	assert.deepEqual(result, {
		url: null,
		fileName: 'Keyed-video.mp4',
		mimeType: 'video/mp4',
		size: 4,
		method: 'file-system-access',
	});
	assertOrder(fixture.events, [
		'product-plan', 'active-timing-load', 'prepare', 'active-video-load',
		'product-encode-sink', 'open:4:exact', 'write:4', 'seal', 'commit',
	]);
	assert.equal(registeredVideoTimingIndex(fixture.activeSource), undefined);
	assert.deepEqual(fixture.errors, []);
});

test('keyed delivery falls back from owned storage to the exact pathless linked original', async () => {
	const fixture = createFixture({ mode: 'blob', linkedOriginal: true });
	const result = await fixture.exportVideo({ format: 'video-mp4' });

	assert.equal(result?.url, 'blob:keyed-video');
	assertOrder(fixture.events, [
		'product-plan', 'active-timing-load', 'prepare', 'active-video-load',
		'active-video-linked-load', 'product-encode', 'download',
	]);
	assert.deepEqual(fixture.errors, []);
});

test('keyed strategy releases exact timing and publishes nothing after encoder failure', async () => {
	const failure = new Error('keyed encoder failed');
	const fixture = createFixture({ mode: 'blob', encodeFailure: failure });

	assert.equal(await fixture.exportVideo({ format: 'video-mp4' }), null);
	assert.strictEqual(fixture.errors[0], failure);
	assert.equal(fixture.events.includes('download'), false);
	assert.equal(registeredVideoTimingIndex(fixture.activeSource), undefined);
});

test('a static product range preserves the unchanged legacy V6 encoder path', async () => {
	const fixture = createFixture({ mode: 'blob', staticRange: true });
	const result = await fixture.exportVideo({ format: 'video-mp4' });

	assert.equal(result?.url, 'blob:keyed-video');
	assertOrder(fixture.events, [
		'product-plan', 'active-timing-load', 'off-range-timing-load',
		'legacy-plan', 'prepare', 'legacy-encode', 'download',
	]);
	assert.equal(fixture.events.includes('product-encode'), false);
	assert.equal(fixture.events.includes('product-encode-sink'), false);
	assert.deepEqual(fixture.errors, []);
});

test('common strategy rejects missing, duplicate, and accessor active source IDs before timing loads', async () => {
	for (const malformed of ['missing', 'duplicate', 'accessor', 'entries', 'prototype'] as const) {
		const fixture = createFixture({ mode: 'blob', malformedPlan: malformed });
		assert.equal(await fixture.exportVideo({ format: 'video-mp4' }), null);
		assert.match((fixture.errors[0] as Error).message, /activeSourceIds|active source/iu);
		assert.equal(fixture.events.includes('active-timing-load'), false);
		assert.equal(fixture.events.includes('off-range-timing-load'), false);
	}
});

test('common strategy preserves video format aliases and refuses unsupported formats', async () => {
	for (const staticRange of [false, true]) {
		const fixture = createFixture({ mode: 'blob', staticRange, cancelPreparation: true });
		assert.equal((await fixture.exportVideo({ format: 'video-vp9' }))?.cancelled, true);
		assert.ok(fixture.events.includes('product-format:webm'));
		if (staticRange) assert.ok(fixture.events.includes('legacy-format:webm'));
	}
	const invalid = createFixture({ mode: 'blob' });
	assert.equal(await invalid.exportVideo({ format: 'video-surprise' }), null);
	assert.match((invalid.errors[0] as Error).message, /unsupported video export format/iu);
	assert.equal(invalid.events.includes('product-plan'), false);
});

test('desktop keyed delivery stays on external FFmpeg when WebCodecs is available', async () => {
	await withWebCodecsSupport(async () => {
		const browser = createFixture({ mode: 'blob' }); await browser.exportVideo({ format: 'video-mp4' });
		assert.ok(browser.events.includes('product-encoder:webcodecs'));
		const desktop = createFixture({ mode: 'direct', desktop: true });
		await desktop.exportVideo({ format: 'video-mp4' });
		assert.ok(desktop.events.includes('product-encoder:ffmpeg'));
		assert.equal(desktop.events.includes('product-encoder:webcodecs'), false);
	});
});
test('product picture authority exports stills and generators without fake video timing or audio', async () => {
	for (const kind of ['still', 'generator'] as const) {
		const fixture = createPictureOnlyFixture(kind, false);
		const result = await fixture.exportVideo({ format: 'video-mp4' });
		assert.equal(result?.fileName, `Picture-${kind}.mp4`);
		assert.deepEqual(fixture.capture.timingSourceIds, []);
		assert.deepEqual(fixture.capture.videoBlobIds, []);
		assert.equal(fixture.capture.includeAudio, false);
		assert.equal(fixture.capture.audioMix, null);
	}

	const mixed = createPictureOnlyFixture('still', true);
	await mixed.exportVideo({ format: 'video-mp4' });
	assert.equal(mixed.capture.includeAudio, true);
	assert.ok(mixed.capture.audioMix instanceof Blob);
});

interface FixtureOptions {
	readonly mode: 'blob' | 'direct';
	readonly desktop?: boolean;
	readonly encodeFailure?: Error;
	readonly cancelPreparation?: boolean;
	readonly malformedPlan?: 'missing' | 'duplicate' | 'accessor' | 'entries' | 'prototype';
	readonly staticRange?: boolean;
	readonly linkedOriginal?: boolean;
}

function createPictureOnlyFixture(kind: 'still' | 'generator', withAudio: boolean) {
	const fixture = createExportServiceFixture();
	const pictureClip = Object.freeze({
		id: `${kind}-clip`, kind, sourceId: `${kind}-source`,
		timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
	});
	const audioClip = Object.freeze({
		id: 'audio-clip', kind: 'audio', sourceId: 'audio-source',
		timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
	});
	const project = Object.freeze({
		id: `picture-${kind}`, title: `Picture ${kind}`,
		sampleRate: SAMPLE_RATE, masterChannels: 2,
		tracks: Object.freeze([
			Object.freeze({
				id: 'picture-track', type: 'video', hidden: false,
				clipIds: Object.freeze([pictureClip.id]),
			}),
			...(withAudio ? [Object.freeze({
				id: 'audio-track', type: 'audio', clipIds: Object.freeze([audioClip.id]),
			})] : []),
		]),
		clips: Object.freeze([pictureClip, ...(withAudio ? [audioClip] : [])]),
		sources: Object.freeze([Object.freeze({ id: `${kind}-source`, kind })]),
	});
	const capture: {
		timingSourceIds?: readonly string[];
		videoBlobIds?: readonly string[];
		includeAudio?: boolean;
		audioMix?: Blob | null;
	} = {};
	const plan: ProductVideoExportPlan = Object.freeze({
		version: 13, format: 'mp4', extension: 'mp4', mimeType: 'video/mp4',
		range: Object.freeze({ startFrame: 0, endFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE }),
		canvas: Object.freeze({
			width: 640, height: 360, frameRate: Object.freeze({ num: 1, den: 1 }),
			fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#000000',
		}),
		inputs: Object.freeze(withAudio ? [Object.freeze({
			kind: 'staged-audio-mix', channelLayout: 'preserve',
		})] : []),
		activeSourceIds: Object.freeze([]),
	});
	const strategy: ProductVideoExportStrategy = Object.freeze({
		createExportProject: () => project,
		hasPicture: (candidate: Readonly<Record<string, unknown>>) => candidate === project,
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			capture.includeAudio = request.includeAudio;
			return plan;
		},
		captureTimingSourceIds(candidate: ProductVideoExportPlan) {
			assert.strictEqual(candidate, plan);
			capture.timingSourceIds = candidate.activeSourceIds;
			return [];
		},
		async encode(request: ProductVideoExportStrategyEncodeRequest) {
			capture.videoBlobIds = [...request.videoBlobs.keys()];
			capture.audioMix = request.audioMix;
			return Object.freeze({
				bytes: Uint8Array.of(1, 2, 3, 4), byteLength: 4,
				extension: '.mp4' as const, mimeType: 'video/mp4' as const,
			});
		},
		async encodeToSink() { throw new Error('picture test does not use a sink'); },
	});
	const runtime = {
		...fixture.runtime,
		getProject: () => project,
		findClip: (_value: unknown, id: string) => (
			project.clips.find((clip) => clip.id === id)
		),
		findSource: (_value: unknown, id: string) => (
			project.sources.find((source) => source.id === id)
		),
		options: { productVideoExportStrategy: strategy },
	};
	return {
		capture,
		exportVideo: createEditorVideoExportAction(runtime as never, async () => Object.freeze({
			sampleRate: SAMPLE_RATE,
			channels: [new Float32Array(SAMPLE_RATE), new Float32Array(SAMPLE_RATE)],
		})),
	};
}

function createFixture(options: FixtureOptions) {
	const events: string[] = [];
	const errors: unknown[] = [];
	const activeSource = createVideoSource({
		id: ACTIVE_SOURCE_ID,
		name: 'Active',
		storageKey: 'active-video-storage',
		mimeType: 'video/mp4',
		contentSha256: ACTIVE_DIGEST,
		sampleFrameCount: SAMPLE_RATE,
		sourceFrameCount: 3,
		frameRate: { num: 3, den: 1 },
		timingDecision: { mode: 'exact', rate: { num: 3, den: 1 } },
		timingAsset: TIMING_PUBLICATION.reference,
		width: 640,
		height: 360,
	});
	const offRangeSource = createVideoSource({
		id: OFF_RANGE_SOURCE_ID,
		name: 'Off range',
		storageKey: 'off-range-video-storage',
		mimeType: 'video/mp4',
		contentSha256: OFF_RANGE_DIGEST,
		sampleFrameCount: SAMPLE_RATE,
		sourceFrameCount: 3,
		frameRate: { num: 3, den: 1 },
		timingDecision: { mode: 'exact', rate: { num: 3, den: 1 } },
		timingAsset: OFF_RANGE_TIMING_PUBLICATION.reference,
		width: 640,
		height: 360,
	});
	const activeClip = Object.freeze({
		id: 'active-clip', kind: 'video', sourceId: ACTIVE_SOURCE_ID,
		timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
		sourceStartFrame: 0, sourceDurationFrames: 3,
		sourceInFrame: 0, sourceFrameCount: 3,
	});
	const offRangeClip = Object.freeze({
		id: 'off-range-clip', kind: 'video', sourceId: OFF_RANGE_SOURCE_ID,
		timelineStartFrame: SAMPLE_RATE * 2, durationFrames: SAMPLE_RATE,
		sourceStartFrame: 0, sourceDurationFrames: 3,
		sourceInFrame: 0, sourceFrameCount: 3,
	});
	const audioClip = Object.freeze({
		id: 'audio-clip', kind: 'audio', sourceId: 'audio-source',
		timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
		sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE,
	});
	const project = Object.freeze({
		id: 'keyed-video', title: 'Keyed video', sampleRate: SAMPLE_RATE, masterChannels: 2,
		tracks: Object.freeze([
			Object.freeze({
				id: 'video-track', type: 'video', hidden: false,
				clipIds: Object.freeze([activeClip.id, offRangeClip.id]),
			}),
			Object.freeze({ id: 'audio-track', type: 'audio', clipIds: Object.freeze([audioClip.id]) }),
		]),
		clips: Object.freeze([activeClip, offRangeClip, audioClip]),
		sources: Object.freeze([
			activeSource,
			offRangeSource,
			Object.freeze({
				id: 'audio-source', kind: 'audio', storageKey: 'audio-storage',
				mimeType: 'audio/wav', frameCount: SAMPLE_RATE, channelCount: 2, sampleRate: SAMPLE_RATE,
			}),
		]),
	});
	const keyedPlan = createVideoKeyframeExportPlanV7({
		format: 'mp4',
		sampleRate: SAMPLE_RATE,
		range: { startFrame: 0, endFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE },
		canvas: {
			width: 640,
			height: 360,
			frameRate: { num: 3, den: 1 },
			fit: 'contain',
			pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
			referenceClipId: activeClip.id,
			referenceSourceId: ACTIVE_SOURCE_ID,
		},
		activeClipIds: [activeClip.id],
		activeSourceIds: [ACTIVE_SOURCE_ID],
		sources: [activeSource],
		includeAudio: true,
	});
	const strategy: ProductVideoExportStrategy = Object.freeze({
		createExportProject() { return project; },
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			events.push('product-plan');
			events.push(`product-format:${request.format}`);
			assert.strictEqual(request.canonicalProject, project);
			if (options.staticRange) return null;
			if (options.malformedPlan === 'missing') {
				const malformed = { ...keyedPlan } as Record<string, unknown>;
				delete malformed.activeSourceIds;
				return malformed as never;
			}
			if (options.malformedPlan === 'duplicate') {
				return { ...keyedPlan, activeSourceIds: [ACTIVE_SOURCE_ID, ACTIVE_SOURCE_ID] } as never;
			}
			if (options.malformedPlan === 'accessor') {
				return Object.defineProperty({ ...keyedPlan }, 'activeSourceIds', {
					enumerable: true,
					get() { throw new Error('active source accessor'); },
				}) as never;
			}
			if (options.malformedPlan === 'entries') {
				const ids = [ACTIVE_SOURCE_ID];
				Object.defineProperty(ids, 'entries', {
					enumerable: true,
					get() { throw new Error('entries accessor must not run'); },
				});
				return { ...keyedPlan, activeSourceIds: ids } as never;
			}
			if (options.malformedPlan === 'prototype') {
				const ids = [ACTIVE_SOURCE_ID];
				Object.setPrototypeOf(ids, null);
				return { ...keyedPlan, activeSourceIds: ids } as never;
			}
			return keyedPlan;
		},
		async encode(request: ProductVideoExportStrategyEncodeRequest) {
			events.push('product-encode');
			events.push(`product-encoder:${request.webCodecs ? 'webcodecs' : 'ffmpeg'}`);
			assertKeyedEncodeRequest(request, keyedPlan, activeSource);
			if (options.encodeFailure) throw options.encodeFailure;
			return Object.freeze({
				bytes: Uint8Array.of(1, 2, 3, 4), byteLength: 4,
				extension: '.mp4' as const, mimeType: 'video/mp4' as const,
			});
		},
		async encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		) {
			events.push('product-encode-sink'); events.push(`product-encoder:${request.webCodecs ? 'webcodecs' : 'ffmpeg'}`);
			assertKeyedEncodeRequest(request, keyedPlan, activeSource);
			await sink.open(4);
			await sink.write(Uint8Array.of(1, 2, 3, 4));
			const output = await sink.close();
			return Object.freeze({
				output, byteLength: 4, chunkCount: 1,
				extension: '.mp4' as const, mimeType: 'video/mp4' as const,
			});
		},
	});
	const state = {
		exportGeneration: 0,
		exportAbort: null as null | Readonly<{ signal: AbortSignal; abort(): void }>,
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		disposed: false,
	};
	let activeController: AbortController | null = null;
	let written = 0;
	const linkedOriginalBlob = new Blob([Uint8Array.of(9)], { type: 'video/mp4' });
	const runtime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		audioBufferChannels: (buffer: Readonly<{ channels: readonly Float32Array[] }>) => buffer.channels,
		cloneProject: <Value>(value: Value): Value => structuredClone(value),
		copy: {
			localSourcesMissing: 'Local sources missing', rendering: 'Rendering',
			encoding: 'Encoding', done: 'Done',
		},
		createVideoExportPlan(_project: unknown, settings: Readonly<{ format: string }>) {
			events.push('legacy-plan');
			events.push(`legacy-format:${settings.format}`);
			return legacyPlan();
		},
		encodeWav: () => Uint8Array.of(0x52, 0x49, 0x46, 0x46),
		ffmpeg: {
			async encodeVideo() {
				events.push('legacy-encode');
				return { bytes: Uint8Array.of(1, 2, 3, 4), mimeType: 'video/mp4' };
			},
		},
		fileService: {
			isDesktop: options.desktop === true,
			getDesktopVideoExportCapabilities: () => Object.freeze({
				schemaVersion: 1,
				formats: Object.freeze({
					mp4: Object.freeze({ available: true, provider: 'external-ffmpeg', reason: null }),
					webm: Object.freeze({ available: true, provider: 'external-ffmpeg', reason: null }),
				}),
			}),
			prepareSave() {
				events.push('prepare');
				if (options.cancelPreparation) return Object.freeze({ mode: 'cancelled', cancelled: true });
				if (options.mode === 'blob') return Object.freeze({ mode: 'blob' as const });
				return Object.freeze({
					mode: 'stream' as const,
					async createWritable(exactByteLength: number, sizeMode: string) {
						events.push(`open:${String(exactByteLength)}:${sizeMode}`);
						return new WritableStream<Uint8Array>({
							write(chunk) { written += chunk.byteLength; events.push(`write:${String(chunk.byteLength)}`); },
							close() { events.push('seal'); },
						});
					},
					bytesWritten: () => written,
					commit() { events.push('commit'); return { size: written, method: 'file-system-access' }; },
					abort() { events.push('abort'); },
				});
			},
			createDownload() {
				events.push('download');
				return Object.freeze({
					cancelled: false, url: 'blob:keyed-video', fileName: 'Keyed-video.mp4',
					method: 'object-url',
				});
			},
		},
		findClip: (value: typeof project, id: string) => value.clips.find((clip) => clip.id === id),
		findSource: (value: typeof project, id: string) => value.sources.find((source) => source.id === id),
		getProject: () => project,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask() {
				activeController = new AbortController();
				return Object.freeze({ signal: activeController.signal, assertCurrent() {}, finish() {} });
			},
			cancelTask() { activeController?.abort(); },
		},
		options: { productVideoExportStrategy: strategy },
		preflightStorage() {},
		projectGeneration: { capture: () => project.id, assertCurrent() {} },
		projectSampleRate: () => SAMPLE_RATE,
		publishDocumentSnapshot() {},
		setStatus() {},
		sourceBuffers: new Map([['audio-source', Object.freeze({})]]),
		state,
		store: {
			async loadMediaAsset(storageKey: string) {
				if (storageKey === TIMING_PUBLICATION.reference.storageKey) {
					events.push('active-timing-load');
					return blobFromBytes(TIMING_PUBLICATION.bytes);
				}
				if (storageKey === OFF_RANGE_TIMING_PUBLICATION.reference.storageKey) {
					events.push('off-range-timing-load');
					if (options.staticRange) return blobFromBytes(OFF_RANGE_TIMING_PUBLICATION.bytes);
					throw new Error('Off-range timing must not load.');
				}
				if (storageKey === 'active-video-storage') {
					events.push('active-video-load');
					if (options.linkedOriginal) return null;
					return new Blob([Uint8Array.of(9)], { type: 'video/mp4' });
				}
				if (storageKey === 'off-range-video-storage') {
					events.push('off-range-video-load');
					return new Blob([Uint8Array.of(8)], { type: 'video/mp4' });
				}
				throw new Error(`Unexpected storage key ${storageKey}.`);
			},
			async resolveLinkedVideoOriginal(
				projectId: string,
				source: Readonly<Record<string, unknown>>,
			) {
				if (!options.linkedOriginal) throw new Error('Unexpected linked-original resolution.');
				assert.equal(projectId, project.id);
				assert.strictEqual(source, activeSource);
				events.push('active-video-linked-load');
				return Object.freeze({
					blob: linkedOriginalBlob,
					binding: Object.freeze({ bindingToken: 'linked-active-video' }),
				});
			},
		},
		throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason; },
		toggleExport() {},
	};
	const renderSnapshot = async () => {
		events.push('render-audio');
		return Object.freeze({
			sampleRate: SAMPLE_RATE,
			channels: Object.freeze([new Float32Array(SAMPLE_RATE), new Float32Array(SAMPLE_RATE)]),
		});
	};
	return {
		activeSource,
		errors,
		events,
		exportVideo: createEditorVideoExportAction(runtime, renderSnapshot),
	};
}

function assertKeyedEncodeRequest(
	request: ProductVideoExportStrategyEncodeRequest,
	plan: ReturnType<typeof createVideoKeyframeExportPlanV7>,
	activeSource: Readonly<Record<string, unknown>>,
): void {
	assert.strictEqual(request.plan, plan);
	assert.deepEqual([...request.videoBlobs.keys()], [ACTIVE_SOURCE_ID]);
	assert.ok(request.audioMix instanceof Blob);
	assert.equal(request.timingBySourceId.size, 1);
	assert.ok(registeredVideoTimingIndex(activeSource));
}

function legacyPlan() {
	return {
		version: CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		quality: 'balanced',
		durationSeconds: 1,
		outputFrameCount: 3,
		canvas: { width: 640, height: 360, frameRate: 3, fit: 'contain', pixelFormat: 'yuv420p' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: 'aac', audioEncoder: 'aac', pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: ACTIVE_SOURCE_ID, storageKey: 'active-video-storage' },
			{ kind: 'staged-audio-mix', inputIndex: 1, fileName: 'audio-mix.wav' },
		],
		filterPlan: { audio: { strategy: 'staged-mix', inputIndex: 1 } },
		range: { startFrame: 0, endFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE },
	};
}

function blobFromBytes(bytes: Uint8Array): Blob {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return new Blob([buffer]);
}

function assertOrder(events: readonly string[], expected: readonly string[]): void {
	let offset = -1;
	for (const event of expected) {
		const next = events.indexOf(event, offset + 1);
		assert.notEqual(next, -1, `Missing ${event} after ${events.slice(offset + 1).join(', ')}`);
		offset = next;
	}
}
