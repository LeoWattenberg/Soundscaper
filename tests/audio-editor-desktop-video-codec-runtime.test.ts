/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopVideoCodecOperationRunner } from '../src/common/editor/desktop-video-codec-runtime.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

const TOKEN = '0123456789abcdef0123456789abcdef';
const MP4 = Uint8Array.of(
	0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
	0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
);

test('desktop video adapter drives the existing bounded encoder and validates output before return', async () => {
	const input: number[] = [];
	let closeInput!: () => void;
	const closed = new Promise<void>((resolve) => { closeInput = resolve; });
	const calls: string[] = [];
	const bridge = {
		begin(plan: unknown) {
			assert.equal((plan as { format?: unknown }).format, 'mp4');
			calls.push('begin');
			return { operationId: `desktop-video-${'1'.repeat(32)}` };
		},
		write(request: { offset: number; bytes: Uint8Array }) {
			assert.equal(request.offset, input.length);
			input.push(...request.bytes);
			calls.push('write');
			return { offset: input.length };
		},
		close(request: { offset: number }) {
			assert.equal(request.offset, input.length);
			calls.push('close'); closeInput(); return { offset: input.length };
		},
		async execute() { calls.push('execute'); await closed; return { exitCode: 0 }; },
		stat() { calls.push('stat'); return { byteLength: MP4.byteLength }; },
		read(request: { offset: number; maximumBytes: number }) {
			calls.push('read');
			return MP4.slice(request.offset, request.offset + request.maximumBytes);
		},
		delete() { calls.push('delete'); return true; },
		cancel() { calls.push('cancel'); return false; },
	};
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: 48_000, startFrame: 0, endFrame: 48_000,
		canvas: { width: 2, height: 2, frameRate: { num: 1, den: 1 } },
	});
	let disposed = 0;
	const result = await encodeVideoKeyframeVideo(
		{ runVideoKeyframeEncoderOperation: createDesktopVideoCodecOperationRunner(bridge) },
		{
			frameSource,
			producer: {
				width: 2, height: 2, byteLength: 16,
				produce(_frame, target) { target.fill(7); },
				dispose() { disposed += 1; },
			},
			format: 'mp4', maximumOutputChunkBytes: 8,
		},
		{ createJobToken: () => TOKEN },
	);
	assert.deepEqual(result.bytes, MP4);
	assert.deepEqual(input, new Array(16).fill(7));
	assert.equal(disposed, 1);
	assert.deepEqual(calls.slice(0, 4), ['begin', 'execute', 'write', 'close']);
	assert.ok(calls.includes('stat'));
	assert.ok(calls.includes('read'));
	assert.equal(calls.at(-2), 'delete');
});

test('desktop video adapter exact-checks renderer-local paths and argv before bridge execution', async () => {
	let begins = 0;
	const runner = createDesktopVideoCodecOperationRunner({
		begin() { begins += 1; return { operationId: `desktop-video-${'2'.repeat(32)}` }; },
		write() { throw new Error('unused'); }, close() { throw new Error('unused'); },
		execute() { throw new Error('unused'); }, stat() { throw new Error('unused'); },
		read() { throw new Error('unused'); }, delete() { throw new Error('unused'); }, cancel() { return true; },
	});
	await assert.rejects(
		() => runner(async (lease) => lease.exec(['-i', '/renderer/chosen'], -1), {
			desktopExternalFfmpeg: {
				plan: plan(), videoInputPath: '/logical/input.rgba', outputPath: '/logical/output.mp4',
				ffmpegArguments: ['-fixed', '/logical/output.mp4'],
			},
		}),
		/exact admitted command/u,
	);
	assert.equal(begins, 1);
});

test('desktop video adapter splits multi-megabyte video and audio ring writes into bounded IPC chunks', async () => {
	const writes: Array<Readonly<{ role: string; offset: number; byteLength: number }>> = [];
	const offsets = { video: 0, audio: 0 };
	const operationId = `desktop-video-${'3'.repeat(32)}`;
	const runner = createDesktopVideoCodecOperationRunner({
		begin() { return { operationId }; },
		write(request: { role: 'video' | 'audio'; offset: number; bytes: Uint8Array }) {
			assert.equal(request.offset, offsets[request.role]);
			offsets[request.role] += request.bytes.byteLength;
			writes.push({ role: request.role, offset: request.offset, byteLength: request.bytes.byteLength });
			return { offset: offsets[request.role] };
		},
		close(request: { role: 'video' | 'audio'; offset: number }) {
			assert.equal(request.offset, offsets[request.role]); return { offset: request.offset };
		},
		execute() { throw new Error('unused'); }, stat() { throw new Error('unused'); },
		read() { throw new Error('unused'); }, delete() { throw new Error('unused'); }, cancel() { return true; },
	});
	const capacity = 2 * 1024 * 1024;
	await runner(async (lease) => {
		const video = await lease.createInputStream('/logical/input.rgba', capacity);
		const audio = await lease.createInputStream('/logical/input.wav', capacity);
		await video.write(new Uint8Array(capacity));
		await audio.write(new Uint8Array(capacity));
		await video.close();
		await audio.close();
		await video.dispose();
		await audio.dispose();
	}, {
		desktopExternalFfmpeg: {
			plan: {
				schemaVersion: 1, format: 'mp4', quality: 'balanced', width: 1024, height: 512,
				frameRate: { num: 1, den: 1 }, frameCount: 1, sampleRate: 48_000,
				durationFrames: 48_000, videoInputBytes: capacity, audioInputBytes: capacity,
				ringCapacityBytes: capacity, audioRingCapacityBytes: capacity,
				maximumOutputBytes: 1024 * 1024,
			},
			videoInputPath: '/logical/input.rgba', audioInputPath: '/logical/input.wav',
			outputPath: '/logical/output.mp4', ffmpegArguments: ['fixed'],
		},
	});
	assert.equal(writes.length, 4);
	assert.ok(writes.every(({ byteLength }) => byteLength === 1024 * 1024));
	assert.deepEqual(writes.map(({ role, offset }) => [role, offset]), [
		['video', 0], ['video', 1024 * 1024], ['audio', 0], ['audio', 1024 * 1024],
	]);
});

function plan() {
	return {
		schemaVersion: 1 as const, format: 'mp4' as const, quality: 'balanced' as const,
		width: 2, height: 2, frameRate: { num: 1, den: 1 }, frameCount: 1,
		sampleRate: 48_000, durationFrames: 48_000, videoInputBytes: 16,
		audioInputBytes: null, ringCapacityBytes: 4_096, audioRingCapacityBytes: null,
		maximumOutputBytes: 1024,
	};
}
