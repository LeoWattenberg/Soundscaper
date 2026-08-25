/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopExternalFfmpegVideoCapabilities,
	createDesktopExternalFfmpegVideoWorkload,
	normalizeDesktopVideoCodecOperationPlan,
} from '../desktop/desktop-video-codec-operation-contract.ts';

const PLAN = Object.freeze({
	schemaVersion: 1 as const,
	format: 'mp4' as const,
	quality: 'balanced' as const,
	width: 2,
	height: 2,
	frameRate: Object.freeze({ num: 1, den: 1 }),
	frameCount: 2,
	sampleRate: 48_000,
	durationFrames: 96_000,
	videoInputBytes: 32,
	audioInputBytes: 128,
	ringCapacityBytes: 4_096,
	audioRingCapacityBytes: 4_096,
	maximumOutputBytes: 1024 * 1024,
});

test('desktop video plan is a closed scalar DTO with derived byte authority', () => {
	assert.deepEqual(normalizeDesktopVideoCodecOperationPlan(PLAN), PLAN);
	assert.throws(
		() => normalizeDesktopVideoCodecOperationPlan({ ...PLAN, videoInputBytes: 31 }),
		/derived video input byte count/u,
	);
	assert.throws(
		() => normalizeDesktopVideoCodecOperationPlan({ ...PLAN, executablePath: '/tmp/ffmpeg' }),
		/unsupported field/u,
	);
	assert.throws(
		() => normalizeDesktopVideoCodecOperationPlan({ ...PLAN, arguments: ['-i', 'anything'] }),
		/unsupported field/u,
	);
});

test('main reconstructs fixed H264/AAC argv with private pipes and output', () => {
	const { workload, ffmpegArguments } = createDesktopExternalFfmpegVideoWorkload(PLAN, {
		outputPath: '/private/session/output.mp4',
	});
	assert.equal(workload.videoEncoder, 'ffmpeg');
	assert.equal(workload.frameCount, 2);
	assert.equal(workload.totalRgbaBytes, 32);
	assert.deepEqual(ffmpegArguments.slice(0, 12), [
		'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
		'-video_size', '2x2', '-framerate', '1/1', '-i', 'pipe:3',
	]);
	assert.ok(ffmpegArguments.includes('libx264'));
	assert.ok(ffmpegArguments.includes('aac'));
	assert.ok(ffmpegArguments.includes('pipe:4'));
	assert.equal(ffmpegArguments.at(-1), '/private/session/output.mp4');
});

test('desktop video capabilities require the full fixed A/V plan capability set', () => {
	const admission = (encoders: readonly string[], muxers: readonly string[]) => ({
		capabilities: {
			encoders, muxers,
			decoders: ['rawvideo', 'pcm_f32le'],
			demuxers: ['rawvideo', 'wav'],
			filters: ['apad'],
		},
	});
	const both = createDesktopExternalFfmpegVideoCapabilities(admission(
		['libx264', 'aac', 'libvpx-vp9', 'libopus'], ['mp4', 'webm'],
	));
	assert.deepEqual(both.formats, {
		mp4: { available: true, provider: 'external-ffmpeg', reason: null },
		webm: { available: true, provider: 'external-ffmpeg', reason: null },
	});

	const partial = createDesktopExternalFfmpegVideoCapabilities(admission(
		['libx264', 'aac', 'libvpx-vp9'], ['mp4', 'webm'],
	));
	assert.equal(partial.formats.mp4.available, true);
	assert.equal(partial.formats.webm.available, false);
	assert.equal(partial.formats.webm.provider, null);
	assert.match(partial.formats.webm.reason ?? '', /VP9\/Opus WebM/u);
	const missingInput = createDesktopExternalFfmpegVideoCapabilities({
		capabilities: {
			encoders: ['libx264', 'aac'], decoders: ['rawvideo'], muxers: ['mp4'],
			demuxers: ['rawvideo', 'wav'], filters: ['apad'],
		},
	});
	assert.equal(missingInput.formats.mp4.available, false);

	const absent = createDesktopExternalFfmpegVideoCapabilities(null);
	assert.equal(absent.formats.mp4.available, false);
	assert.match(absent.formats.mp4.reason ?? '', /Preferences > General/u);
});
