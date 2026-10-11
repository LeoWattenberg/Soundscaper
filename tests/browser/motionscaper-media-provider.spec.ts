/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type * as Provider from '../../src/common/editor/motion-media-provider.ts';
import { encodeMotionChannel } from '../../src/common/editor/motion-surface.ts';
import type { MotionAsset } from '../../src/common/editor/motion-asset.ts';
import { motionRetainedVideoFixture, MOTION_RETAINED_VIDEO_FIXTURES } from './helpers/motionscaper-tracking-source.ts';

const bundle = () => buildSync({ stdin: { contents: `
	export { createMotionMediaProvider } from '../../src/common/editor/motion-media-provider.ts';`,
	resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'iife',
	globalName: 'motionMediaFixture', target: 'es2022' }).outputFiles[0]!.text;

test('retained footage provider decodes exact source PTS and reverse seeks without using a media element', async ({ page }) => {
	await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(async encoded => {
		const fixture = (globalThis as unknown as { motionMediaFixture: typeof Provider }).motionMediaFixture;
		const bytes = new Uint8Array(encoded);
		const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
		const asset: Extract<MotionAsset, { kind: 'footage' }> = { id: 'video', kind: 'footage', name: 'Source.mp4', width: 64, height: 64,
			frameRate: { num: 30, den: 1 }, duration: { num: 1, den: 15 }, hasAlpha: false, hasAudio: false,
			mimeType: 'video/mp4', byteLength: bytes.byteLength, sha256: digest, storageKey: `motion-sha256:${digest}` };
		let loads = 0; const provider = fixture.createMotionMediaProvider({ loadAsset: () => { loads++; return Promise.resolve(bytes); } });
		try {
			const pixels: number[][] = [];
			for (const num of [0, 1, 0]) pixels.push(Array.from((await provider.decodeFootage(asset, { num, den: 30 })).pixels.subarray(0, 4)));
			return { pixels, loads, mediaElements: document.querySelectorAll('video,audio').length };
		} finally { provider.dispose(); }
	}, Array.from(motionRetainedVideoFixture('swatches2')));
	expect(result.loads).toBe(1); expect(result.mediaElements).toBe(0);
	for (const [index, pixel] of result.pixels.entries()) {
		// The retained 4:2:0 H.264 primary can differ by up to 18 encoded codes.
		expect(Math.abs(encodeMotionChannel(pixel[index === 1 ? 2 : 0]!, 'srgb') * 255 - 255)).toBeLessThan(18);
		expect(pixel[index === 1 ? 0 : 2]).toBeLessThan(0.03); expect(pixel[1]).toBeLessThan(0.03); expect(pixel[3]).toBe(1);
	}
});

for (const name of ['checker120', 'green6'] as const) test(`retained ${name} moving pattern decodes independently of browser encoding`, async ({ page }) => {
	await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(async ({ encoded, metadata }) => {
		const fixture = (globalThis as unknown as { motionMediaFixture: typeof Provider }).motionMediaFixture;
		const bytes = new Uint8Array(encoded);
		const asset: Extract<MotionAsset, { kind: 'footage' }> = { id: 'moving', kind: 'footage', name: 'Moving.mp4', width: metadata.width, height: metadata.height,
			frameRate: { num: metadata.frameRate, den: 1 }, duration: { num: metadata.frameCount, den: metadata.frameRate }, hasAlpha: false, hasAudio: false,
			mimeType: 'video/mp4', byteLength: bytes.byteLength, sha256: metadata.sha256, storageKey: `motion-sha256:${metadata.sha256}` };
		const provider = fixture.createMotionMediaProvider({ loadAsset: () => Promise.resolve(bytes) });
		try {
			const result = [];
			for (const frame of [0, 5, 0]) {
				const surface = await provider.decodeFootage(asset, { num: frame, den: metadata.frameRate });
				const at = (x: number, y: number): number[] => Array.from(surface.pixels.subarray((y * metadata.width + x) * 4, (y * metadata.width + x) * 4 + 4));
				result.push({ corner: at(0, 0), original: at(16, 16), translated: at(21, 21) });
			}
			return result;
		} finally { provider.dispose(); }
	}, { encoded: Array.from(motionRetainedVideoFixture(name)), metadata: MOTION_RETAINED_VIDEO_FIXTURES[name] });
	expect(result[0]).toEqual(result[2]); expect(result[0]!.original[0]).toBeGreaterThan(0.9);
	expect(result[1]!.original[0]).toBeLessThan(0.08); expect(result[1]!.translated[0]).toBeGreaterThan(0.9);
	for (const frame of result) {
		expect(frame.corner[0]).toBeLessThan(0.02); expect(frame.corner[3]).toBe(1);
		// Native limited-BT709 NV12 reconstructs G254; WK canvas yields250, Chrome/Firefox255.
		if (name === 'green6') expect(Math.abs(encodeMotionChannel(frame.corner[1]!, 'srgb') * 255 - 255)).toBeLessThan(8);
		else expect(frame.corner[1]).toBeLessThan(0.02);
	}
});

test('retained AV fixture exposes bounded native stereo PCM without requiring an encoder', async ({ page }) => {
	await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(async ({ encoded, metadata }) => {
		const fixture = (globalThis as unknown as { motionMediaFixture: typeof Provider }).motionMediaFixture;
		const bytes = new Uint8Array(encoded);
		const asset: Extract<MotionAsset, { kind: 'footage' }> = { id: 'av', kind: 'footage', name: 'Retained.mp4', width: 64, height: 64,
			frameRate: { num: 30, den: 1 }, duration: { num: 1, den: 1 }, hasAlpha: false, hasAudio: true,
			mimeType: 'video/mp4', byteLength: bytes.byteLength, sha256: metadata.sha256, storageKey: `motion-sha256:${metadata.sha256}` };
		const provider = fixture.createMotionMediaProvider({ loadAsset: () => Promise.resolve(bytes) });
		try {
			const format = await provider.describe(asset); const pcm = await provider.read({ asset, startSample: 1024, sampleCount: 4096 });
			const energy = [0, 0]; for (let index = 0; index < pcm.length; index++) energy[index % 2] = energy[index % 2]! + pcm[index]! ** 2;
			let nativeSamples = 0;
			for (let startSample = 0; startSample < format.sampleCount; startSample += 4096) {
				const sampleCount = Math.min(4096, format.sampleCount - startSample);
				const window = await provider.read({ asset, startSample, sampleCount });
				if (window.length !== sampleCount * 2 || window.some(value => !Number.isFinite(value))) throw new Error('Invalid native PCM window.');
				nativeSamples += window.length / 2;
			}
			return { format, nativeSamples, length: pcm.length, rms: energy.map(value => Math.sqrt(value / 4096)) };
		} finally { provider.dispose(); }
	}, { encoded: Array.from(motionRetainedVideoFixture('redAudio30')), metadata: MOTION_RETAINED_VIDEO_FIXTURES.redAudio30 });
	expect(result.format).toEqual({ sampleRate: 48000, channels: 2, sampleCount: 48000 }); expect(result.length).toBe(8192); expect(result.nativeSamples).toBe(48000);
	expect(result.rms[0]).toBeGreaterThan(0.15); expect(result.rms[0]).toBeLessThan(0.20);
	expect(result.rms[1]).toBeGreaterThan(0.075); expect(result.rms[1]).toBeLessThan(0.10);
});
