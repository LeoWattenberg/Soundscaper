/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type * as Video from '../../../src/common/editor/controller/export/motion-browser-video.ts';
import type * as Surface from '../../../src/common/editor/motion-surface.ts';
/** A real retained encoded source, so UI qualification exercises the production decoder. */
export async function motionTrackingVideo(page: Page, { frameCount = 120, greenScreen = false }: { frameCount?: number; greenScreen?: boolean } = {}): Promise<Buffer> {
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 120) throw new RangeError('The retained video fixture supports one to 120 frames.');
	const script = buildSync({ stdin: { contents: `
		export { createMotionBrowserVideoSink } from '../../../src/common/editor/controller/export/motion-browser-video.ts';
		export { createMotionSurface } from '../../../src/common/editor/motion-surface.ts';`,
		resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'motionTrackingFixture', target: 'es2022' }).outputFiles[0]!.text;
	await page.addScriptTag({ content: script });
	return Buffer.from(await page.evaluate(async ({ frameCount, greenScreen }) => {
		const fixture = (globalThis as unknown as { motionTrackingFixture: typeof Video & typeof Surface }).motionTrackingFixture;
		const sink = await fixture.createMotionBrowserVideoSink({ plan: { identity: { projectId: 'tracking-source', compositionId: 'source', revisionDigest: 'a'.repeat(64) }, width: 64, height: 64, frameRate: { num: 24, den: 1 }, firstFrame: 0, frameCount }, format: 'mp4', background: [0, 0, 0] });
		for (let frame = 0; frame < frameCount; frame++) {
			const surface = fixture.createMotionSurface(64, 64);
			for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
				const sx = x - frame % 8, sy = y - frame % 8;
				const value = sx >= 12 && sy >= 12 && sx < 48 && sy < 48 && (Math.floor(sx / 7) + Math.floor(sy / 7)) % 2 === 0 ? 1 : 0;
				surface.pixels.set([value, greenScreen ? 1 : value, value, 1], (y * 64 + x) * 4);
			}
			await sink.write({ index: frame, time: { num: frame, den: 24 }, duration: { num: 1, den: 24 }, surface: { ...surface, consumedOperationIds: [] } });
		}
		const blob = await sink.finish(); if (!blob) throw new Error('Tracking source encoding returned no artifact.');
		return Array.from(new Uint8Array(await blob.arrayBuffer()));
	}, { frameCount, greenScreen }));
}
