/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, fileDataTransfer, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

for (const desktop of [false, true]) {
	test(`Video proxies attaches an ordinary existing ${desktop ? 'native picker' : 'browser'} camera file`, async ({ page }) => {
		test.setTimeout(120_000);
		const original = createDeterministicAvFixture('camera.webm');
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await page.addInitScript(() => {
			Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true });
		});
		const native = desktop ? await installNativeCaptionSidecar(page, original.name, original.buffer) : null;
		try {
			const editor = await bootEditor(page, '/framescaper/en/');
			const transfer = await fileDataTransfer(page, [original]);
			await editor.locator('[data-project-bin-drop-target]').dispatchEvent('drop', { dataTransfer: transfer });
			await transfer.dispose();
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
			const card = editor.locator('[data-project-bin-item]').first();
			await expect(card).toBeVisible();
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
			await card.getByRole('button', { name: /More file actions:/u }).click();
			await page.getByRole('menuitem', { name: 'Video proxies', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
			if (native) await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
			else {
				const choice = page.waitForEvent('filechooser');
				await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
				await (await choice).setFiles(original);
			}
			await expect(dialog.locator('.audio-editor-video-proxy > [role="status"]').last()).toContainText('Existing proxy validated and attached.', {
				timeout: 30_000,
			});
			await dialog.getByRole('combobox', { name: 'Preview media', exact: true }).selectOption('proxy');
			await expect(dialog.getByRole('region', { name: 'Proxy status', exact: true })).toContainText(
				'The attached proxy bodies and timing are verified for this session.',
			);
			if (native) expect(native.releases).toHaveLength(1);
		} finally { await native?.close(); }
	});
}
