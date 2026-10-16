/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import { createDesktopExternalFfmpegVideoCapabilities } from '../desktop/desktop-video-codec-operation-contract.ts';
import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import {
	createExternalFfmpegVideoOperationService,
	type ExternalFfmpegVideoChildProcess,
	type ExternalFfmpegVideoSpawn,
} from '../desktop/external-ffmpeg-video-operation-service.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const PLAN = Object.freeze({
	schemaVersion: 1, format: 'mp4', quality: 'balanced',
	width: 2, height: 2, frameRate: { num: 1, den: 1 }, frameCount: 2,
	sampleRate: 48_000, durationFrames: 96_000, videoInputBytes: 32,
	audioInputBytes: null, ringCapacityBytes: 4_096, audioRingCapacityBytes: null,
	maximumOutputBytes: 1024 * 1024,
});

test('main sessions bind the cached verified H264 encoder without exposing encoder selection to the renderer', async () => {
	for (const encoder of ['h264_videotoolbox', 'h264_mf', 'libx264'] as const) {
		const root = await mkdtemp(join(tmpdir(), 'soundscaper-native-video-operation-'));
		const admission = externalAdmission();
		const captured: Array<readonly string[]> = [];
		let verifications = 0;
		const spawn: ExternalFfmpegVideoSpawn = (_executable, arguments_) => {
			captured.push(arguments_);
			const stdout = new PassThrough();
			const stderr = new PassThrough();
			const video = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
			const child = Object.assign(new EventEmitter(), {
				pid: 12345, stdout, stderr, stdio: [null, stdout, stderr, video], kill: () => true,
			}) as unknown as ExternalFfmpegVideoChildProcess & EventEmitter;
			video.once('finish', () => {
				void writeFile(String(arguments_.at(-1)), Uint8Array.of(1, 2, 3))
					.then(() => child.emit('close', 0, null));
			});
			return child;
		};
		const service = createExternalFfmpegVideoOperationService({
			productId: 'soundscaper', scratchRoot: root,
			preferences: { admission: () => admission, invalidateAdmission: async () => {
				throw new Error('Identity should stay admitted.');
			} },
			digestExecutable: async (path) => path.endsWith('ffmpeg') ? HASH_A : HASH_B,
			environment: {}, spawn,
			verifyAdmission: async (value) => {
				verifications += 1;
				return { ...createDesktopExternalFfmpegVideoCapabilities(value), h264Encoder: encoder };
			},
		});
		try {
			const capabilities = await service.capabilities();
			assert.deepEqual(Reflect.ownKeys(capabilities), ['schemaVersion', 'formats']);
			const owner = {};
			const { operationId } = await service.begin(owner, PLAN);
			const execution = service.execute(owner, operationId);
			await service.writeInput(owner, { operationId, role: 'video', offset: 0, bytes: new Uint8Array(32) });
			await service.closeInput(owner, { operationId, role: 'video', offset: 32 });
			await execution;
			assert.equal(verifications, 1, 'capability query and begin share the exact admission cache');
			assert.equal(captured.length, 1);
			const arguments_ = captured[0]!;
			assert.equal(arguments_[arguments_.indexOf('-c:v') + 1], encoder);
			assert.ok(arguments_.includes('pipe:3'));
			assert.equal(arguments_.includes('pipe:4'), false);
			assert.equal(arguments_.includes('-crf'), encoder === 'libx264');
			await service.delete(owner, operationId);
			const webm = await service.begin(owner, { ...PLAN, format: 'webm' });
			const webmExecution = service.execute(owner, webm.operationId);
			await service.writeInput(owner, {
				operationId: webm.operationId, role: 'video', offset: 0, bytes: new Uint8Array(32),
			});
			await service.closeInput(owner, { operationId: webm.operationId, role: 'video', offset: 32 });
			await webmExecution;
			const webmArguments = captured[1]!;
			assert.equal(webmArguments[webmArguments.indexOf('-c:v') + 1], 'libvpx-vp9');
			await service.delete(owner, webm.operationId);
		} finally {
			await service.dispose();
			await rm(root, { recursive: true, force: true });
		}
	}
});

function externalAdmission() {
	return Object.freeze({
		executablePath: '/opt/ffmpeg', version: '8.0.0', capabilityGeneration: HASH_A,
		identity: {
			version: '8.0.0', ffmpegSha256: HASH_A, ffprobePath: '/opt/ffprobe', ffprobeSha256: HASH_B,
			executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({
				ffmpegPath: '/opt/ffmpeg', ffmpegSha256: HASH_A,
				ffprobePath: '/opt/ffprobe', ffprobeSha256: HASH_B,
			}),
		},
		capabilities: {
			encoders: ['libx264', 'h264_videotoolbox', 'h264_mf', 'aac', 'libvpx-vp9', 'libopus'], muxers: ['mp4', 'webm'],
			decoders: ['rawvideo', 'pcm_f32le'], demuxers: ['rawvideo', 'wav'], filters: ['apad'],
		},
	});
}
