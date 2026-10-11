/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type * as Video from '../../src/common/editor/controller/export/motion-browser-video.ts';
import type * as Surface from '../../src/common/editor/motion-surface.ts';
import type * as Provider from '../../src/common/editor/motion-media-provider.ts';
import type { MotionAsset } from '../../src/common/editor/motion-asset.ts';

const bundle = () => buildSync({ stdin: { contents: `
	export { createMotionBrowserVideoSink } from '../../src/common/editor/controller/export/motion-browser-video.ts';
	export { createMotionSurface } from '../../src/common/editor/motion-surface.ts';
	export { createMotionMediaProvider } from '../../src/common/editor/motion-media-provider.ts';`,
	resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'iife',
	globalName: 'motionMediaFixture', target: 'es2022' }).outputFiles[0]!.text;

test('retained footage provider decodes exact source PTS and reverse seeks without using a media element', async ({ page }) => {
	await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionMediaFixture: typeof Video & typeof Surface & typeof Provider }).motionMediaFixture;
		const plan = { identity: { projectId: 'source', compositionId: 'c', revisionDigest: 'a'.repeat(64) }, width: 32, height: 32,
			frameRate: { num: 30, den: 1 }, firstFrame: 0, frameCount: 2 };
		const sink = await fixture.createMotionBrowserVideoSink({ plan, format: 'mp4', background: [0, 0, 0] });
		for (let index = 0; index < 2; index++) await sink.write({ index, time: { num: index, den: 30 }, duration: { num: 1, den: 30 },
			surface: { ...fixture.createMotionSurface(32, 32, index === 0 ? [1, 0, 0, 1] : [0, 0, 1, 1]), consumedOperationIds: [] } });
		const blob = await sink.finish(); if (!blob) throw new Error('A source file is required.');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
		const asset: Extract<MotionAsset, { kind: 'footage' }> = { id: 'video', kind: 'footage', name: 'Source.mp4', width: 32, height: 32,
			frameRate: { num: 30, den: 1 }, duration: { num: 1, den: 15 }, hasAlpha: false, hasAudio: false,
			mimeType: 'video/mp4', byteLength: bytes.byteLength, sha256: digest, storageKey: `motion-sha256:${digest}` };
		let loads = 0; const provider = fixture.createMotionMediaProvider({ loadAsset: () => { loads++; return Promise.resolve(bytes); } });
		try {
			const pixels: number[][] = [];
			for (const num of [0, 1, 0]) pixels.push(Array.from((await provider.decodeFootage(asset, { num, den: 30 })).pixels.subarray(0, 4)));
			return { pixels, loads, mediaElements: document.querySelectorAll('video,audio').length };
		} finally { provider.dispose(); }
	});
	expect(result.loads).toBe(1); expect(result.mediaElements).toBe(0);
	for (const [index, pixel] of result.pixels.entries()) {
		expect(pixel[index === 1 ? 2 : 0]).toBeGreaterThan(0.95);
		expect(pixel[index === 1 ? 0 : 2]).toBeLessThan(0.03); expect(pixel[1]).toBeLessThan(0.03); expect(pixel[3]).toBe(1);
	}
});
