/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel, collectClientErrors, dockWorkspacePanel } from './audio-editor-test-helpers.js';

test('a floating workspace move completes before the last held auxiliary button releases', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await dockWorkspacePanel(editor, 'markers', 'floating');
	const panel = editor.locator('[data-workspace-panel="markers"]');
	const handle = panel.locator('[data-floating-panel-move-handle="markers"]');
	const move = async () => {
		const title = await handle.boundingBox();
		expect(title).not.toBeNull();
		const x = title.x + title.width / 2, y = title.y + title.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 24, y, { steps: 4 });
		return { x, y };
	};
	const original = await panel.boundingBox();
	expect(original).not.toBeNull();
	const originalX = Number(await panel.getAttribute('data-workspace-panel-x'));
	await move();
	await page.mouse.up();
	await expect.poll(async () => Number(await panel.getAttribute('data-workspace-panel-x'))).toBe(originalX + 24);
	const healthy = await panel.boundingBox();
	expect(healthy).not.toBeNull();
	const { x, y } = await move();
	await expect.poll(async () => (await panel.boundingBox()).x).toBeCloseTo(healthy.x + 24, 0);
	const accepted = await panel.boundingBox();
	expect(accepted).not.toBeNull();
	await page.evaluate(() => {
		document.addEventListener('pointermove', function released(event) {
			if (event.pointerType !== 'mouse' || event.button !== 0 || event.buttons !== 4) return;
			document.documentElement.dataset.floatingReleasedButton = String(event.button);
			document.documentElement.dataset.floatingHeldButtons = String(event.buttons);
			document.removeEventListener('pointermove', released, true);
		}, true);
	});
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await expect(page.locator('html')).toHaveAttribute('data-floating-released-button', '0');
	await expect(page.locator('html')).toHaveAttribute('data-floating-held-buttons', '4');
	await page.mouse.move(x + 60, y, { steps: 4 });
	await page.mouse.up({ button: 'middle' });
	await expect.poll(async () => (await panel.boundingBox()).x).toBeCloseTo(accepted.x, 0);
	await expect.poll(async () => Number(await panel.getAttribute('data-workspace-panel-x'))).toBe(originalX + 48);
	await closeWorkspacePanel(editor, 'markers');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await expect(panel).toHaveAttribute('data-workspace-panel-x', String(originalX + 48));
	expect(errors).toEqual([]);
});
