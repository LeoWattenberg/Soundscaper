/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors } from './audio-editor-test-helpers.js';

test('a floating toolbar drag continues after an auxiliary mouse button is released', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const host = await editor.boundingBox();
	expect(host).not.toBeNull();
	const grip = editor.locator('.toolbar__gripper');
	await grip.hover();
	await page.mouse.down();
	const x = host.x + 320;
	const y = host.y + 200;
	await page.mouse.move(x, y, { steps: 4 });
	const toolbar = editor.locator('[data-toolbar-dock="floating"]');
	await expect(toolbar).toBeVisible();
	const healthy = await toolbar.boundingBox();
	expect(healthy).not.toBeNull();
	const healthyTop = await toolbar.evaluate(element => Number.parseFloat(element.style.top));
	await page.mouse.move(x, y + 36);
	await expect.poll(async () => (await toolbar.boundingBox()).y).toBeCloseTo(healthy.y + 36, 0);
	await page.mouse.up();
	const savedY = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundscaper-toolbar-docking-v1')).y);
	await expect.poll(savedY).toBe(healthyTop + 36);

	await grip.hover();
	const start = await grip.boundingBox();
	expect(start).not.toBeNull();
	const pointerX = start.x + start.width / 2;
	const pointerY = start.y + start.height / 2;
	const before = await toolbar.boundingBox();
	expect(before).not.toBeNull();
	await page.mouse.down();
	await page.mouse.move(pointerX, pointerY + 24, { steps: 3 });
	await expect.poll(async () => (await toolbar.boundingBox()).y).toBeGreaterThan(before.y);
	const accepted = await toolbar.boundingBox();
	expect(accepted).not.toBeNull();
	const acceptedTop = await toolbar.evaluate(element => Number.parseFloat(element.style.top));
	await page.evaluate(() => {
		document.addEventListener('mouseup', event => {
			document.documentElement.dataset.toolbarReleasedButton = String(event.button);
			document.documentElement.dataset.toolbarHeldButtons = String(event.buttons);
		}, { once: true });
	});
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up({ button: 'middle' });
	await expect(page.locator('html')).toHaveAttribute('data-toolbar-released-button', '1');
	await expect(page.locator('html')).toHaveAttribute('data-toolbar-held-buttons', '1');
	await page.mouse.move(pointerX, pointerY + 60, { steps: 3 });
	await expect.poll(async () => (await toolbar.boundingBox()).y).toBeCloseTo(accepted.y + 36, 0);
	await page.mouse.up();
	await expect.poll(savedY).toBe(acceptedTop + 36);
	expect(errors).toEqual([]);
});
