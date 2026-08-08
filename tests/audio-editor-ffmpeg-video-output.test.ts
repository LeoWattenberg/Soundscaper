/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { createEditorFfmpeg } from '../src/common/editor/ffmpeg.js';
import {
	encodeFfmpegVideoBytes,
	encodeFfmpegVideoToSink,
	type FfmpegVideoJobInstance,
} from '../src/common/editor/ffmpeg-video-output.ts';

interface TestSinkOutput {
	readonly sealed: true;
}

test('editor FFmpeg exposes the extracted video sink route', () => {
	const ffmpeg = createEditorFfmpeg({ idleTimeoutMs: false });
	assert.equal(typeof ffmpeg.encodeVideoToSink, 'function');
	ffmpeg.dispose();
});

test('FFmpeg video sink output streams exact MP4 and WebM ranges without a whole-file read', async () => {
	for (const fixture of [
		{ format: 'mp4' as const, plan: silentMp4Plan(), video: new Map<string, Blob>(), audio: null },
		{
			format: 'webm' as const,
			plan: webmPlan(),
			video: new Map([
				['source-a', new Blob([Uint8Array.of(1)], { type: 'video/mp4' })],
				['source-b', new Blob([Uint8Array.of(2)], { type: 'video/webm' })],
			]),
			audio: new Blob([Uint8Array.of(3)], { type: 'audio/wav' }),
		},
	]) {
		const bytes = patternedBytes(2 * 1024 * 1024 + 17);
		const runtime = new VideoJobRuntime(bytes);
		const sink = new RecordingSink();
		let currentnessChecks = 0;
		const result = await encodeFfmpegVideoToSink({
			videoBlobsBySourceId: fixture.video,
			audioMix: fixture.audio,
			plan: fixture.plan,
			sink,
			settings: { assertCurrent() { currentnessChecks += 1; } },
			...runtime.options(),
		});

		assert.equal(result.output, sink.output);
		assert.equal(result.byteLength, bytes.byteLength);
		assert.equal(result.chunkCount, 3);
		assert.equal(result.extension, `.${fixture.format}`);
		assert.equal(result.mimeType, `video/${fixture.format}`);
		assert.deepEqual(sink.events, [
			`open:${bytes.byteLength}`,
			`write:${1024 * 1024}`,
			`write:${1024 * 1024}`,
			'write:17',
			'close',
		]);
		assert.equal(runtime.instance.readFileCalls, 0);
		assert.equal(runtime.instance.statFileCalls, 1);
		assert.deepEqual(runtime.instance.rangeRequests.map(({ offset, maximumBytes }) => (
			[offset, maximumBytes]
		)), [
			[0, 1024 * 1024],
			[1024 * 1024, 1024 * 1024],
			[2 * 1024 * 1024, 17],
		]);
		assert.equal(currentnessChecks > 0, true);
		assert.match(runtime.instance.lastExec.at(-1) ?? '', new RegExp(`\\.${fixture.format}$`, 'u'));
		assert.deepEqual(runtime.instance.deletedFiles, [runtime.instance.lastExec.at(-1)]);
		if (fixture.format === 'webm') {
			assert.equal(runtime.instance.mounts.length, 1);
			assert.equal(runtime.instance.mounts[0]?.fsType, 'WORKERFS');
			assert.deepEqual(
				runtime.instance.mounts[0]?.options.blobs.map(({ name }) => name),
				['video-000.mp4', 'video-001.webm', 'audio-002.wav'],
			);
			assert.equal(runtime.instance.unmounted.length, 1);
			assert.equal(runtime.instance.deletedDirectories.length, 1);
		} else {
			assert.deepEqual(runtime.instance.mounts, []);
		}
	}
});

test('legacy FFmpeg video bytes preserve whole-read results and best-effort cleanup', async () => {
	const runtime = new VideoJobRuntime(Uint8Array.of(9, 8, 7));
	runtime.instance.outputDeleteFailure = new Error('legacy delete failed');
	const result = await encodeFfmpegVideoBytes({
		videoBlobsBySourceId: new Map(),
		audioMix: null,
		plan: silentMp4Plan(),
		settings: {},
		...runtime.options(),
	});

	assert.deepEqual([...result.bytes], [9, 8, 7]);
	assert.equal(result.extension, '.mp4');
	assert.equal(result.mimeType, 'video/mp4');
	assert.equal(runtime.instance.readFileCalls, 1);
	assert.equal(runtime.instance.statFileCalls, 1);
	assert.equal(runtime.terminateCalls, 0);
});

test('legacy FFmpeg video bytes refuse oversized output before whole-file reads', async () => {
	const runtime = new VideoJobRuntime(Uint8Array.of(9, 8, 7));
	await assert.rejects(
		encodeFfmpegVideoBytes({
			videoBlobsBySourceId: new Map(),
			audioMix: null,
			plan: silentMp4Plan(),
			settings: { maximumOutputBytes: 2 },
			...runtime.options(),
		}),
		/Video export.*maximum is 2 bytes/u,
	);
	assert.equal(runtime.instance.statFileCalls, 1);
	assert.equal(runtime.instance.readFileCalls, 0);
});

test('FFmpeg video sink output aborts once for encoding and streaming failures', async () => {
	const encoding = new VideoJobRuntime(Uint8Array.of(1));
	encoding.instance.execCode = 7;
	const encodingSink = new RecordingSink();
	await assert.rejects(
		encodeFfmpegVideoToSink({
			videoBlobsBySourceId: new Map(), audioMix: null, plan: silentMp4Plan(),
			sink: encodingSink, settings: {}, ...encoding.options(),
		}),
		/video encoding failed:mp4:7/u,
	);
	assert.equal(encodingSink.abortReasons.length, 1);
	assert.equal(encoding.instance.statFileCalls, 0);

	const primary = new Error('range failed');
	const cleanup = new Error('output delete failed');
	const streaming = new VideoJobRuntime(Uint8Array.of(1, 2));
	streaming.instance.rangeFailure = primary;
	streaming.instance.outputDeleteFailure = cleanup;
	const streamingSink = new RecordingSink();
	let caught: unknown;
	try {
		await encodeFfmpegVideoToSink({
			videoBlobsBySourceId: new Map(), audioMix: null, plan: silentMp4Plan(),
			sink: streamingSink, settings: {}, ...streaming.options(),
		});
	} catch (error) { caught = error; }
	assert.ok(caught instanceof AggregateError);
	assert.deepEqual(caught.errors, [primary, cleanup]);
	assert.deepEqual(streamingSink.abortReasons, [primary]);
	assert.equal(streaming.terminateCalls, 1);
});

test('FFmpeg video sink output uses cancellation as primary and aborts before late work', async () => {
	const controller = new AbortController();
	const reason = new Error('video export cancelled');
	const runtime = new VideoJobRuntime(Uint8Array.of(1, 2, 3));
	runtime.instance.onExec = () => {
		controller.abort(reason);
		throw reason;
	};
	const sink = new RecordingSink();
	await assert.rejects(
		encodeFfmpegVideoToSink({
			videoBlobsBySourceId: new Map(), audioMix: null, plan: silentMp4Plan(),
			sink, settings: { signal: controller.signal }, ...runtime.options(),
		}),
		(error) => error === reason,
	);
	assert.deepEqual(sink.abortReasons, [reason]);
	assert.equal(runtime.terminateCalls, 1);
	assert.equal(runtime.instance.statFileCalls, 0);

	const stale = new VideoJobRuntime(Uint8Array.of(1));
	const staleSink = new RecordingSink();
	const staleError = new Error('stale video export');
	await assert.rejects(
		encodeFfmpegVideoToSink({
			videoBlobsBySourceId: new Map(), audioMix: null, plan: silentMp4Plan(),
			sink: staleSink,
			settings: { assertCurrent() { throw staleError; } },
			...stale.options(),
		}),
		(error) => error === staleError,
	);
	assert.deepEqual(staleSink.abortReasons, [staleError]);
	assert.equal(stale.runCalls, 0);
});

class RecordingSink implements FfmpegOutputSink<TestSinkOutput> {
	readonly abortReasons: unknown[] = [];
	readonly events: string[] = [];
	readonly output = Object.freeze({ sealed: true as const });

	async open(exactByteLength: number): Promise<void> { this.events.push(`open:${exactByteLength}`); }
	async write(chunk: Uint8Array): Promise<void> { this.events.push(`write:${chunk.byteLength}`); }
	async close(): Promise<TestSinkOutput> { this.events.push('close'); return this.output; }
	async abort(reason?: unknown): Promise<void> { this.abortReasons.push(reason); }
}

class VideoJobRuntime {
	readonly instance: MockVideoInstance;
	runCalls = 0;
	terminateCalls = 0;
	terminated = false;

	constructor(outputBytes: Uint8Array) {
		this.instance = new MockVideoInstance(outputBytes);
	}

	options() {
		return {
			run: async <Value>(task: (instance: FfmpegVideoJobInstance) => Promise<Value>) => {
				this.runCalls += 1;
				return task(this.instance);
			},
			workerFsType: () => 'WORKERFS',
			terminateRuntime: () => { this.terminateCalls += 1; this.terminated = true; },
			isRuntimeTerminated: () => this.terminated,
			createEncodingError: (format: string, code: number) => new Error(`video encoding failed:${format}:${code}`),
		};
	}
}

class MockVideoInstance implements FfmpegVideoJobInstance {
	readonly deletedDirectories: string[] = [];
	readonly deletedFiles: string[] = [];
	readonly mounts: Array<{
		fsType: unknown;
		options: { blobs: Array<{ name: string; data: Blob }> };
		mountPoint: string;
	}> = [];
	readonly rangeRequests: Array<{ path: string; offset: number; maximumBytes: number }> = [];
	readonly unmounted: string[] = [];
	execCode = 0;
	lastExec: string[] = [];
	onExec: (() => void) | null = null;
	outputDeleteFailure: Error | null = null;
	rangeFailure: Error | null = null;
	readFileCalls = 0;
	statFileCalls = 0;

	constructor(readonly outputBytes: Uint8Array) {}

	async createDir(): Promise<void> {}
	async mount(fsType: unknown, options: { blobs: Array<{ name: string; data: Blob }> }, mountPoint: string): Promise<void> {
		this.mounts.push({ fsType, options, mountPoint });
	}
	async exec(args: string[]): Promise<number> {
		this.lastExec = [...args];
		this.onExec?.();
		return this.execCode;
	}
	async readFile(): Promise<Uint8Array> { this.readFileCalls += 1; return this.outputBytes; }
	async statFile(): Promise<{ size: number }> { this.statFileCalls += 1; return { size: this.outputBytes.byteLength }; }
	async readFileRange(path: string, offset: number, maximumBytes: number): Promise<Uint8Array> {
		this.rangeRequests.push({ path, offset, maximumBytes });
		if (this.rangeFailure) throw this.rangeFailure;
		return this.outputBytes.slice(offset, offset + maximumBytes);
	}
	async deleteFile(path: string): Promise<void> {
		this.deletedFiles.push(path);
		if (this.outputDeleteFailure && path === this.lastExec.at(-1)) throw this.outputDeleteFailure;
	}
	async unmount(path: string): Promise<void> { this.unmounted.push(path); }
	async deleteDir(path: string): Promise<void> { this.deletedDirectories.push(path); }
}

function patternedBytes(byteLength: number): Uint8Array {
	const bytes = new Uint8Array(byteLength);
	for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = index & 0xff;
	return bytes;
}

function silentMp4Plan() {
	return {
		version: 1,
		format: 'mp4',
		container: 'mp4', extension: 'mp4', mimeType: 'video/mp4', durationSeconds: 5,
		canvas: { width: 1280, height: 720, frameRate: 30, pixelFormat: 'yuv420p', backgroundColor: 'black' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p',
		},
		inputs: [],
		segments: [{ kind: 'black', color: 'black', durationSeconds: 5 }],
		filterPlan: { audio: { strategy: 'none' } },
	};
}

function webmPlan() {
	return {
		version: 1,
		format: 'webm',
		container: 'webm', extension: 'webm', mimeType: 'video/webm', durationSeconds: 2,
		canvas: { width: 640, height: 360, frameRate: 24, pixelFormat: 'yuv420p', backgroundColor: 'black' },
		codecs: {
			video: 'vp9', videoEncoder: 'libvpx-vp9', audio: 'opus', audioEncoder: 'libopus', pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: 'source-a', mimeType: 'video/mp4' },
			{ kind: 'video-source', inputIndex: 1, sourceId: 'source-b', mimeType: 'video/webm' },
			{ kind: 'staged-audio-mix', inputIndex: 2, fileName: 'audio-mix.wav' },
		],
		segments: [
			{
				kind: 'video', inputIndex: 0, sourceId: 'source-a', sourceStartTimeSeconds: 0,
				sourceEndTimeSeconds: 1, playbackRate: 1, durationSeconds: 1,
			},
			{
				kind: 'video', inputIndex: 1, sourceId: 'source-b', sourceStartTimeSeconds: 0,
				sourceEndTimeSeconds: 1, playbackRate: 1, durationSeconds: 1,
			},
		],
		filterPlan: { audio: { strategy: 'staged-mix', inputIndex: 2 } },
	};
}
