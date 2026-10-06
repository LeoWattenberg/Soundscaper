/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction } from './audio-editor-test-helpers.js';

test('Escape cancels a live Contrast window move before allowing its dialog to close', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(toneA);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	const dialog = page.getByRole('dialog', { name: 'Contrast', exact: true });
	await expect(dialog).toBeVisible();
	const before = await dialog.boundingBox();
	const header = await dialog.locator('.dialog-header').boundingBox();
	expect(before).not.toBeNull();
	expect(header).not.toBeNull();
	await page.mouse.move(header.x + header.width / 3, header.y + header.height / 2);
	await page.mouse.down();
	await page.mouse.move(header.x + header.width / 3 - 50, header.y + header.height / 2 + 25, { steps: 5 });
	await expect.poll(async () => (await dialog.boundingBox()).x).toBeCloseTo(before.x - 50, 0);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();
	await page.mouse.up();
	await expect.poll(async () => (await dialog.boundingBox()).x).toBeCloseTo(before.x, 0);
	await expect.poll(async () => (await dialog.boundingBox()).y).toBeCloseTo(before.y, 0);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});
