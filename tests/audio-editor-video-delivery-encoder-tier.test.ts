/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('a composed-graph delivery says why rather than reporting a browser capability', async () => {
	const decision = await withVideoFrame(() => resolveVideoDeliveryEncoderTier({
		format: 'mp4', canvas: CANVAS, quality: 'balanced', eligible: false,
	}, supportingEncoder()));
	assert.equal(decision.tier, 'ffmpeg');
	assert.equal(decision.codec, null);
	assert.equal(decision.bitrate, null);
	assert.match(decision.reason ?? '', /filter graph/u);
});

test('an unqualified browser falls back with its reason instead of failing', async () => {
	for (const [encoder, match] of [
		[undefined, /no WebCodecs video encoder/u],
		[{ isConfigSupported: async () => ({ supported: false }) }, /does not encode/u],
		[{ isConfigSupported: () => Promise.reject(new Error('nope')) }, /refused/u],
	] as const) {
		const decision = await withVideoFrame(() => resolveVideoDeliveryEncoderTier({
			format: 'webm', canvas: CANVAS, quality: 'draft', eligible: true,
		}, encoder));
		assert.equal(decision.tier, 'ffmpeg');
		assert.match(decision.reason ?? '', match);
	}
});

test('a browser with an encoder but no frame constructor falls back', async () => {
	const decision = await resolveVideoDeliveryEncoderTier({
		format: 'mp4', canvas: CANVAS, quality: 'high', eligible: true,
	}, supportingEncoder());
	assert.equal(decision.tier, 'ffmpeg');
	assert.match(decision.reason ?? '', /video frame/u);
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

test('a plan the probe cannot describe falls back rather than failing the delivery', async () => {
	for (const request of [
		{ format: 'mp4', canvas: undefined, quality: 'balanced', eligible: true },
		// A composed-graph plan states its rate as a number, not a rational.
		{ format: 'mp4', canvas: { width: 1_280, height: 720, frameRate: 30 }, quality: 'balanced', eligible: true },
		{ format: 'gif', canvas: CANVAS, quality: 'balanced', eligible: true },
		{ format: 'mp4', canvas: CANVAS, quality: undefined, eligible: true },
	] as const) {
		const decision = await withVideoFrame(() => resolveVideoDeliveryEncoderTier(
			request as never, supportingEncoder(),
		));
		assert.equal(decision.tier, 'ffmpeg');
		assert.equal(decision.bitrate, null);
		assert.match(decision.reason ?? '', /could not be described|does not encode|no .* level/u);
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
