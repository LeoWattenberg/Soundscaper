/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopExternalFfmpegVideoCapabilities,
	createDesktopExternalFfmpegVideoWorkload,
	normalizeDesktopVideoCodecOperationPlan,
} from '../desktop/desktop-video-codec-operation-contract.ts';
import { guardExternalFfmpegVideoArguments } from '../desktop/external-ffmpeg-video-process.ts';

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
	assert.deepEqual(ffmpegArguments, [
		'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
		'-video_size', '2x2', '-framerate', '1/1', '-i', 'pipe:3',
		'-i', 'pipe:4', '-filter:a', 'apad=whole_len=96256',
		'-map', '0:v:0', '-map', '1:a:0',
		'-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
		'-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
		'-pix_fmt', 'yuv420p', '-r', '1/1',
		'-c:a', 'aac', '-b:a', '192k',
		'-movflags', '+faststart', '-f', 'mp4',
		'-t', '2.000000000', '/private/session/output.mp4',
	]);
});

test('desktop external video accepts file sizes beyond the former 2 GiB cap', () => {
	const plan = normalizeDesktopVideoCodecOperationPlan({ ...PLAN,
		audioInputBytes: 3 * 1024 ** 3, maximumOutputBytes: Number.MAX_SAFE_INTEGER });
	assert.equal(plan.audioInputBytes, 3 * 1024 ** 3);
	assert.equal(plan.maximumOutputBytes, Number.MAX_SAFE_INTEGER);
	const { ffmpegArguments } = createDesktopExternalFfmpegVideoWorkload(plan, { outputPath: '/private/output.mp4' });
	assert.equal(guardExternalFfmpegVideoArguments(ffmpegArguments, Number.MAX_SAFE_INTEGER).includes('-fs'), false);
	const bounded = guardExternalFfmpegVideoArguments(ffmpegArguments, 1024);
	assert.equal(bounded[bounded.indexOf('-fs') + 1], '1024');
	for (const maximumOutputBytes of [0, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => normalizeDesktopVideoCodecOperationPlan({ ...PLAN, maximumOutputBytes }), /output bytes/u);
	}
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
