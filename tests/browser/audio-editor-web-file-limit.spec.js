/* SPDX-License-Identifier: AGPL-3.0-only */

import { aup4NativeRichFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	registerAudioEditorHooks,
	resolveBrowserProductTestUrl,
	seedWorkspaceOnboardingComplete,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('browser file limit download prompt', () => {
	registerAudioEditorHooks();
	test('a refused oversized share offers the desktop version after startup', async ({ page }) => {
		await seedWorkspaceOnboardingComplete(page);
		await page.goto(resolveBrowserProductTestUrl('/embed/en/?share-error=too-large'));
		await waitForEditor(page);
		await expect(page.getByRole('dialog', { name: 'Browser file limit reached' })).toBeVisible();
		await expect(page).not.toHaveURL(/share-error/u);
	});

	for (const [productId, path] of [
		['soundscaper', '/embed/en/'],
		['framescaper', '/framescaper/embed/en/'],
	]) {
		test(`${productId} offers its own desktop download after a browser storage refusal`, async ({ page }) => {
			test.setTimeout(60_000);
			await page.addInitScript(() => {
				const storage = navigator.storage ?? {};
				if (!navigator.storage) Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
				const estimate = typeof storage.estimate === 'function' ? storage.estimate.bind(storage) : null;
				Object.defineProperty(storage, 'estimate', {
					configurable: true,
					value: async () => globalThis.__forceLowQuota
						? { quota: 1, usage: 0 }
						: estimate ? estimate() : { quota: Number.MAX_SAFE_INTEGER, usage: 0 },
				});
			});
			const editor = await bootEditor(page, path);
			await page.evaluate(() => {
				// The AUP4 worker checks the available quota before importing its valid file.
				globalThis.__forceLowQuota = true;
				globalThis.__desktopDownloadUrl = null;
				globalThis.open = (url) => { globalThis.__desktopDownloadUrl = url; return null; };
			});
			const chooser = page.waitForEvent('filechooser');
			await chooseFileAction(page, editor, 'Open');
			await (await chooser).setFiles({
				name: 'valid-but-over-quota.aup4',
				mimeType: 'application/x-audacity-project',
				buffer: Buffer.from(aup4NativeRichFixture()),
			});
			const prompt = page.getByRole('dialog', { name: 'Browser file limit reached' });
			await expect(prompt).toBeVisible({ timeout: 30_000 });
			await expect(prompt).toContainText('The desktop version can handle larger files.');
			await prompt.getByRole('button', { name: 'Download desktop version' }).click();
			await expect.poll(() => page.evaluate(() => globalThis.__desktopDownloadUrl))
				.toBe(`https://${productId}.org/download/desktop/`);
		});
	}
});
