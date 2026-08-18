/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveVideoWebCodecsCodec,
	resolveVideoWebCodecsSupport,
} from '../src/common/editor/video-webcodecs-capability.ts';

const RATE_30 = { num: 30, den: 1 };
const RATE_2997 = { num: 30_000, den: 1_001 };

test('the level chosen is the smallest that admits the picture and the rate', () => {
	// The levels these canvases are known by: 720p30 is 3.1, 1080p30 is 4.0.
	assert.equal(codec('h264', 1_280, 720, RATE_30), 'avc1.4d001f');
	assert.equal(codec('h264', 1_920, 1_080, RATE_30), 'avc1.4d0028');
	assert.equal(codec('vp9', 1_280, 720, RATE_30), 'vp09.00.31.08');
	assert.equal(codec('vp9', 1_920, 1_080, RATE_30), 'vp09.00.40.08');
});

test('a vertical delivery gets the level its pixel count earns, not its width', () => {
	assert.equal(
		codec('h264', 1_080, 1_920, RATE_30),
		codec('h264', 1_920, 1_080, RATE_30),
		'the same picture turned on its side is the same macroblock count',
	);
});

test('rate moves the level even when the picture does not', () => {
	// 1080p120 needs 979,200 macroblocks a second, past 5.0's 589,824.
	assert.equal(codec('h264', 1_920, 1_080, { num: 120, den: 1 }), 'avc1.4d0033');
	// 29.97 is below 30, so the exact rational must not round up into a level.
	assert.equal(codec('h264', 1_280, 720, RATE_2997), 'avc1.4d001f');
});

test('a delivery past every level is refused here, with a reason, not at an encoder', async () => {
	assert.equal(codec('h264', 16_384, 16_384, RATE_30), null);
	const support = await resolveVideoWebCodecsSupport(
		'h264',
		{ width: 16_384, height: 16_384, frameRate: RATE_30 },
		{ isConfigSupported: async () => ({ supported: true }) },
	);
	assert.equal(support.tier, 'ffmpeg');
	assert.match(support.reason!, /No h264 level admits a 16384x16384 delivery/u);
});

test('a browser without the API falls back rather than failing', async () => {
	const support = await resolveVideoWebCodecsSupport('h264', canvas(), undefined);

	assert.deepEqual({ ...support }, {
		tier: 'ffmpeg',
		codec: null,
		reason: 'This browser has no WebCodecs video encoder.',
	});
});

test('a browser with the API but not the codec falls back, and says which codec', async () => {
	const support = await resolveVideoWebCodecsSupport('vp9', canvas(), {
		isConfigSupported: async () => ({ supported: false }),
	});

	assert.equal(support.tier, 'ffmpeg');
	assert.match(support.reason!, /does not encode vp09\.00\.31\.08/u);
});

test('a probe that throws is a fallback carrying what it said', async () => {
	const support = await resolveVideoWebCodecsSupport('h264', canvas(), {
		isConfigSupported: () => Promise.reject(new TypeError('bad config')),
	});

	assert.equal(support.tier, 'ffmpeg');
	assert.match(support.reason!, /refused the avc1\.4d001f configuration: bad config/u);
});

test('a supported configuration selects the tier and states the codec it probed', async () => {
	const probes: Record<string, unknown>[] = [];
	const support = await resolveVideoWebCodecsSupport('h264', canvas(), {
		isConfigSupported: async (config) => { probes.push(config); return { supported: true }; },
	});

	assert.deepEqual({ ...support }, { tier: 'webcodecs', codec: 'avc1.4d001f', reason: null });
	// Annex B is what the elementary-stream remux reads; a description-bearing
	// variant would mux into a file no demuxer could open.
	assert.deepEqual(probes[0]!.avc, { format: 'annexb' });
	assert.equal(probes[0]!.width, 1_280);
	assert.equal(probes[0]!.framerate, 30);
});

test('VP9 is probed without an H.264 bitstream-format option it has no meaning for', async () => {
	const probes: Record<string, unknown>[] = [];
	await resolveVideoWebCodecsSupport('vp9', canvas(), {
		isConfigSupported: async (config) => { probes.push(config); return { supported: true }; },
	});

	assert.equal(Object.hasOwn(probes[0]!, 'avc'), false);
});

function codec(videoCodec: string, width: number, height: number, frameRate: { num: number; den: number }) {
	return resolveVideoWebCodecsCodec(videoCodec, { width, height, frameRate });
}

function canvas() {
	return { width: 1_280, height: 720, frameRate: RATE_30 };
}
