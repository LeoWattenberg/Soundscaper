/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type * as Surface from '../../src/common/editor/motion-surface.ts';
import type * as WebGl from '../../src/common/editor/motion-webgl-compositor.ts';

const bundle = () => buildSync({ stdin: { contents: "export * from '../../src/common/editor/motion-surface.ts'; export * from '../../src/common/editor/motion-webgl-compositor.ts';",
	resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'motionFixture', target: 'es2022' }).outputFiles[0]!.text;

test('M04 WebGL2 float blending matches CPU for all declared modes, alpha edges and repeated frame targets', async ({ page }) => {
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
