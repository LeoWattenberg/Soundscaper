/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BrowserVideoEncoderUnavailableError,
	resolveVideoDeliveryEncoderTier,
} from '../src/common/editor/video-delivery-encoder-tier.ts';

const CANVAS = Object.freeze({
	width: 1_920,
	height: 1_080,
	frameRate: Object.freeze({ num: 30_000, den: 1_001 }),
});

test('a qualified browser encodes the keyed delivery and the decision carries no reason', async () => {
	const decision = await withVideoFrame(() => resolveVideoDeliveryEncoderTier({
		format: 'mp4', canvas: CANVAS, quality: 'balanced', eligible: true,
	}, supportingEncoder()));
	assert.equal(decision.tier, 'webcodecs');
	assert.equal(decision.codec, 'avc1.4d0028');
	assert.equal(decision.reason, null);
	// 1920x1080 at 29.97 with H.264's balanced 0.10 bits per pixel.
	assert.equal(decision.bitrate, 6_214_585);
});

test('a composed-graph delivery refuses instead of falling back to browser FFmpeg', async () => {
	await assert.rejects(
		withVideoFrame(() => resolveVideoDeliveryEncoderTier({
			format: 'mp4', canvas: CANVAS, quality: 'balanced', eligible: false,
		}, supportingEncoder())),
		(error: unknown) => error instanceof BrowserVideoEncoderUnavailableError
			&& /browser-native.*keyed/iu.test(error.message),
	);
});

test('an unqualified browser refuses instead of falling back to browser FFmpeg', async () => {
	for (const [encoder, match] of [
		[undefined, /no WebCodecs video encoder/u],
		[{ isConfigSupported: async () => ({ supported: false }) }, /does not encode/u],
		[{ isConfigSupported: () => Promise.reject(new Error('nope')) }, /refused/u],
	] as const) {
		await assert.rejects(
			withVideoFrame(() => resolveVideoDeliveryEncoderTier({
				format: 'webm', canvas: CANVAS, quality: 'draft', eligible: true,
			}, encoder)),
			(error: unknown) => error instanceof BrowserVideoEncoderUnavailableError
				&& match.test(error.message),
		);
	}
});

test('WebCodecs video no longer requires cross-origin isolation for an FFmpeg ring', async () => {
	let probed = false;
	const decision = await withVideoFrame(() => resolveVideoDeliveryEncoderTier({
			format: 'mp4', canvas: CANVAS, quality: 'balanced', eligible: true,
		}, {
			async isConfigSupported() {
				probed = true;
				return { supported: true };
			},
		}));

	assert.equal(probed, true);
	assert.equal(decision.tier, 'webcodecs');
});

test('a browser with an encoder but no frame constructor refuses', async () => {
	await assert.rejects(
		resolveVideoDeliveryEncoderTier({
			format: 'mp4', canvas: CANVAS, quality: 'high', eligible: true,
		}, supportingEncoder()),
		(error: unknown) => error instanceof BrowserVideoEncoderUnavailableError
			&& /video frame/u.test(error.message),
	);
});

test('the WebM delivery is probed and reported as VP9, not as the container', async () => {
	const probes: Readonly<Record<string, unknown>>[] = [];
	const decision = await withVideoFrame(() => resolveVideoDeliveryEncoderTier({
		format: 'webm', canvas: CANVAS, quality: 'high', eligible: true,
	}, {
		async isConfigSupported(config: Readonly<Record<string, unknown>>) {
			probes.push(config);
			return { supported: true };
		},
	}));
	assert.equal(decision.tier, 'webcodecs');
	assert.match(String(decision.codec), /^vp09\./u);
	assert.match(String(probes[0]?.codec), /^vp09\./u);
	// VP9's high tier is 0.12 bits per pixel, below H.264's 0.18 for the same tier.
	assert.equal(decision.bitrate, 7_457_502);
});

test('an audio delivery probes the exact browser codec tuple before rendering', async () => {
	const probes: Readonly<Record<string, unknown>>[] = [];
	const decision = await withWebCodecsMedia(() => resolveVideoDeliveryEncoderTier({
		format: 'mp4', canvas: CANVAS, quality: 'balanced', eligible: true,
		audio: { sampleRate: 48_000, channelCount: 2 },
	}, supportingEncoder(), {
		async isConfigSupported(config: Readonly<Record<string, unknown>>) {
			probes.push(config);
			return { supported: true };
		},
	}));

	assert.equal(decision.tier, 'webcodecs');
	assert.deepEqual(probes, [{
		codec: 'mp4a.40.2',
		sampleRate: 48_000,
		numberOfChannels: 2,
		bitrate: 192_000,
	}]);
});

test('an audio delivery refuses when the browser lacks its matching WebCodecs encoder', async () => {
	await assert.rejects(
		withWebCodecsMedia(() => resolveVideoDeliveryEncoderTier({
			format: 'webm', canvas: CANVAS, quality: 'draft', eligible: true,
			audio: { sampleRate: 48_000, channelCount: 1 },
		}, supportingEncoder(), {
			isConfigSupported: async () => ({ supported: false }),
		})),
		(error: unknown) => error instanceof BrowserVideoEncoderUnavailableError
			&& /Opus audio/u.test(error.message),
	);
});

test('a plan the probe cannot describe refuses without an FFmpeg fallback', async () => {
	for (const request of [
		{ format: 'mp4', canvas: undefined, quality: 'balanced', eligible: true },
		// A composed-graph plan states its rate as a number, not a rational.
		{ format: 'mp4', canvas: { width: 1_280, height: 720, frameRate: 30 }, quality: 'balanced', eligible: true },
		{ format: 'gif', canvas: CANVAS, quality: 'balanced', eligible: true },
		{ format: 'mp4', canvas: CANVAS, quality: undefined, eligible: true },
	] as const) {
		await assert.rejects(
			withVideoFrame(() => resolveVideoDeliveryEncoderTier(
				request as never, supportingEncoder(),
			)),
			(error: unknown) => error instanceof BrowserVideoEncoderUnavailableError
				&& /could not be described|does not encode|no .* level/u.test(error.message),
		);
	}
});

function supportingEncoder() {
	return Object.freeze({ isConfigSupported: async () => ({ supported: true }) });
}

async function withVideoFrame<Value>(run: () => Promise<Value>): Promise<Value> {
	const globals = globalThis as Record<string, unknown>;
	const original = Object.hasOwn(globals, 'VideoFrame') ? globals.VideoFrame : undefined;
	globals.VideoFrame = class {};
	try {
		return await run();
	} finally {
		if (original === undefined) delete globals.VideoFrame;
		else globals.VideoFrame = original;
	}
}

async function withWebCodecsMedia<Value>(run: () => Promise<Value>): Promise<Value> {
	const globals = globalThis as Record<string, unknown>;
	const original = Object.hasOwn(globals, 'AudioData') ? globals.AudioData : undefined;
	globals.AudioData = class {};
	try {
		return await withVideoFrame(run);
	} finally {
		if (original === undefined) delete globals.AudioData;
		else globals.AudioData = original;
	}
}
