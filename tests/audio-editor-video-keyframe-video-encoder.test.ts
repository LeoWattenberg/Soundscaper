/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	createVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	encodeVideoKeyframeVideo,
	VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES,
	type VideoKeyframeEncoderOperationLease,
	type VideoKeyframeVideoEditorFfmpeg,
} from '../src/common/editor/video-keyframe-video-encoder.ts';
import type { VideoKeyframeRgbaFrameProducer } from '../src/common/editor/video-keyframe-encoder-stream.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const TOKEN = '0123456789abcdef0123456789abcdef';
const MP4 = Uint8Array.of(
	0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
	0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
);
const WEBM = Uint8Array.of(
	0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
	0x18, 0x53, 0x80, 0x67, 0x8c,
	0x16, 0x54, 0xae, 0x6b, 0x81, 0,
	0x1f, 0x43, 0xb6, 0x75, 0x81, 0,
);

test('encodes authenticated V20 frames through one lease into owned exact MP4 and WebM bytes', async () => {
	for (const [format, encoded, extension, mimeType] of [
		['mp4', MP4, '.mp4', 'video/mp4'],
		['webm', WEBM, '.webm', 'video/webm'],
	] as const) {
		const frameSource = source();
		const producer = exactProducer(frameSource);
		const ffmpegBytes = encoded.slice();
		const ffmpeg = fakeEditorFfmpeg(ffmpegBytes);
		const result = await encodeVideoKeyframeVideo(ffmpeg.port, {
			frameSource,
			producer: producer.value,
			format,
			maximumOutputChunkBytes: 5,
		}, { createJobToken: () => TOKEN });

		assert.deepEqual([...result.bytes], [...encoded]);
		assert.notEqual(result.bytes, encoded);
		assert.equal(result.byteLength, encoded.byteLength);
		assert.equal(result.extension, extension);
		assert.equal(result.mimeType, mimeType);
		assert.equal(result.format, format);
		assert.equal(result.frameCount, 1);
		assert.equal(result.rgbaChunkCount, 1);
		assert.equal(result.outputChunkCount, Math.ceil(encoded.byteLength / 5));
		assert.equal(ffmpeg.runCalls(), 1);
		assert.equal(producer.disposeCalls(), 1);
		assert.deepEqual(ffmpeg.paths(), {
			input: `/framescaper-keyframes-${TOKEN}.rgba`,
			output: `/framescaper-keyframes-${TOKEN}${extension}`,
		});
		assert.deepEqual(ffmpeg.events().slice(-2), ['delete-output', 'lease-end']);
		ffmpegBytes.fill(0);
		assert.notDeepEqual([...result.bytes], [...ffmpegBytes], 'returned bytes do not alias FFmpeg storage');
	}
});

test('stats before bounded exact ranges and refuses short, oversized, or invalid containers before return', async (context) => {
	for (const scenario of [
		{ name: 'short range', options: { shortRange: true }, match: /short range/u },
		{ name: 'oversized stat', options: { statSize: 13 }, maximumOutputBytes: 12, match: /maximum/u },
		{ name: 'invalid MP4', options: {}, bytes: Uint8Array.of(1, 2, 3, 4), match: /MP4 container/u },
	] as const) {
		await context.test(scenario.name, async () => {
			const frameSource = source();
			const producer = exactProducer(frameSource);
			const ffmpeg = fakeEditorFfmpeg(scenario.bytes ?? MP4, scenario.options);
			await assert.rejects(
				encodeVideoKeyframeVideo(ffmpeg.port, {
					frameSource,
					producer: producer.value,
					format: 'mp4',
					...(scenario.maximumOutputBytes === undefined
						? {} : { maximumOutputBytes: scenario.maximumOutputBytes }),
					maximumOutputChunkBytes: 5,
				}, { createJobToken: () => TOKEN }),
				scenario.match,
			);
			assert.equal(producer.disposeCalls(), 1);
			assert.equal(ffmpeg.events().includes('delete-output'), true);
			assert.equal(ffmpeg.events().at(-1), 'lease-end');
		});
	}
});

test('finite container evidence rejects truncated, unknown-length, and media-less output', async () => {
	for (const [format, bytes] of [
		['mp4', Uint8Array.of(0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d)],
		['mp4', Uint8Array.of(...MP4.subarray(0, MP4.byteLength - 1))],
		['webm', Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81)],
		['webm', Uint8Array.of(...WEBM.slice(0, 16), 0xff, ...WEBM.slice(17))],
	] as const) {
		const frameSource = source();
		const producer = exactProducer(frameSource);
		await assert.rejects(
			encodeVideoKeyframeVideo(fakeEditorFfmpeg(bytes).port, {
				frameSource,
				producer: producer.value,
				format,
			}, { createJobToken: () => TOKEN }),
			/new finite (?:MP4|WebM) container|finite (?:MP4|WebM) container/u,
		);
		assert.equal(producer.disposeCalls(), 1);
	}
});

test('pre-abort and stale output fencing release the producer and publish no bytes', async () => {
	const frameSource = source();
	const before = exactProducer(frameSource);
	const neverRun = fakeEditorFfmpeg(MP4);
	const controller = new AbortController();
	const reason = new DOMException('cancelled before lease', 'AbortError');
	controller.abort(reason);
	await assert.rejects(
		encodeVideoKeyframeVideo(neverRun.port, {
			frameSource,
			producer: before.value,
			format: 'mp4',
			signal: controller.signal,
		}, { createJobToken: () => TOKEN }),
		(error: unknown) => error === reason,
	);
	assert.equal(neverRun.runCalls(), 0);
	assert.equal(before.disposeCalls(), 1);

	let checks = 0;
	const during = exactProducer(frameSource);
	const stale = fakeEditorFfmpeg(MP4);
	await assert.rejects(
		encodeVideoKeyframeVideo(stale.port, {
			frameSource,
			producer: during.value,
			format: 'mp4',
			assertCurrent() {
				checks += 1;
				if (stale.events().includes('stat-output')) throw new Error('stale export task');
			},
		}, { createJobToken: () => TOKEN }),
		/stale export task/u,
	);
	assert.equal(during.disposeCalls(), 1);
	assert.equal(stale.events().includes('read-output'), false);
	assert.equal(stale.events().includes('delete-output'), true);
	assert.ok(checks > 1);
});

test('cleanup failure terminates the leased generation and blocks otherwise valid publication', async () => {
	const frameSource = source();
	const producer = exactProducer(frameSource);
	const ffmpeg = fakeEditorFfmpeg(MP4, { deleteFailure: new Error('MEMFS delete failed') });
	await assert.rejects(
		encodeVideoKeyframeVideo(ffmpeg.port, {
			frameSource,
			producer: producer.value,
			format: 'mp4',
		}, { createJobToken: () => TOKEN }),
		/MEMFS delete failed/u,
	);
	assert.equal(ffmpeg.events().includes('terminate-execution'), true);
	assert.equal(producer.disposeCalls(), 1);
});

test('producer cleanup is retried once by its outer owner and retains every failure', async () => {
	const frameSource = source();
	let disposals = 0;
	const producer: VideoKeyframeRgbaFrameProducer = Object.freeze({
		width: 2,
		height: 2,
		byteLength: 16,
		produce() { throw new Error('render failed'); },
		dispose() { disposals += 1; throw new Error('synchronous dispose failed'); },
	});
	const ffmpeg = fakeEditorFfmpeg(MP4);
	await assert.rejects(
		encodeVideoKeyframeVideo(ffmpeg.port, {
			frameSource,
			producer,
			format: 'mp4',
		}, { createJobToken: () => TOKEN }),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(flattenErrors(error).join('\n'), /render failed/u);
			assert.match(flattenErrors(error).join('\n'), /synchronous dispose failed/u);
			return true;
		},
	);
	assert.equal(disposals, 2);

	let retryAttempts = 0;
	const retryableProducer: VideoKeyframeRgbaFrameProducer = Object.freeze({
		width: 2,
		height: 2,
		byteLength: 16,
		produce() { throw new Error('retry render failed'); },
		dispose() {
			retryAttempts += 1;
			if (retryAttempts === 1) throw new Error('first cleanup failed');
		},
	});
	await assert.rejects(
		encodeVideoKeyframeVideo(fakeEditorFfmpeg(MP4).port, {
			frameSource,
			producer: retryableProducer,
			format: 'mp4',
		}, { createJobToken: () => TOKEN }),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(String(error.errors[0]), /retry render failed/u);
			assert.match(String(error.errors[1]), /first cleanup failed/u);
			return true;
		},
	);
	assert.equal(retryAttempts, 2);
});

test('editor and lease authority accessors are rejected without invocation', async () => {
	const frameSource = source();
	const beforeOwnership = exactProducer(frameSource);
	let editorGetterCalls = 0;
	const hostileEditor = Object.create(null) as Record<string, unknown>;
	Object.defineProperty(hostileEditor, 'runVideoKeyframeEncoderOperation', {
		enumerable: true,
		get() { editorGetterCalls += 1; return () => undefined; },
	});
	await assert.rejects(
		encodeVideoKeyframeVideo(hostileEditor as never, {
			frameSource,
			producer: beforeOwnership.value,
			format: 'mp4',
		}, { createJobToken: () => TOKEN }),
		/editor FFmpeg.*data property/u,
	);
	assert.equal(editorGetterCalls, 0);
	assert.equal(beforeOwnership.disposeCalls(), 0);

	const acceptedProducer = exactProducer(frameSource);
	let leaseGetterCalls = 0;
	const editor: VideoKeyframeVideoEditorFfmpeg = Object.freeze({
		async runVideoKeyframeEncoderOperation<Output>(
			operation: (lease: VideoKeyframeEncoderOperationLease) => PromiseLike<Output> | Output,
		): Promise<Output> {
			const lease = Object.create(null) as Record<string, unknown>;
			for (const key of [
				'createInputStream', 'exec', 'terminateExecution', 'statFile',
				'readFileRange', 'deleteFile', 'isExecutionTerminated',
			]) {
				Object.defineProperty(lease, key, {
					enumerable: true,
					get() { leaseGetterCalls += 1; return () => undefined; },
				});
			}
			return operation(lease as never);
		},
	});
	await assert.rejects(
		encodeVideoKeyframeVideo(editor, {
			frameSource,
			producer: acceptedProducer.value,
			format: 'mp4',
		}, { createJobToken: () => TOKEN }),
		/lease\.createInputStream.*data property/u,
	);
	assert.equal(leaseGetterCalls, 0);
	assert.equal(acceptedProducer.disposeCalls(), 1);
});

test('the wrapper owns closed options, lower-only caps, and a cryptographic token grammar', async () => {
	assert.equal(VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES, 512 * 1024 * 1024);
	const frameSource = source();
	for (const request of [
		{ format: 'gif' },
		{ format: 'mp4', maximumOutputBytes: VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES + 1 },
		{ format: 'mp4', inputPath: '/attacker.rgba' },
		{ format: 'mp4', outputPath: '/attacker.mp4' },
	] as const) {
		const producer = exactProducer(frameSource);
		const ffmpeg = fakeEditorFfmpeg(MP4);
		await assert.rejects(
			encodeVideoKeyframeVideo(ffmpeg.port, {
				frameSource,
				producer: producer.value,
				...request,
			} as never, { createJobToken: () => TOKEN }),
			/format|maximum|unsupported field/u,
		);
		assert.equal(ffmpeg.runCalls(), 0);
	}
	const producer = exactProducer(frameSource);
	const ffmpeg = fakeEditorFfmpeg(MP4);
	await assert.rejects(
		encodeVideoKeyframeVideo(ffmpeg.port, {
			frameSource,
			producer: producer.value,
			format: 'mp4',
		}, { createJobToken: () => '../predictable' }),
		/128-bit lowercase hexadecimal/u,
	);
	assert.equal(ffmpeg.runCalls(), 0);
	assert.equal(producer.disposeCalls(), 1);
});

function source(): VideoKeyframeExportFrameSource {
	const project = createFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		framescaperV20Options(),
	);
	const compatible = structuredClone(project) as Record<string, unknown>;
	compatible.schemaVersion = 17;
	return createVideoKeyframeExportFrameSource({
		project: resolveRuntimeProjectProjection(compatible),
		canvas: { width: 2, height: 2, frameRate: 1 },
		startFrame: 0,
		endFrame: 48_000,
	});
}

function exactProducer(frameSource: VideoKeyframeExportFrameSource) {
	let disposals = 0;
	const value: VideoKeyframeRgbaFrameProducer = Object.freeze({
		width: frameSource.canvas.width,
		height: frameSource.canvas.height,
		byteLength: frameSource.canvas.width * frameSource.canvas.height * 4,
		produce(frame: VideoKeyframeExportFrame, target: Uint8Array) { target.fill(frame.index + 1); },
		dispose() { disposals += 1; },
	});
	return { value, disposeCalls: () => disposals };
}

interface FakeOptions {
	readonly deleteFailure?: Error;
	readonly shortRange?: boolean;
	readonly statSize?: number;
}

function fakeEditorFfmpeg(encoded: Uint8Array, options: FakeOptions = {}) {
	const log: string[] = [];
	let runs = 0;
	let input = '';
	let output = '';
	const port: VideoKeyframeVideoEditorFfmpeg = {
		async runVideoKeyframeEncoderOperation(operation, operationOptions = {}) {
			runs += 1;
			operationOptions.assertCurrent?.();
			if (operationOptions.signal?.aborted) throw operationOptions.signal.reason;
			log.push('lease-start');
			let resolveExecution: ((code: number) => void) | null = null;
			let terminated = false;
			const lease = {
				async createInputStream(path: string, capacityBytes: number) {
					input = path;
					return Object.freeze({
						path,
						capacityBytes,
						async write() {},
						async close() { resolveExecution?.(0); },
						abort() { resolveExecution?.(1); },
						async dispose() {},
					});
				},
				exec(arguments_: readonly string[]) {
					output = arguments_.at(-1) ?? '';
					return new Promise<number>((resolve) => { resolveExecution = resolve; });
				},
				terminateExecution() { terminated = true; log.push('terminate-execution'); },
				isExecutionTerminated() { return terminated; },
				async statFile(path: string) {
					assert.equal(path, output);
					log.push('stat-output');
					return { size: options.statSize ?? encoded.byteLength };
				},
				async readFileRange(path: string, offset: number, maximumBytes: number) {
					assert.equal(path, output);
					log.push('read-output');
					const end = Math.min(encoded.byteLength, offset + maximumBytes);
					return encoded.subarray(offset, options.shortRange ? Math.max(offset, end - 1) : end);
				},
				async deleteFile(path: string) {
					assert.equal(path, output);
					log.push('delete-output');
					if (options.deleteFailure) throw options.deleteFailure;
				},
			};
			try { return await operation(lease); } finally { log.push('lease-end'); }
		},
	};
	return {
		port,
		events: () => [...log],
		paths: () => ({ input, output }),
		runCalls: () => runs,
	};
}

function flattenErrors(error: unknown): string[] {
	if (error instanceof AggregateError) {
		return [String(error), ...error.errors.flatMap((item: unknown) => flattenErrors(item))];
	}
	return [String(error)];
}
