/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

const HARNESS_ROUTE = '/__framescaper-v27-motion-webgl2__/harness.js';
const HARNESS_SOURCE = buildHarness();

test('the V27 temporal denoise inherited by V28 matches CPU through a real WebGL2 shader', async ({
	page,
}) => {
	await page.route(`**${HARNESS_ROUTE}`, async (route) => {
		await route.fulfill({ status: 200, contentType: 'text/javascript', body: HARNESS_SOURCE });
	});
	await page.goto(resolveBrowserProductTestUrl('/framescaper/embed/en/'));
	const result = await page.evaluate(async (harnessRoute) => {
		const motion = await import(harnessRoute);
		const width = 8;
		const height = 6;
		const frame = (offset) => motion.createGrayVideoFrameV1({
			width, height,
			samples: Array.from({ length: width * height }, (_, index) => (
				((index * 7 + offset) % 31) / 30
			)),
		});
		const current = frame(3);
		const neighbors = [{
			frame: frame(11),
			transformToCurrent: {
				scale: 1, rotationRadians: 0, translateX: 0.25, translateY: -0.5,
				inlierCount: 16, meanError: 0.01,
			},
		}, {
			frame: frame(19),
			transformToCurrent: {
				scale: 1, rotationRadians: 0, translateX: -0.5, translateY: 0.25,
				inlierCount: 16, meanError: 0.01,
			},
		}];
		const request = { current, neighbors, strength: 0.625 };
		const cpu = await motion.processTemporalDenoiseV1(request);
		const admission = motion.createVideoMotionWebGl2AcceleratorAdmissionV1(
			document.createElement('canvas'),
		);
		if (!admission.accelerator) {
			return { fallbackReason: admission.fallbackReason, fallbackReasons: [], maximumDifference: null };
		}
		const fallbackReasons = [];
		try {
			const accelerated = await motion.processTemporalDenoiseV1({
				...request,
				accelerator: admission.accelerator,
				onAcceleratorFallback(reason) { fallbackReasons.push(reason); },
			});
			return {
				fallbackReason: null,
				fallbackReasons,
				maximumDifference: Math.max(...cpu.samples.map((sample, index) => (
					Math.abs(sample - accelerated.samples[index])
				))),
			};
		} finally {
			admission.accelerator.dispose();
		}
	}, HARNESS_ROUTE);
	test.skip(
		result.fallbackReason !== null,
		`This browser environment cannot create the WebGL2 accelerator: ${result.fallbackReason ?? 'unknown'}.`,
	);
	expect(result.fallbackReason).toBeNull();
	expect(result.fallbackReasons).toEqual([]);
	expect(result.maximumDifference).not.toBeNull();
	expect(result.maximumDifference).toBeLessThanOrEqual(1e-6);
});

function buildHarness() {
	const result = buildSync({
		stdin: {
			contents: [
				"export { processTemporalDenoiseV1 } from '../../src/common/editor/video-motion-denoise-v27.ts';",
				"export { createGrayVideoFrameV1 } from '../../src/common/editor/video-motion-processing-v27.ts';",
				"export { createVideoMotionWebGl2AcceleratorAdmissionV1 } from '../../src/common/editor/video-motion-webgl2-v27.ts';",
			].join('\n'),
			loader: 'ts',
			resolveDir: fileURLToPath(new URL('.', import.meta.url)),
			sourcefile: 'framescaper-v27-motion-webgl2-browser-harness.ts',
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'esm',
		target: 'chrome120',
		legalComments: 'none',
	});
	if (result.outputFiles.length !== 1) throw new Error('The V27 WebGL2 harness did not produce one bundle.');
	return result.outputFiles[0].text;
}
