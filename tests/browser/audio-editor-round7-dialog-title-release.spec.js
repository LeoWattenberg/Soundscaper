/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

async function observeAuxiliaryRelease(page) {
	await page.evaluate(() => {
		document.addEventListener('mouseup', event => {
			document.documentElement.dataset.windowReleasedButton = String(event.button);
			document.documentElement.dataset.windowHeldButtons = String(event.buttons);
		}, { once: true, capture: true });
	});
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up({ button: 'middle' });
	await expect(page.locator('html')).toHaveAttribute('data-window-released-button', '1');
	await expect(page.locator('html')).toHaveAttribute('data-window-held-buttons', '1');
}

test('a Contrast title move keeps its primary gesture after an auxiliary release', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	const dialog = page.getByRole('dialog', { name: 'Contrast', exact: true });
	const header = dialog.locator('.dialog-header');
	const move = async () => {
		const title = await header.boundingBox();
		expect(title).not.toBeNull();
		const x = title.x + title.width / 3, y = title.y + title.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 24, y, { steps: 4 });
		return { x, y };
	};
	const original = await dialog.boundingBox();
	expect(original).not.toBeNull();
	await move();
	await page.mouse.up();
	await expect.poll(async () => (await dialog.boundingBox()).x).toBeCloseTo(original.x - 24, 0);
	const healthy = await dialog.boundingBox();
	expect(healthy).not.toBeNull();
	const { x, y } = await move();
	await expect.poll(async () => (await dialog.boundingBox()).x).toBeCloseTo(healthy.x - 24, 0);
	const accepted = await dialog.boundingBox();
	expect(accepted).not.toBeNull();
	await observeAuxiliaryRelease(page);
	await page.mouse.move(x - 60, y, { steps: 4 });
	await expect.poll(async () => (await dialog.boundingBox()).x).toBeCloseTo(accepted.x - 36, 0);
	await page.mouse.up();
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	expect(errors).toEqual([]);
});
