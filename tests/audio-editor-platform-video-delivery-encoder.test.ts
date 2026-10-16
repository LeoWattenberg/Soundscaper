/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	resolvePlatformVideoDeliveryEncoder,
	resolveDesktopRendererVideoExportCapabilities,
} from '../src/common/editor/platform-video-delivery-encoder.ts';
import { BrowserVideoEncoderUnavailableError } from '../src/common/editor/video-delivery-encoder-tier.ts';

const REQUEST = Object.freeze({
	format: 'mp4', canvas: { width: 640, height: 360, frameRate: { num: 30, den: 1 } },
	quality: 'balanced', eligible: true,
});
const HOST_CAPABILITIES = {
	schemaVersion: 1,
	formats: { mp4: { available: true, provider: 'external-ffmpeg', reason: null } },
};

test('desktop prefers the exact WebCodecs hardware configuration without requiring FFmpeg', async () => {
	const probes: Readonly<Record<string, unknown>>[] = [];
	await withEncoder(async (config) => { probes.push(config); return { supported: true }; }, async () => {
		const decision = await resolvePlatformVideoDeliveryEncoder({ isDesktop: true }, REQUEST);
		assert.equal(decision.tier, 'webcodecs');
		assert.equal(decision.hardwareAcceleration, 'prefer-hardware');
		assert.equal(probes.length, 1);
		assert.equal(probes[0]?.hardwareAcceleration, 'prefer-hardware');
		assert.equal(probes[0]?.width, REQUEST.canvas.width);
	});
});

test('desktop retries ordinary WebCodecs when the hardware preference is unsupported', async () => {
	const hints: unknown[] = [];
	await withEncoder(async (config) => {
		hints.push(config.hardwareAcceleration);
		return { supported: config.hardwareAcceleration === undefined };
	}, async () => {
		const decision = await resolvePlatformVideoDeliveryEncoder({ isDesktop: true }, REQUEST);
		assert.equal(decision.tier, 'webcodecs');
		assert.equal(decision.hardwareAcceleration, undefined);
		assert.deepEqual(hints, ['prefer-hardware', undefined]);
	});
});

test('desktop falls back only to an execution-verified host and records the WebCodecs refusal', async () => {
	await withEncoder(async () => ({ supported: false }), async () => {
		const decision = await resolvePlatformVideoDeliveryEncoder({
			isDesktop: true, getDesktopVideoExportCapabilities: () => HOST_CAPABILITIES,
		}, REQUEST);
		assert.equal(decision.tier, 'ffmpeg');
		assert.match(decision.reason ?? '', /does not encode/u);
		await assert.rejects(resolvePlatformVideoDeliveryEncoder({ isDesktop: true }, REQUEST),
			/execution-verified external FFmpeg/u);
	});
});

test('desktop audio support is checked before selecting WebCodecs', async () => {
	await withEncoder(async () => ({ supported: true }), async () => {
		const decision = await resolvePlatformVideoDeliveryEncoder({
			isDesktop: true, getDesktopVideoExportCapabilities: () => HOST_CAPABILITIES,
		}, { ...REQUEST, audio: { sampleRate: 48_000, channelCount: 2 } });
		assert.equal(decision.tier, 'ffmpeg');
		assert.match(decision.reason ?? '', /AAC audio encoder/u);
	});
});

test('browser still refuses unavailable codecs without consulting a desktop host', async () => {
	await withEncoder(async () => ({ supported: false }), async () => {
		await assert.rejects(resolvePlatformVideoDeliveryEncoder({
			getDesktopVideoExportCapabilities: () => { throw new Error('unexpected host call'); },
		}, REQUEST), BrowserVideoEncoderUnavailableError);
	});
});

test('desktop format discovery admits WebCodecs formats independently of a host provider', async () => {
	await withEncoder(async () => ({ supported: true }), async () => {
		const capabilities = await resolveDesktopRendererVideoExportCapabilities({ isDesktop: true });
		assert.equal(capabilities.formats.mp4.available, true);
		assert.equal(capabilities.formats.webm.available, true);
		assert.equal(capabilities.formats.mp4.provider, 'webcodecs');
		assert.equal(capabilities.notice, null);
	});
});

async function withEncoder(
	probe: (config: Readonly<Record<string, unknown>>) => Promise<{ supported: boolean }>,
	operation: () => Promise<void>,
): Promise<void> {
	const keys = ['VideoEncoder', 'VideoFrame', 'AudioEncoder', 'AudioData'];
	const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, value: { isConfigSupported: probe } });
	Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, value: class {} });
	for (const key of ['AudioEncoder', 'AudioData']) Reflect.deleteProperty(globalThis, key);
	try { await operation(); }
	finally {
		keys.forEach((key, index) => {
			const descriptor = descriptors[index];
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		});
	}
}
