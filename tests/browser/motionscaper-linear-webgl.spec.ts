/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { requireMotionHostWebGl } from './helpers/motionscaper-host-webgl.ts';
import { fileURLToPath } from 'node:url';
import type * as Surface from '../../src/common/editor/motion-surface.ts';
import type * as WebGl from '../../src/common/editor/motion-webgl-compositor.ts';

const bundle = () => buildSync({ stdin: { contents: "export * from '../../src/common/editor/motion-surface.ts'; export * from '../../src/common/editor/motion-webgl-compositor.ts';",
	resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'motionFixture', target: 'es2022' }).outputFiles[0]!.text;

test('M04 WebGL2 float blending matches CPU for all declared modes, alpha edges and repeated frame targets', async ({ page }) => {
	await requireMotionHostWebGl(page, { floatTarget: true });
	await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(() => {
		const motion = (globalThis as unknown as { motionFixture: typeof Surface & typeof WebGl }).motionFixture;
		const canvas = document.createElement('canvas');
		const admitted = motion.createMotionWebGlCompositor(canvas);
		if (!admitted.compositor) return { reason: admitted.fallbackReason, maximumDifference: null, error: null };
		let maximumDifference = 0;
		try {
			for (const mode of ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'difference', 'exclusion'] as const) {
				const below = motion.createMotionSurface(11, 7, [0.125, 0.25, 0.5, 0.625]);
				const source = motion.createMotionSurface(11, 7);
				for (let i = 0; i < source.pixels.length; i += 4) {
					const alpha = ((i * 3) % 17) / 16;
					source.pixels.set([alpha * ((i % 9) / 8), alpha * 0.33, alpha * 0.875, alpha], i);
				}
				const target = admitted.compositor.begin(11, 7, [0.125, 0.25, 0.5, 0.625]);
				try {
					for (const opacity of [0.7, 0.25, 0, 1]) {
						motion.compositeMotionSurfaces(below, source, mode, opacity); target.composite(source, mode, opacity);
					}
					const gpu = target.finish();
					maximumDifference = Math.max(maximumDifference, ...gpu.pixels.map((value, index) => Math.abs(value - below.pixels[index]!)));
				} finally { target.dispose(); target.dispose(); }
			}
			return { reason: null, maximumDifference, error: canvas.getContext('webgl2')!.getError() };
		} finally { admitted.compositor.dispose(); admitted.compositor.dispose(); }
	});
	expect(result.reason).toBeNull();
	expect(result.error).toBe(0);
	expect(result.maximumDifference).toBeLessThanOrEqual(2e-6);
});

test('M04 missing WebGL2 float support has an explicit CPU fallback reason', async ({ page }) => {
	await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(() => {
		const motion = (globalThis as unknown as { motionFixture: typeof WebGl }).motionFixture;
		const canvas = document.createElement('canvas');
		canvas.getContext('2d');
		const admitted = motion.createMotionWebGlCompositor(canvas);
		return { compositor: admitted.compositor, reason: admitted.fallbackReason };
	});
	expect(result.compositor).toBeNull();
	expect(result.reason).toMatch(/WebGL2/iu);
});

test('M04 nested targets retain isolated pixels and context loss invalidates all unfinished frames', async ({ page }) => {
	await requireMotionHostWebGl(page, { floatTarget: true, contextLoss: true });
	await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(async () => {
		const motion = (globalThis as unknown as { motionFixture: typeof Surface & typeof WebGl }).motionFixture;
		const canvas = document.createElement('canvas');
		const admitted = motion.createMotionWebGlCompositor(canvas);
		if (!admitted.compositor) throw new Error(admitted.fallbackReason);
		const parent = admitted.compositor.begin(2, 2, [0, 0, 1, 1]);
		const child = admitted.compositor.begin(2, 2, [1, 0, 0, 0.5]);
		child.composite(motion.createMotionSurface(2, 2, [1, 1, 1, 0.5]), 'normal', 1);
		parent.composite(child.finish(), 'normal', 0.5); child.dispose();
		const pixels = Array.from(parent.finish().pixels.slice(0, 4));
		const lose = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
		if (!lose) throw new Error('Context-loss testing extension is unavailable.');
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Context loss was not delivered.')), 2000);
			canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); clearTimeout(timer); resolve(); }, { once: true });
			lose.loseContext();
		});
		let failure = '';
		try { parent.finish(); } catch (error) { failure = String(error); }
		admitted.compositor.dispose(); admitted.compositor.dispose(); parent.dispose();
		return { pixels, failure };
	});
	expect(result.pixels).toEqual([0.375, 0.25, 0.875, 1]);
	expect(result.failure).toMatch(/context was lost.*CPU/iu);
});

test('M07 whole-backdrop replacement preserves float alpha, source ownership and subsequent blends on WebGL2', async ({ page }) => {
	await requireMotionHostWebGl(page, { floatTarget: true });
	await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(() => {
		const motion = (globalThis as unknown as { motionFixture: typeof Surface & typeof WebGl }).motionFixture;
		const admitted = motion.createMotionWebGlCompositor(document.createElement('canvas'));
		if (!admitted.compositor) throw new Error(admitted.fallbackReason);
		const target = admitted.compositor.begin(5, 3, [1, 0, 0, 1]);
		try {
			const replacement = motion.createMotionSurface(5, 3, [0.2, 0.4, 0.6, 0.5]); const expected = motion.createMotionSurface(5, 3, [0.2, 0.4, 0.6, 0.5]);
			target.replace!(replacement); const before = [...target.finish().pixels]; replacement.pixels.fill(0);
			const above = motion.createMotionSurface(5, 3, [0.4, 0.5, 0.1, 0.75]);
			target.composite(above, 'screen', 0.625); motion.compositeMotionSurfaces(expected, above, 'screen', 0.625);
			const after = target.finish(); let difference = 0;
			for (let i = 0; i < after.pixels.length; i++) difference = Math.max(difference, Math.abs(after.pixels[i]! - expected.pixels[i]!));
			let mismatch = '';
			try { target.replace!(motion.createMotionSurface(1, 1)); } catch (error) { mismatch = String(error); }
			return { before: before.slice(0, 4), difference, mismatch };
		} finally { target.dispose(); admitted.compositor.dispose(); }
	});
	expect(result.before[0]).toBeCloseTo(0.1, 6); expect(result.before[1]).toBeCloseTo(0.2, 6);
	expect(result.before[2]).toBeCloseTo(0.3, 6); expect(result.before[3]).toBe(0.5);
	expect(result.difference).toBeLessThanOrEqual(2e-6); expect(result.mismatch).toMatch(/dimensions/u);
});
