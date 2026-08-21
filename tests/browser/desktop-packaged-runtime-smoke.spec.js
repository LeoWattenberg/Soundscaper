/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/nightly-packaged-electron.js';

test('boots the hardened packaged product runtime', async ({ page }, testInfo) => {
	test.skip(process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS !== '1', 'Runs only from nightly packaged-runtime collection.');
	const productId = testInfo.project.metadata.productId;
	await expect(page.locator('[data-audio-editor]')).toBeVisible();
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true');
	const runtime = await page.evaluate(async () => {
		const bridge = globalThis.scapeDesktop?.v1;
		return {
			nodeExposed: typeof globalThis.process !== 'undefined',
			environment: await bridge?.getEnvironment(),
			bridgeAvailable: typeof bridge?.getEnvironment === 'function',
		};
	});
	expect(runtime.nodeExposed).toBe(false);
	expect(runtime.bridgeAvailable).toBe(true);
	expect(runtime.environment?.platform).toBe(process.platform);
	expect(page.url()).toMatch(new RegExp(`^${productId}-app://bundle/`, 'u'));
});
