/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';

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

test('an Editor preferences resize keeps its primary gesture after an auxiliary release', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const handle = dialog.getByRole('button', { name: 'Resize: Editor preferences', exact: true });
	const resize = async () => {
		const grip = await handle.boundingBox();
		expect(grip).not.toBeNull();
		const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 24, y, { steps: 4 });
		return { x, y };
	};
	const original = await dialog.boundingBox();
	expect(original).not.toBeNull();
	await resize();
	await page.mouse.up();
	await expect.poll(async () => (await dialog.boundingBox()).width).toBeCloseTo(original.width - 24, 0);
	const healthy = await dialog.boundingBox();
	expect(healthy).not.toBeNull();
	const { x, y } = await resize();
	await expect.poll(async () => (await dialog.boundingBox()).width).toBeCloseTo(healthy.width - 24, 0);
	const accepted = await dialog.boundingBox();
	expect(accepted).not.toBeNull();
	expect(accepted.width - 36).toBeGreaterThan(280);
	await observeAuxiliaryRelease(page);
	await page.mouse.move(x - 60, y, { steps: 4 });
	await expect.poll(async () => (await dialog.boundingBox()).width).toBeCloseTo(accepted.width - 36, 0);
	await page.mouse.up();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	expect(errors).toEqual([]);
});
