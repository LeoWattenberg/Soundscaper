/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { admitVideoKeyframeAudioInput } from '../src/common/editor/video-keyframe-audio-input.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	createVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	admitVideoKeyframeEncoderWorkload,
	encodeVideoKeyframeFrames,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
	type VideoKeyframeRgbaFrameProducer,
} from '../src/common/editor/video-keyframe-encoder-stream.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('encoder workload admission is exact, immutable, and owns one unambiguous RGBA input', () => {
	const frameSource = source({ width: 40, height: 40, frameRate: 3 });
	const admission = admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'webm',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
		ringCapacityBytes: 4_096,
	});
	assert.deepEqual(admission, {
		videoEncoder: 'ffmpeg',
		elementaryFormat: 'ivf',
		width: 40,
		height: 40,
		frameRate: { num: 3, den: 1 },
		frameCount: 3,
		frameBytes: 6_400,
		totalRgbaBytes: 19_200,
		ringCapacityBytes: 4_096,
		chunksPerFrame: 2,
		format: 'webm',
		extension: '.webm',
		mimeType: 'video/webm',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
		ffmpegArguments: [
			'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
			'-video_size', '40x40', '-framerate', '3/1', '-i', '/frames.rgba',
			'-frames:v', '3', '-map', '0:v:0', '-map_metadata', '-1',
			'-map_chapters', '-1', '-sn', '-dn', '-c:v', 'libvpx-vp9',
			'-crf', '31', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4',
			'-pix_fmt', 'yuv420p', '-r', '3/1', '-an', '-f', 'webm',
			'/encoded.webm',
		],
	});
	assert.equal(Object.isFrozen(admission), true);
	assert.equal(Object.isFrozen(admission.frameRate), true);
	assert.equal(Object.isFrozen(admission.ffmpegArguments), true);
	// An extent is bounded only by what an encoder can express; the real ceiling
	// is one RGBA frame fitting 8 MiB, which is about 2.09 megapixels however the
	// extents are arranged, so a portrait canvas costs exactly what its landscape
	// counterpart does.
	assert.equal(VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH, 16_384);
	assert.equal(VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT, 16_384);
	assert.equal(VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT, 2_000_000);
	assert.equal(VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES, 1024 ** 4);
});

test('admission enforces non-raiseable geometry, frame, and logical-work ceilings', () => {
	assert.throws(
		() => admission(source({ width: 16_386, height: 2, frameRate: 1 })),
		/width.*1 through 16384/u,
	);
	assert.throws(
		() => admission(source({ width: 2, height: 16_386, frameRate: 1 })),
		/height.*1 through 16384/u,
	);
	// A 1080x1920 vertical frame is 8,294,400 bytes and admitted; 1080x1944 is
	// 8,398,080 and refused. The frame-byte limit decides, not the orientation.
	assert.doesNotThrow(() => admission(source({ width: 1_080, height: 1_920, frameRate: 1 })));
	assert.throws(
		() => admission(source({ width: 1_080, height: 1_944, frameRate: 1 })),
		/frame bytes exceed the 8 MiB/u,
	);
	assert.throws(
		() => admission(source({ width: 3, height: 2, frameRate: 1 })),
		/dimensions must be even/u,
	);
	assert.throws(
		() => admission(source({ width: 2, height: 2, frameRate: 2_000_001 })),
		/frame count.*2000000/u,
	);
	assert.throws(
		() => admission(source({ width: 1_280, height: 720, frameRate: 300_000 })),
		/logical RGBA work.*1099511627776/u,
	);
	const ordinary = source({ width: 40, height: 40, frameRate: 3 });
	assert.throws(
		() => admission(ordinary, { maximumWidth: 16_385 }),
		/maximumWidth.*cannot exceed 16384/u,
	);
	assert.throws(
		() => admission(ordinary, { maximumFrameCount: 2 }),
		/frame count.*1 through 2/u,
	);
	assert.throws(
		() => admission(ordinary, { maximumTotalRgbaBytes: 19_199 }),
		/logical RGBA work.*configured maximum/u,
	);
});

test('admission has a finite format grammar and rejects hostile fields before FFmpeg or producer I/O', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 1 });
	for (const unsafe of [
		{ encodingArguments: ['-filter_complex', 'movie=/secret'] },
		{ filterScript: '/script' },
		{ attach: '/secret' },
		{ format: 'https://example.invalid/video' },
		{ outputPath: '/encoded.webm', extraOutput: '/other.webm' },
	]) {
		assert.throws(
			() => admission(frameSource, unsafe),
			/unsupported field|format must be mp4 or webm/u,
		);
	}
	assert.throws(
		() => admission(frameSource, { format: 'mp4', outputPath: '/encoded.webm' }),
		/mp4 output path must end with \.mp4/u,
	);
	assert.throws(
		() => admission(frameSource, { inputPath: '/frames/' }),
		/canonical absolute path/u,
	);
	assert.throws(
		() => admission(frameSource, { inputPath: `/${'a'.repeat(1_025)}` }),
		/canonical absolute path/u,
	);
	assert.throws(
		() => admitVideoKeyframeEncoderWorkload({
			frameSource: { ...frameSource },
			format: 'webm',
			inputPath: '/frames.rgba',
			outputPath: '/encoded.webm',
		} as never),
		/authenticated.*frame source/u,
	);
	let getterCalls = 0;
	const hostile = { outputPath: '/encoded.rgba' } as Record<string, unknown>;
	Object.defineProperty(hostile, 'frameSource', {
		enumerable: true,
		get() { getterCalls += 1; return frameSource; },
	});
	assert.throws(
		() => admitVideoKeyframeEncoderWorkload(hostile as never),
		/frameSource.*data property/u,
	);
	assert.equal(getterCalls, 0);
	const ffmpeg = fakeFfmpeg();
	const producer = producerFor(frameSource);
	await assert.rejects(
		encodeVideoKeyframeFrames({
			frameSource,
			producer: { ...producer, byteLength: 63 },
			ffmpeg,
			format: 'mp4',
			inputPath: '/frames.rgba',
			outputPath: '/encoded.mp4',
		}),
		/producer byteLength.*frame byte length/u,
	);
	assert.equal(ffmpeg.events.length, 0);
});

test('encoder produces serial frames into one reusable allocation and capacity-bounded writes', async () => {
	const frameSource = source({ width: 40, height: 40, frameRate: 3 });
	const ffmpeg = fakeFfmpeg();
	const targets: Uint8Array[] = [];
	let activeProduces = 0;
	let maximumActiveProduces = 0;
	let disposed = 0;
	const producer = exactProducer(frameSource, async (frame, target) => {
		activeProduces += 1;
		maximumActiveProduces = Math.max(maximumActiveProduces, activeProduces);
		target.fill(frame.index + 1);
		targets.push(target);
		await Promise.resolve();
		activeProduces -= 1;
	}, async () => { disposed += 1; });
	const result = await encodeVideoKeyframeFrames({
		frameSource,
		producer,
		ffmpeg,
		format: 'webm',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
		ringCapacityBytes: 4_096,
	});
	assert.equal(new Set(targets).size, 1);
	assert.equal(maximumActiveProduces, 1);
	assert.deepEqual(ffmpeg.writes.map((chunk) => chunk.byteLength), [4_096, 2_304, 4_096, 2_304, 4_096, 2_304]);
	assert.deepEqual(ffmpeg.writes.map((chunk) => chunk[0]), [1, 1, 2, 2, 3, 3]);
	assert.equal(ffmpeg.maximumActiveWrites, 1);
	assert.equal(disposed, 1);
	assert.deepEqual(ffmpeg.events, ['create', 'exec', 'write', 'write', 'write', 'write', 'write', 'write', 'close', 'stream-dispose']);
	assert.deepEqual(result, {
		exitCode: 0,
		videoEncoder: 'ffmpeg',
		frameCount: 3,
		frameBytes: 6_400,
		totalRgbaBytes: 19_200,
		videoByteLength: 19_200,
		chunkCount: 6,
		format: 'webm',
		extension: '.webm',
		mimeType: 'video/webm',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
		ffmpegArguments: result.ffmpegArguments,
	});
	assert.equal(Object.isFrozen(result), true);
});

test('producer must return void and retain the exact reusable RGBA allocation', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 1 });
	for (const mutate of [
		(_target: Uint8Array) => new Uint8Array(64),
		(target: Uint8Array) => target,
		(target: Uint8Array) => {
			structuredClone(target.buffer, { transfer: [target.buffer] });
			return undefined;
		},
	]) {
		const ffmpeg = fakeFfmpeg();
		const producer = exactProducer(frameSource, (_frame, target) => mutate(target) as never);
		await assert.rejects(
			encode(frameSource, producer, ffmpeg),
			/return void|reusable RGBA allocation/u,
		);
		assert.ok(ffmpeg.events.includes('abort'));
		assert.ok(ffmpeg.events.includes('stream-dispose'));
	}
});

test('producer, currentness, and early-exec failures abort both sides and aggregate cleanup failures', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 2 });
	const renderFailure = new Error('renderer failed');
	const disposeFailure = new Error('renderer dispose failed');
	const ffmpeg = fakeFfmpeg();
	const producer = exactProducer(
		frameSource,
		() => { throw renderFailure; },
		() => { throw disposeFailure; },
	);
	await assert.rejects(
		encode(frameSource, producer, ffmpeg),
		(error: unknown) => error instanceof AggregateError
			&& error.errors[0] === renderFailure
			&& error.errors.includes(disposeFailure),
	);
	assert.ok(ffmpeg.events.includes('abort'));

	let checks = 0;
	const stale = new Error('stale export');
	const staleFfmpeg = fakeFfmpeg();
	await assert.rejects(
		encode(frameSource, producerFor(frameSource), staleFfmpeg, {
			assertCurrent() {
				checks += 1;
				if (checks === 4) throw stale;
			},
		}),
		(error: unknown) => error === stale,
	);
	assert.ok(staleFfmpeg.events.includes('abort'));

	const early = fakeFfmpeg({ earlyExitCode: 0 });
	await assert.rejects(
		encode(frameSource, producerFor(frameSource), early),
		/FFmpeg execution completed before every admitted RGBA frame was written/u,
	);
	assert.ok(early.events.includes('abort'));

	const neverSettles = fakeFfmpeg({ neverSettle: true });
	await assert.rejects(
		encode(frameSource, exactProducer(frameSource, () => { throw renderFailure; }), neverSettles),
		(error: unknown) => error === renderFailure,
	);
	assert.ok(neverSettles.events.includes('terminate-execution'));
	assert.ok(neverSettles.events.includes('stream-dispose'));
});

test('pre-abort avoids FFmpeg media I/O but still releases the admitted producer', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 1 });
	const controller = new AbortController();
	controller.abort(new Error('cancelled'));
	const ffmpeg = fakeFfmpeg();
	let disposed = 0;
	const producer = exactProducer(frameSource, () => undefined, () => { disposed += 1; });
	await assert.rejects(
		encode(frameSource, producer, ffmpeg, { signal: controller.signal }),
		/cancelled/u,
	);
	assert.equal(ffmpeg.events.length, 0);
	assert.equal(disposed, 1);
});

test('encoder closes accepted producer and malformed stream ownership on boundary failures', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 1 });
	let producerDisposals = 0;
	const producer = exactProducer(
		frameSource, (_frame, target) => { target.fill(1); }, () => { producerDisposals += 1; },
	);
	await assert.rejects(encodeVideoKeyframeFrames({
		frameSource,
		producer,
		ffmpeg: Object.freeze({ exec() { return 0; }, terminateExecution() {} }) as never,
		format: 'webm',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
	}), /createInputStream/u);
	assert.equal(producerDisposals, 1);

	let aborts = 0;
	let streamDisposals = 0;
	let terminations = 0;
	const malformed = Object.freeze({
		path: '/different.rgba',
		capacityBytes: 4_096,
		async write() {},
		async close() {},
		abort() { aborts += 1; },
		async dispose() { streamDisposals += 1; },
	});
	await assert.rejects(encodeVideoKeyframeFrames({
		frameSource,
		producer: exactProducer(frameSource, () => undefined),
		ffmpeg: Object.freeze({
			async createInputStream() { return malformed; },
			exec() { return 0; },
			terminateExecution() { terminations += 1; },
		}),
		format: 'webm',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
		ringCapacityBytes: 4_096,
	}), /does not match its admitted reservation/u);
	assert.equal(aborts, 1);
	assert.equal(streamDisposals, 1);
	assert.equal(terminations, 0);
});

test('encoder terminates its leased runtime when exact stream cleanup fails', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 1 });
	const cleanup = new Error('stream cleanup failed');
	let resolveExecution: ((code: number) => void) | null = null;
	let terminations = 0;
	const ffmpeg = Object.freeze({
		async createInputStream(path: string, capacityBytes: number) {
			return Object.freeze({
				path,
				capacityBytes,
				async write() {},
				async close() { resolveExecution?.(0); },
				abort() {},
				async dispose() { throw cleanup; },
			});
		},
		exec() { return new Promise<number>((resolve) => { resolveExecution = resolve; }); },
		terminateExecution() { terminations += 1; },
	});
	await assert.rejects(
		encode(frameSource, producerFor(frameSource), ffmpeg as never),
		(error: unknown) => error === cleanup,
	);
	assert.equal(terminations, 1);
});

test('active cancellation settles production before renderer disposal', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 1 });
	const controller = new AbortController();
	const ffmpeg = fakeFfmpeg({ neverSettle: true });
	let active = false;
	let disposed = 0;
	let notifyStarted: (() => void) | null = null;
	const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
	const producer = exactProducer(
		frameSource,
		(_frame, _target, options) => new Promise<void>((_resolve, reject) => {
			active = true;
			notifyStarted?.();
			options.signal?.addEventListener('abort', () => {
				active = false;
				reject(options.signal?.reason);
			}, { once: true });
		}),
		() => {
			assert.equal(active, false);
			disposed += 1;
		},
	);
	const encoding = encode(frameSource, producer, ffmpeg, { signal: controller.signal });
	await started;
	const cancelled = new Error('active cancellation');
	controller.abort(cancelled);
	await assert.rejects(encoding, (error: unknown) => error === cancelled);
	assert.equal(disposed, 1);
	assert.ok(ffmpeg.events.includes('terminate-execution'));
});

test('lower encoder binds authenticated audio timing before FFmpeg stream ownership', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 1 });
	for (const [frameCount, sampleRate, match] of [
		[47_999, 48_000, /frame count.*exact export range/u],
		[48_000, 44_100, /sample rate.*exact frame source/u],
	] as const) {
		const bytes = Uint8Array.from(encodeWav(
			[new Float32Array(frameCount)],
			{ sampleRate, bitDepth: 32, float: true, dither: 'none' },
		));
		const audioSource = await admitVideoKeyframeAudioInput(
			new Blob([bytes.buffer], { type: 'audio/wav' }),
		);
		const ffmpeg = fakeFfmpeg();
		await assert.rejects(encodeVideoKeyframeFrames({
			frameSource,
			producer: producerFor(frameSource),
			ffmpeg,
			format: 'webm',
			inputPath: '/frames.rgba',
			audioInputPath: '/mix.wav',
			outputPath: '/encoded.webm',
			audioSource,
		}), match);
		assert.deepEqual(ffmpeg.events, []);
	}
});

function admission(
	frameSource: VideoKeyframeExportFrameSource,
	overrides: Readonly<Record<string, unknown>> = {},
) {
	return admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'webm',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
		...overrides,
	} as never);
}

function encode(
	frameSource: VideoKeyframeExportFrameSource,
	producer: VideoKeyframeRgbaFrameProducer,
	ffmpeg: ReturnType<typeof fakeFfmpeg>,
	overrides: Readonly<Record<string, unknown>> = {},
) {
	return encodeVideoKeyframeFrames({
		frameSource,
		producer,
		ffmpeg,
		format: 'webm',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.webm',
		...overrides,
	} as never);
}

function source(options: Readonly<{ width: number; height: number; frameRate: number }>) {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const compatible = structuredClone(project) as Record<string, unknown>;
	compatible.schemaVersion = 17;
	return createVideoKeyframeExportFrameSource({
		project: resolveRuntimeProjectProjection(compatible),
		canvas: options,
		startFrame: 0,
		endFrame: 48_000,
	});
}

function producerFor(frameSource: VideoKeyframeExportFrameSource) {
	return exactProducer(frameSource, (frame, target) => { target.fill(frame.index); });
}

function exactProducer(
	frameSource: VideoKeyframeExportFrameSource,
	produce: (
		frame: VideoKeyframeExportFrame,
		target: Uint8Array,
		options: Readonly<{ signal?: AbortSignal }>,
	) => PromiseLike<void> | void,
	dispose: () => PromiseLike<void> | void = () => undefined,
): VideoKeyframeRgbaFrameProducer {
	return Object.freeze({
		width: frameSource.canvas.width,
		height: frameSource.canvas.height,
		byteLength: frameSource.canvas.width * frameSource.canvas.height * 4,
		produce,
		dispose,
	});
}

function fakeFfmpeg(options: Readonly<{ earlyExitCode?: number; neverSettle?: boolean }> = {}) {
	const events: string[] = [];
	const writes: Uint8Array[] = [];
	let resolveExecution: ((code: number) => void) | null = null;
	let activeWrites = 0;
	let maximumActiveWrites = 0;
	return {
		events,
		writes,
		get maximumActiveWrites() { return maximumActiveWrites; },
		async createInputStream(path: string, capacityBytes: number) {
			events.push('create');
			let ended = false;
			return Object.freeze({
				path,
				capacityBytes,
				async write(chunk: Uint8Array) {
					if (ended) throw new Error('fake stream ended');
					events.push('write');
					activeWrites += 1;
					maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
					await Promise.resolve();
					writes.push(chunk.slice());
					activeWrites -= 1;
				},
				async close() {
					ended = true;
					events.push('close');
					resolveExecution?.(0);
				},
				abort() {
					ended = true;
					events.push('abort');
					resolveExecution?.(1);
				},
				async dispose() { events.push('stream-dispose'); },
			});
		},
		exec() {
			events.push('exec');
			if (options.earlyExitCode !== undefined) return Promise.resolve(options.earlyExitCode);
			if (options.neverSettle) return new Promise<number>(() => undefined);
			return new Promise<number>((resolve) => { resolveExecution = resolve; });
		},
		terminateExecution() { events.push('terminate-execution'); },
	};
}
