/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	createVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrameSource,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	encodeVideoKeyframeVideoToSink,
	type VideoKeyframeEncoderOperationLease,
	type VideoKeyframeVideoEditorFfmpeg,
} from '../src/common/editor/video-keyframe-video-encoder.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const TOKEN = 'fedcba9876543210fedcba9876543210';
const MP4 = Uint8Array.of(
	0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
	0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
);
const DESTINATION = Object.freeze({ kind: 'direct-destination' });

test('direct keyed delivery stats and streams bounded ranges before MEMFS deletion and lease release', async () => {
	const events: string[] = [];
	const fake = sinkFfmpeg(MP4, events);
	const sink = recordingSink(events);
	const frameSource = source();
	const result = await encodeVideoKeyframeVideoToSink(fake.port, {
		frameSource,
		producer: producer(frameSource),
		format: 'mp4',
		maximumOutputChunkBytes: 5,
	}, sink.value, { createJobToken: () => TOKEN });

	assert.equal(result.output, DESTINATION);
	assert.equal(result.byteLength, MP4.byteLength);
	assert.equal(result.outputChunkCount, Math.ceil(MP4.byteLength / 5));
	assert.equal(result.extension, '.mp4');
	assert.equal(result.mimeType, 'video/mp4');
	assert.deepEqual(sink.bytes(), [...MP4]);
	assert.equal(Math.max(...fake.rangeSizes()) <= 1024 * 1024, true);
	assert.equal(fake.rangeSizes().slice(-result.outputChunkCount).every((size) => size <= 5), true);
	assert.ok(events.indexOf('stat-output') < events.indexOf('open-sink'));
	assert.ok(events.indexOf('close-sink') < events.indexOf('delete-output'));
	assert.ok(events.indexOf('delete-output') < events.indexOf('lease-end'));
	assert.equal(sink.abortCalls(), 0);
});

test('direct write and post-close MEMFS cleanup failures abort the destination exactly once', async (context) => {
	await context.test('write failure', async () => {
		const events: string[] = [];
		const failure = new Error('destination write failed');
		const fake = sinkFfmpeg(MP4, events);
		const sink = recordingSink(events, { writeFailure: failure });
		const frameSource = source();
		await assert.rejects(encodeVideoKeyframeVideoToSink(fake.port, {
			frameSource,
			producer: producer(frameSource),
			format: 'mp4',
		}, sink.value, { createJobToken: () => TOKEN }), (error: unknown) => flatten(error).includes(failure));
		assert.equal(sink.abortCalls(), 1);
		assert.equal(events.includes('delete-output'), true);
		assert.equal(events.at(-1), 'lease-end');
	});

	await context.test('delete failure after close', async () => {
		const events: string[] = [];
		const failure = new Error('MEMFS delete failed');
		const fake = sinkFfmpeg(MP4, events, { deleteFailure: failure });
		const sink = recordingSink(events);
		const frameSource = source();
		await assert.rejects(encodeVideoKeyframeVideoToSink(fake.port, {
			frameSource,
			producer: producer(frameSource),
			format: 'mp4',
		}, sink.value, { createJobToken: () => TOKEN }), (error: unknown) => flatten(error).includes(failure));
		assert.equal(sink.abortCalls(), 1);
		assert.equal(events.includes('terminate-execution'), true);
		assert.ok(events.indexOf('delete-output') < events.indexOf('lease-end'));
		assert.ok(events.indexOf('lease-end') < events.indexOf('abort-sink'));
	});
});

test('hostile sink accessors are rejected before producer or FFmpeg ownership', async () => {
	let getterCalls = 0;
	const hostile = Object.create(null) as Record<string, unknown>;
	for (const key of ['open', 'write', 'close', 'abort']) {
		Object.defineProperty(hostile, key, {
			enumerable: true,
			get() { getterCalls += 1; return () => undefined; },
		});
	}
	const events: string[] = [];
	const fake = sinkFfmpeg(MP4, events);
	const frameSource = source();
	let disposals = 0;
	await assert.rejects(encodeVideoKeyframeVideoToSink(fake.port, {
		frameSource,
		producer: producer(frameSource, () => { disposals += 1; }),
		format: 'mp4',
	}, hostile as never, { createJobToken: () => TOKEN }), /sink\.open.*data property/u);
	assert.equal(getterCalls, 0);
	assert.equal(disposals, 0);
	assert.equal(fake.runCalls(), 0);
});

test('malformed and truncated direct containers never open or write the destination', async () => {
	for (const bytes of [
		Uint8Array.of(1, 2, 3, 4),
		MP4.slice(0, MP4.byteLength - 1),
	]) {
		const events: string[] = [];
		const fake = sinkFfmpeg(bytes, events);
		const sink = recordingSink(events);
		const frameSource = source();
		await assert.rejects(encodeVideoKeyframeVideoToSink(fake.port, {
			frameSource,
			producer: producer(frameSource),
			format: 'mp4',
		}, sink.value, { createJobToken: () => TOKEN }), /finite MP4 container/u);
		assert.equal(events.includes('open-sink'), false);
		assert.equal(events.includes('write-sink'), false);
		assert.equal(sink.abortCalls(), 1);
		assert.equal(events.includes('delete-output'), true);
	}
});

test('direct output caps reject the stat before container ranges or destination publication', async () => {
	const events: string[] = [];
	const fake = sinkFfmpeg(MP4, events);
	const sink = recordingSink(events);
	const frameSource = source();
	await assert.rejects(encodeVideoKeyframeVideoToSink(fake.port, {
		frameSource,
		producer: producer(frameSource),
		format: 'mp4',
		maximumOutputBytes: MP4.byteLength - 1,
	}, sink.value, { createJobToken: () => TOKEN }), /output.*1 through/u);
	assert.equal(events.includes('read-output'), false);
	assert.equal(events.includes('open-sink'), false);
	assert.equal(events.includes('write-sink'), false);
	assert.equal(sink.abortCalls(), 1);
});

test('same-size output replacement cannot close after bounded lower-cap delivery writes', async () => {
	const events: string[] = [];
	const replacement = MP4.slice();
	replacement[replacement.byteLength - 1] ^= 0xff;
	const fake = sinkFfmpeg(MP4, events, { replacementAfterValidation: replacement });
	const sink = recordingSink(events);
	const frameSource = source();
	await assert.rejects(encodeVideoKeyframeVideoToSink(fake.port, {
		frameSource,
		producer: producer(frameSource),
		format: 'mp4',
		maximumOutputBytes: MP4.byteLength,
		maximumOutputChunkBytes: 5,
	}, sink.value, { createJobToken: () => TOKEN }), /bytes changed after container validation/u);
	assert.equal(events.includes('open-sink'), true);
	assert.equal(events.includes('write-sink'), true);
	assert.equal(events.includes('close-sink'), false);
	assert.equal(sink.abortCalls(), 1);
	assert.equal(fake.rangeSizes().slice(-Math.ceil(MP4.byteLength / 5)).every((size) => size <= 5), true);
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

function producer(frameSource: VideoKeyframeExportFrameSource, dispose = () => undefined) {
	return Object.freeze({
		width: frameSource.canvas.width,
		height: frameSource.canvas.height,
		byteLength: frameSource.canvas.width * frameSource.canvas.height * 4,
		produce(_frame: unknown, target: Uint8Array) { target.fill(1); },
		dispose,
	});
}

interface FfmpegOptions {
	readonly deleteFailure?: Error;
	readonly replacementAfterValidation?: Uint8Array;
}

function sinkFfmpeg(encoded: Uint8Array, events: string[], options: FfmpegOptions = {}) {
	let runs = 0;
	let resolveExecution: ((code: number) => void) | null = null;
	let terminated = false;
	let statCalls = 0;
	const rangeSizes: number[] = [];
	const port: VideoKeyframeVideoEditorFfmpeg = Object.freeze({
		async runVideoKeyframeEncoderOperation<Output>(
			operation: (lease: VideoKeyframeEncoderOperationLease) => PromiseLike<Output> | Output,
		): Promise<Output> {
			runs += 1;
			events.push('lease-start');
			const lease: VideoKeyframeEncoderOperationLease = Object.freeze({
				async createInputStream(path: string, capacityBytes = 1024 * 1024) {
					return Object.freeze({
						path,
						capacityBytes,
						async write() {},
						async close() { resolveExecution?.(0); },
						abort() {},
						async dispose() {},
					});
				},
				exec() { return new Promise<number>((resolve) => { resolveExecution = resolve; }); },
				terminateExecution() { terminated = true; events.push('terminate-execution'); },
				isExecutionTerminated() { return terminated; },
				async statFile() {
					statCalls += 1;
					events.push('stat-output');
					return { size: statCalls > 1 && options.replacementAfterValidation
						? options.replacementAfterValidation.byteLength : encoded.byteLength };
				},
				async readFileRange(_path: string, offset: number, maximumBytes: number) {
					events.push('read-output');
					rangeSizes.push(maximumBytes);
					const bytes = statCalls > 1 && options.replacementAfterValidation
						? options.replacementAfterValidation : encoded;
					return bytes.slice(offset, offset + maximumBytes);
				},
				async deleteFile() {
					events.push('delete-output');
					if (options.deleteFailure) throw options.deleteFailure;
				},
			});
			try { return await operation(lease); } finally { events.push('lease-end'); }
		},
	});
	return Object.freeze({ port, rangeSizes: () => [...rangeSizes], runCalls: () => runs });
}

function recordingSink(events: string[], options: Readonly<{ writeFailure?: Error }> = {}) {
	let abortCalls = 0;
	const bytes: number[] = [];
	const value: FfmpegOutputSink<typeof DESTINATION> = Object.freeze({
		async open() { events.push('open-sink'); },
		async write(chunk: Uint8Array) {
			events.push('write-sink');
			if (options.writeFailure) throw options.writeFailure;
			bytes.push(...chunk);
		},
		async close() { events.push('close-sink'); return DESTINATION; },
		async abort() { abortCalls += 1; events.push('abort-sink'); },
	});
	return Object.freeze({ value, bytes: () => [...bytes], abortCalls: () => abortCalls });
}

function flatten(error: unknown): unknown[] {
	return error instanceof AggregateError
		? [error, ...error.errors.flatMap((item: unknown) => flatten(item))]
		: [error];
}
