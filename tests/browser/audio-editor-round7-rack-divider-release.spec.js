/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('the rack stack divider keeps resizing after an auxiliary mouse release', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'divider-recording.wav', frequency: 440, duration: 0.25 })]);
	const panel = await openEffectsForTrack(editor, 0);
	const handle = panel.locator('.effects-panel__vertical-resize-handle');
	const master = panel.locator('.effects-panel__content > .effects-panel__master-section');
	const drag = async (movement) => {
		const grip = await handle.boundingBox();
		expect(grip).not.toBeNull();
		const x = grip.x + grip.width / 2;
		const y = grip.y + grip.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y - movement, { steps: 4 });
		return { x, y };
	};
	const initial = await master.boundingBox();
	expect(initial).not.toBeNull();
	await drag(20);
	await expect.poll(async () => (await master.boundingBox()).height).toBeGreaterThan(initial.height + 10);
	await page.mouse.up();
	await expect(handle).not.toHaveClass(/--active/u);
	const healthy = await master.boundingBox();
	expect(healthy).not.toBeNull();
	const { x, y } = await drag(20);
	await expect.poll(async () => (await master.boundingBox()).height).toBeGreaterThan(healthy.height + 10);
	const accepted = await master.boundingBox();
	expect(accepted).not.toBeNull();
	await page.evaluate(() => {
		document.addEventListener('mouseup', event => {
			document.documentElement.dataset.rackDividerReleasedButton = String(event.button);
			document.documentElement.dataset.rackDividerHeldButtons = String(event.buttons);
		}, { once: true, capture: true });
	});
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up({ button: 'middle' });
	await expect(page.locator('html')).toHaveAttribute('data-rack-divider-released-button', '1');
	await expect(page.locator('html')).toHaveAttribute('data-rack-divider-held-buttons', '1');
	await page.mouse.move(x, y - 56, { steps: 4 });
	await expect.poll(async () => (await master.boundingBox()).height).toBeCloseTo(accepted.height + 36, 0);
	await page.mouse.up();
	await expect(handle).not.toHaveClass(/--active/u);
	expect(errors).toEqual([]);
});
