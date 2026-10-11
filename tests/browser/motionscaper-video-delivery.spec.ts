/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type * as Video from '../../src/common/editor/controller/export/motion-browser-video.ts';
import type * as Surface from '../../src/common/editor/motion-surface.ts';
import type * as Bunny from 'mediabunny';
import type * as Delivery from '../../src/common/editor/motion-video-delivery.ts';

const bundle = (): string => buildSync({ stdin: { contents: `
	export { createMotionBrowserVideoSink } from '../../src/common/editor/controller/export/motion-browser-video.ts';
	export { createMotionSurface } from '../../src/common/editor/motion-surface.ts';
	export { MOTION_WEBM_TIMECODE_QUANTUM_SECONDS } from '../../src/common/editor/motion-video-delivery.ts';
	export { Input, BufferSource, MP4, WEBM, VideoSampleSink } from 'mediabunny';`,
	resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'iife',
	globalName: 'motionVideoFixture', target: 'es2022' }).outputFiles[0]!.text;

for (const format of ['mp4', 'webm'] as const) {
	test(`M05 ${format} delivery round trips actual browser encoding, work-area timing and opaque linear coverage`, async ({ page }) => {
		await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
		const result = await page.evaluate(async (format) => {
			const fixture = (globalThis as unknown as { motionVideoFixture: typeof Video & typeof Surface & typeof Bunny }).motionVideoFixture;
			const plan = { identity: { projectId: 'browser-motion', compositionId: 'comp', revisionDigest: 'a'.repeat(64) },
				width: 32, height: 32, frameRate: { num: 30000, den: 1001 }, firstFrame: 10, frameCount: 6 };
			const chunks: Uint8Array[] = []; let committed = false;
			const writable = new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk); }, close() { committed = true; } });
			const sink = await fixture.createMotionBrowserVideoSink({ plan, format, background: [0, 0, 1], writable });
			for (let index = 0; index < plan.frameCount; index++) {
				await sink.write({ index, time: { num: (plan.firstFrame + index) * 1001, den: 30000 }, duration: { num: 1001, den: 30000 },
					surface: { ...fixture.createMotionSurface(32, 32, [1, 0, 0, 0.5]), consumedOperationIds: [] } });
				if (committed) throw new Error('A partial video was published.');
			}
			await sink.finish();
			const bytes = new Uint8Array(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
			const input = new fixture.Input({ source: new fixture.BufferSource(bytes), formats: [fixture.MP4, fixture.WEBM] });
			try {
				const track = await input.getPrimaryVideoTrack(); if (!track) throw new Error('Output has no video track.');
				const timestamps: number[] = []; const pixels: number[][] = [];
				for await (const sample of new fixture.VideoSampleSink(track).samples()) {
					try {
						timestamps.push(sample.timestamp);
						const rgba = new Uint8Array(sample.allocationSize({ format: 'RGBA' }));
						await sample.copyTo(rgba, { format: 'RGBA' }); pixels.push([...rgba.subarray(0, 4)]);
					} finally { sample.close(); }
				}
				return { committed, timestamps, pixels, width: track.displayWidth, height: track.displayHeight,
					duration: await input.computeDuration(), largestChunk: Math.max(...chunks.map((chunk) => chunk.byteLength)) };
			} finally { input.dispose(); }
		}, format);
		expect(result.committed).toBe(true); expect(result.timestamps).toHaveLength(6);
		expect([result.width, result.height]).toEqual([32, 32]);
		result.timestamps.forEach((timestamp, index) => expect(Math.abs(timestamp - index * 1001 / 30000)).toBeLessThan(0.0011));
		expect(Math.abs(result.duration - 6 * 1001 / 30000)).toBeLessThan(0.002);
		for (const pixel of result.pixels) {
			expect(Math.abs(pixel[0]! - 180)).toBeLessThan(18); expect(pixel[1]).toBeLessThan(18);
			expect(Math.abs(pixel[2]! - 180)).toBeLessThan(18); expect(pixel[3]).toBe(255);
		}
		expect(result.largestChunk).toBeLessThanOrEqual(4 * 1024 * 1024);
	});
}

test('M05 two-frame 30 fps WebM uses its declared millisecond resolution without changing authoring time', async ({ page }) => {
	await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionVideoFixture: typeof Video & typeof Surface & typeof Bunny & typeof Delivery }).motionVideoFixture;
		const plan = { identity: { projectId: 'browser-motion', compositionId: 'comp', revisionDigest: 'a'.repeat(64) },
			width: 32, height: 32, frameRate: { num: 30, den: 1 }, firstFrame: 7, frameCount: 2 };
		const sink = await fixture.createMotionBrowserVideoSink({ plan, format: 'webm' });
		for (let index = 0; index < 2; index++) await sink.write({ index, time: { num: 7 + index, den: 30 }, duration: { num: 1, den: 30 },
			surface: { ...fixture.createMotionSurface(32, 32, [1, 0, 0, 1]), consumedOperationIds: [] } });
		const blob = await sink.finish(); if (!blob) throw new Error('Expected completed Blob output.');
		const input = new fixture.Input({ source: new fixture.BufferSource(await blob.arrayBuffer()), formats: [fixture.WEBM] });
		try {
			const track = await input.getPrimaryVideoTrack(); if (!track) throw new Error('Missing video track.');
			const timestamps: number[] = []; const durations: number[] = [];
			for await (const sample of new fixture.VideoSampleSink(track).samples()) {
				try { timestamps.push(sample.timestamp); durations.push(sample.duration); } finally { sample.close(); }
			}
			return { timestamps, durations, duration: await input.computeDuration(), quantum: fixture.MOTION_WEBM_TIMECODE_QUANTUM_SECONDS };
		} finally { input.dispose(); }
	});
	expect(result.quantum).toBe(0.001);
	expect(result.timestamps).toEqual([0, 0.033]); expect(result.durations).toEqual([0.033, 0.033]);
	expect(result.duration).toBe(0.066);
	expect(Math.abs(result.duration - 2 / 30)).toBeLessThanOrEqual(result.quantum);
});
