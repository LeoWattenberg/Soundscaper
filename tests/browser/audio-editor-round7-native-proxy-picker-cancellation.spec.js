/* SPDX-License-Identifier: AGPL-3.0-only */

import { open } from 'node:fs/promises';

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, fileDataTransfer, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

for (const cancel of [false, true]) {
	test(`Video proxies ${cancel ? 'releases a cancelled' : 'attaches a normal'} native file after picker completion`, async ({ page }) => {
		test.setTimeout(90_000);
		const clientErrors = collectClientErrors(page);
		const original = createDeterministicAvFixture('camera.webm');
		const admission = Promise.withResolvers();
		let opening = false;
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await page.addInitScript(() => {
			Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true });
		});
		const native = await installNativeCaptionSidecar(page, original.name, original.buffer, {
			openSelectedFile: async (path, flags, mode) => {
				opening = true;
				await admission.promise;
				return await open(path, flags, mode);
			},
		});
		try {
			const editor = await bootEditor(page, '/framescaper/en/');
			const transfer = await fileDataTransfer(page, [original]);
			try {
				await editor.locator('[data-project-bin-drop-target]').dispatchEvent('drop', { dataTransfer: transfer });
			} finally { await transfer.dispose(); }
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
			const card = editor.locator('[data-project-bin-item]').first();
			await expect(card).toBeVisible();
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
			await card.getByRole('button', { name: /More file actions:/u }).click();
			await page.getByRole('menuitem', { name: 'Video proxies', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
			await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
			await expect.poll(() => opening).toBe(true);
			expect(native.calls).toHaveLength(1);
			if (cancel) await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
			admission.resolve();
			await expect(dialog.locator('.audio-editor-video-proxy > [role="status"]').last()).toContainText(
				cancel ? 'Proxy work cancelled.' : 'Existing proxy validated and attached.',
				{ timeout: 30_000 },
			);
			await expect.poll(() => native.releases.length).toBe(1);
			if (cancel) {
				await expect(dialog.getByRole('region', { name: 'Proxy status', exact: true })).toContainText('No proxy is attached.');
				await expect(dialog.getByRole('button', { name: 'Attach existing', exact: true })).toBeEnabled();
			}
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			expect(clientErrors).toEqual([]);
		} finally {
			admission.resolve();
			await native.close();
		}
	});
}
