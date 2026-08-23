/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	encodeVideoKeyframeOfflineVideo,
	encodeVideoKeyframeOfflineVideoToSink,
	type VideoKeyframeOfflineVideoExportDependencies,
} from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import type { VideoKeyframeVideoEditorFfmpeg } from '../src/common/editor/video-keyframe-video-encoder.ts';
import type {
	VideoKeyframeVideoEncoderRequest,
	VideoKeyframeVideoSinkEncoderResult,
} from '../src/common/editor/video-keyframe-video-encoder.ts';
import {
	capturedAssets,
	CLIP_ID,
	editorPort,
	encodedResult,
	exportFixture,
	floatWav,
	harnessDependencies,
	RATE,
	SOURCE_ID,
} from './helpers/video-keyframe-offline-export-harness.ts';

test('authenticates source bytes before resolver/GL and cleans renderer then resolver before return', async () => {
	const fixture = await exportFixture();
	const events: string[] = [];
	const dependencies = harnessDependencies(events);
	const result = await encodeVideoKeyframeOfflineVideo({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		format: 'mp4',
		editorFfmpeg: editorPort(),
		signal: new AbortController().signal,
		assertCurrent: () => { events.push('current'); },
	}, dependencies);

	assert.deepEqual([...result.bytes], [9, 8, 7]);
	assert.deepEqual(events.filter((event) => event !== 'current'), [
		'resolver:create', 'renderer:create', 'encode',
		'renderer:dispose', 'renderer:dispose', 'resolver:dispose',
	]);
	assert.equal(capturedAssets(dependencies)[0]?.sourceId, SOURCE_ID);
	assert.equal(capturedAssets(dependencies)[0]?.identity, fixture.digest);
	assert.deepEqual(capturedAssets(dependencies)[0]?.clipIds, [CLIP_ID]);
	assert.deepEqual([
		capturedAssets(dependencies)[0]?.decodedWidth,
		capturedAssets(dependencies)[0]?.decodedHeight,
		capturedAssets(dependencies)[0]?.displayWidth,
		capturedAssets(dependencies)[0]?.displayHeight,
	], [64, 32, 80, 32]);
	assert.equal(Object.isFrozen(capturedAssets(dependencies)[0]), true);
});

test('carries the delivery fit into the frame source rather than refusing the canvas', async () => {
	const fixture = await exportFixture();
	const events: string[] = [];
	const base = harnessDependencies(events);
	let renderRequest: Readonly<Record<string, unknown>> | undefined;
	const dependencies = Object.freeze({
		...base,
		createRenderer(request: Parameters<typeof base.createRenderer>[0]) {
			renderRequest = request as unknown as Readonly<Record<string, unknown>>;
			return base.createRenderer(request);
		},
	}) as VideoKeyframeOfflineVideoExportDependencies;
	// Every keyed plan states a fit, so a canvas that refused one refused every
	// keyed export; a cover delivery crops where a contain delivery letterboxes.
	await encodeVideoKeyframeOfflineVideo({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE, fit: 'cover' },
		format: 'mp4',
		editorFfmpeg: editorPort(),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, dependencies);
	const frameSource = renderRequest?.frameSource as Readonly<{
		canvas: Readonly<{ fit: string }>;
	}> | undefined;
	assert.equal(frameSource?.canvas.fit, 'cover');
});

test('threads the authenticated RGBA post-compositor only into the owned renderer', async () => {
	const fixture = await exportFixture();
	const events: string[] = [];
	const base = harnessDependencies(events);
	let renderRequest: Readonly<Record<string, unknown>> | undefined;
	const postprocess = async () => undefined;
	const dependencies = Object.freeze({
		...base,
		createRenderer(request: Parameters<typeof base.createRenderer>[0]) {
			renderRequest = request as unknown as Readonly<Record<string, unknown>>;
			return base.createRenderer(request);
		},
	}) as VideoKeyframeOfflineVideoExportDependencies;
	await encodeVideoKeyframeOfflineVideo({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		format: 'mp4',
		rgbaPostprocessor: postprocess,
		editorFfmpeg: editorPort(),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, dependencies);
	assert.strictEqual(renderRequest?.postprocess, postprocess);
});

test('rejects missing, duplicate, or digest-mismatched Blobs before resolver and GL allocation', async () => {
	const fixture = await exportFixture();
	for (const [sources, match] of [
		[[], /source|Blob|exactly/iu],
		[[{ sourceId: SOURCE_ID, blob: fixture.blob }, { sourceId: SOURCE_ID, blob: fixture.blob }], /duplicate/iu],
		[[{ sourceId: SOURCE_ID, blob: new Blob([Uint8Array.of(0)]) }], /digest|bytes|identity/iu],
	] as const) {
		const events: string[] = [];
		await assert.rejects(encodeVideoKeyframeOfflineVideo({
			project: fixture.project,
			timingBySourceId: fixture.timing,
			sources,
			canvas: { width: 64, height: 32, frameRate: RATE },
			format: 'mp4',
			editorFfmpeg: editorPort(),
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
		}, harnessDependencies(events)), match);
		assert.deepEqual(events, []);
	}
});

test('preflights encoder geometry, logical work, and output bounds before resolver or GL allocation', async () => {
	const fixture = await exportFixture();
	for (const override of [
		// An extent no longer decides; one RGBA frame fitting 8 MiB does.
		{ canvas: { width: 5_828, height: 360, frameRate: RATE } },
		{ canvas: { width: 3, height: 2, frameRate: RATE } },
		{ maximumTotalRgbaBytes: 64 * 32 * 4 * 10 - 1 },
		{ maximumOutputBytes: 0 },
		{ maximumOutputChunkBytes: 1024 * 1024 + 1 },
	] as const) {
		const events: string[] = [];
		await assert.rejects(encodeVideoKeyframeOfflineVideo({
			project: fixture.project,
			timingBySourceId: fixture.timing,
			sources: [{ sourceId: SOURCE_ID, blob: new Blob([Uint8Array.of(0)]) }],
			canvas: { width: 64, height: 32, frameRate: RATE },
			format: 'mp4',
			editorFfmpeg: editorPort(),
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			...override,
		}, harnessDependencies(events)), /frame bytes|dimensions|logical RGBA work|maximumOutput/u);
		assert.deepEqual(events, []);
	}
});

test('authenticates exact float32 audio before resolver or GL and forwards its bounded options', async () => {
	const fixture = await exportFixture();
	const audioMix = floatWav(48_000);
	const events: string[] = [];
	let captured: VideoKeyframeVideoEncoderRequest | undefined;
	const dependencies = harnessDependencies(events, {
		encode: async (_editor, request) => {
			events.push('encode');
			captured = request;
			return encodedResult();
		},
	});
	await encodeVideoKeyframeOfflineVideo({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		format: 'mp4',
		editorFfmpeg: editorPort(),
		audioMix,
		ringCapacityBytes: 4_096,
		audioRingCapacityBytes: 8_192,
		maximumAudioBytes: audioMix.size,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, dependencies);
	assert.equal(captured?.audioMix instanceof Blob, true);
	assert.notEqual(captured?.audioMix, audioMix);
	assert.equal(captured?.audioRingCapacityBytes, 8_192);
	assert.equal(captured?.maximumAudioBytes, audioMix.size);
	assert.ok(events.indexOf('resolver:create') < events.indexOf('encode'));

	for (const mismatch of [floatWav(47_999), floatWav(48_000, 44_100)]) {
		const mismatchEvents: string[] = [];
		await assert.rejects(encodeVideoKeyframeOfflineVideo({
			project: fixture.project,
			timingBySourceId: fixture.timing,
			sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
			canvas: { width: 64, height: 32, frameRate: RATE },
			format: 'mp4',
			editorFfmpeg: editorPort(),
			audioMix: mismatch,
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
		}, harnessDependencies(mismatchEvents)), /float32 WAV (?:frame count|sample rate).*exact export|project sample rate/u);
		assert.deepEqual(mismatchEvents, []);
	}
});

test('offline direct entry forwards one managed sink and preserves browser cleanup ordering', async () => {
	const fixture = await exportFixture();
	const events: string[] = [];
	const destination = Object.freeze({ kind: 'destination' });
	let sinkIdentity: unknown;
	const sink: FfmpegOutputSink<typeof destination> = Object.freeze({
		async open() {}, async write() {}, async close() { return destination; }, async abort() {},
	});
	const dependencies: VideoKeyframeOfflineVideoExportDependencies = Object.freeze({
		...harnessDependencies(events),
		async encodeVideoToSink(
			_editor: VideoKeyframeVideoEditorFfmpeg,
			_request: VideoKeyframeVideoEncoderRequest,
			receivedSink: FfmpegOutputSink<unknown>,
		): Promise<VideoKeyframeVideoSinkEncoderResult<unknown>> {
			events.push('encode-sink');
			sinkIdentity = receivedSink;
			return Object.freeze({
				output: destination,
				byteLength: 123,
				videoEncoder: 'ffmpeg' as const,
				format: 'mp4' as const,
				extension: '.mp4' as const,
				mimeType: 'video/mp4' as const,
				frameCount: 1,
				rgbaChunkCount: 1,
				outputChunkCount: 1,
			});
		},
	});
	const result = await encodeVideoKeyframeOfflineVideoToSink({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		format: 'mp4',
		editorFfmpeg: editorPort(),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, sink, dependencies);
	assert.equal(result.output, destination);
	assert.notEqual(sinkIdentity, sink);
	assert.deepEqual(events, [
		'resolver:create', 'renderer:create', 'encode-sink',
		'renderer:dispose', 'resolver:dispose',
	]);
});

test('releases a created resolver when canvas or renderer creation fails', async () => {
	const fixture = await exportFixture();
	for (const throwAt of ['canvas', 'renderer'] as const) {
		const events: string[] = [];
		const base = harnessDependencies(events);
		const dependencies: VideoKeyframeOfflineVideoExportDependencies = Object.freeze({
			...base,
			createCanvas: throwAt === 'canvas'
				? () => { events.push('canvas:throw'); throw new Error('canvas failed'); }
				: base.createCanvas,
			createRenderer: throwAt === 'renderer'
				? () => { events.push('renderer:throw'); throw new Error('renderer failed'); }
				: base.createRenderer,
		});
		await assert.rejects(encodeVideoKeyframeOfflineVideo({
			project: fixture.project,
			timingBySourceId: fixture.timing,
			sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
			canvas: { width: 64, height: 32, frameRate: RATE },
			format: 'mp4',
			editorFfmpeg: editorPort(),
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
		}, dependencies), new RegExp(`${throwAt} failed`, 'u'));
		assert.deepEqual(events, [
			'resolver:create', `${throwAt}:throw`, 'resolver:dispose',
		]);
	}
});

test('rejects invalid frame ranges and binary project payloads before planning or allocation', async () => {
	const fixture = await exportFixture();
	for (const range of [
		{ startFrame: '0' },
		{ startFrame: -1 },
		{ startFrame: 10, endFrame: 10 },
		{ endFrame: 0 },
	] as const) {
		const events: string[] = [];
		await assert.rejects(encodeVideoKeyframeOfflineVideo({
			project: fixture.project,
			timingBySourceId: fixture.timing,
			sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
			canvas: { width: 64, height: 32, frameRate: RATE },
			format: 'mp4',
			editorFfmpeg: editorPort(),
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
			...range,
		} as never, harnessDependencies(events)), /startFrame|endFrame|range/iu);
		assert.deepEqual(events, []);
	}

	const project = { ...fixture.project, opaqueBinary: new Uint8Array(4 * 1024 * 1024) };
	const events: string[] = [];
	const clone = globalThis.structuredClone;
	let cloneCalls = 0;
	globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
		cloneCalls += 1;
		return clone(value, options);
	}) as typeof structuredClone;
	try {
		await assert.rejects(encodeVideoKeyframeOfflineVideo({
			project,
			timingBySourceId: fixture.timing,
			sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
			canvas: { width: 64, height: 32, frameRate: RATE },
			format: 'mp4',
			editorFfmpeg: editorPort(),
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
		}, harnessDependencies(events)), /cannot embed binary data/u);
	} finally {
		globalThis.structuredClone = clone;
	}
	assert.equal(cloneCalls, 0);
	assert.deepEqual(events, []);

	let getterCalls = 0;
	const hostileProject = { ...fixture.project } as Record<string, unknown>;
	Object.defineProperty(hostileProject, 'opaqueAccessor', {
		enumerable: true,
		get() { getterCalls += 1; return new Uint8Array(1); },
	});
	await assert.rejects(encodeVideoKeyframeOfflineVideo({
		project: hostileProject,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		format: 'mp4',
		editorFfmpeg: editorPort(),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, harnessDependencies(events)), /data propert|accessor/iu);
	assert.equal(getterCalls, 0);
	assert.deepEqual(events, []);
});

test('requires Blobs and timing only for visible sources intersecting the export range', async () => {
	const fixture = await exportFixture({ inactiveSources: true });
	const events: string[] = [];
	const dependencies = harnessDependencies(events);
	await encodeVideoKeyframeOfflineVideo({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		startFrame: 0,
		endFrame: 48_000,
		format: 'mp4',
		editorFfmpeg: editorPort(),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, dependencies);
	assert.deepEqual(capturedAssets(dependencies).map(({ sourceId }) => sourceId), [SOURCE_ID]);
	assert.deepEqual(capturedAssets(dependencies)[0]?.clipIds, [CLIP_ID]);
});

test('captures decoder-rotated geometry separately from PAR display geometry', async () => {
	const fixture = await exportFixture({ rotationDegrees: 90 });
	const dependencies = harnessDependencies([]);
	await encodeVideoKeyframeOfflineVideo({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		format: 'mp4',
		editorFfmpeg: editorPort(),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, dependencies);
	const asset = capturedAssets(dependencies)[0];
	assert.deepEqual([
		asset?.decodedWidth, asset?.decodedHeight, asset?.displayWidth, asset?.displayHeight,
	], [32, 64, 32, 80]);
});

test('snapshots mutable request ports and canonical source identity before digest continuation', async () => {
	const fixture = await exportFixture();
	const events: string[] = [];
	const dependencies = { ...harnessDependencies(events) };
	const project = structuredClone(fixture.project) as Record<string, unknown>;
	const timing = new Map(fixture.timing);
	const sources = [{ sourceId: SOURCE_ID, blob: fixture.blob }];
	const canvas = { width: 64, height: 32, frameRate: RATE };
	const editor = { runVideoKeyframeEncoderOperation: async () => { throw new Error('injected encoder only'); } };
	const pending = encodeVideoKeyframeOfflineVideo({
		project,
		timingBySourceId: timing,
		sources,
		canvas,
		format: 'mp4',
		editorFfmpeg: editor,
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, dependencies);
	((project.sources as Array<Record<string, unknown>>)[0]!).contentSha256 = 'ff'.repeat(32);
	timing.clear();
	sources[0]!.sourceId = 'mutated-source';
	canvas.width = 1_282;
	editor.runVideoKeyframeEncoderOperation = async () => { throw new Error('mutated editor'); };
	dependencies.createResolver = () => { throw new Error('mutated resolver'); };
	const result = await pending;
	assert.deepEqual([...result.bytes], [9, 8, 7]);
	assert.ok(events.includes('resolver:create'));
});

test('aggregates encode and cleanup failures and retries transient renderer cleanup', async () => {
	const fixture = await exportFixture();
	const events: string[] = [];
	let rendererDisposals = 0;
	const dependencies = harnessDependencies(events, {
		encode: async () => { throw new Error('encode failed'); },
		rendererDispose: async () => {
			rendererDisposals += 1;
			if (rendererDisposals === 1) throw new Error('renderer cleanup once');
		},
		resolverDispose: () => { throw new Error('resolver cleanup failed'); },
	});
	await assert.rejects(encodeVideoKeyframeOfflineVideo({
		project: fixture.project,
		timingBySourceId: fixture.timing,
		sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
		canvas: { width: 64, height: 32, frameRate: RATE },
		format: 'mp4',
		editorFfmpeg: editorPort(),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	}, dependencies), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(String(error.errors[0]), /encode failed/u);
		assert.match(String(error.errors.at(-1)), /resolver cleanup failed/u);
		return true;
	});
	assert.equal(rendererDisposals, 2);
	assert.equal(events.at(-1), 'resolver:dispose');
});

test('zeroes encoded bytes when cleanup or final currentness fails before publication', async () => {
	const fixture = await exportFixture();
	for (const scenario of ['cleanup', 'currentness'] as const) {
		const encoded = Uint8Array.of(9, 8, 7);
		let currentCalls = 0;
		const dependencies = harnessDependencies([], {
			encoded,
			resolverDispose: scenario === 'cleanup' ? () => { throw new Error('cleanup failed'); } : undefined,
		});
		await assert.rejects(encodeVideoKeyframeOfflineVideo({
			project: fixture.project,
			timingBySourceId: fixture.timing,
			sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
			canvas: { width: 64, height: 32, frameRate: RATE },
			format: 'mp4',
			editorFfmpeg: editorPort(),
			signal: new AbortController().signal,
			assertCurrent: () => {
				currentCalls += 1;
				if (scenario === 'currentness' && currentCalls > 4) throw new Error('stale');
			},
		}, dependencies), scenario === 'cleanup' ? /cleanup/u : /stale/u);
		assert.deepEqual([...encoded], [0, 0, 0]);
	}
});
