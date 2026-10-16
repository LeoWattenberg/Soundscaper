/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, dockWorkspacePanel } from './audio-editor-test-helpers.js';

test('a floating workspace resize completes when primary releases before a held middle button', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await dockWorkspacePanel(editor, 'markers', 'floating');
	const panel = editor.locator('[data-workspace-panel="markers"]');
	const handle = panel.getByRole('button', { name: 'Resize: Markers', exact: true });
	const resize = async () => {
		const grip = await handle.boundingBox();
		expect(grip).not.toBeNull();
		const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 24, y, { steps: 4 });
		return { x, y };
	};
	const original = await panel.boundingBox();
	expect(original).not.toBeNull();
	await resize();
	await page.mouse.up();
	await expect.poll(async () => Number(await panel.getAttribute('data-workspace-panel-width'))).toBeCloseTo(original.width + 24, 0);
	const healthy = await panel.boundingBox();
	expect(healthy).not.toBeNull();
	const { x, y } = await resize();
	await expect.poll(async () => (await panel.boundingBox()).width).toBeCloseTo(healthy.width + 24, 0);
	const accepted = await panel.boundingBox();
	expect(accepted).not.toBeNull();
	await page.evaluate(() => {
		document.addEventListener('pointermove', function released(event) {
			if (event.pointerType !== 'mouse' || event.button !== 0 || event.buttons !== 4) return;
			document.documentElement.dataset.workspaceReleasedButton = String(event.button);
			document.documentElement.dataset.workspaceHeldButtons = String(event.buttons);
			document.removeEventListener('pointermove', released, true);
		}, true);
	});
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await expect(page.locator('html')).toHaveAttribute('data-workspace-released-button', '0');
	await expect(page.locator('html')).toHaveAttribute('data-workspace-held-buttons', '4');
	await page.mouse.move(x + 60, y, { steps: 4 });
	await page.mouse.up({ button: 'middle' });
	await expect.poll(async () => (await panel.boundingBox()).width).toBeCloseTo(accepted.width, 0);
	await expect.poll(async () => Number(await panel.getAttribute('data-workspace-panel-width'))).toBeCloseTo(accepted.width, 0);
	expect(errors).toEqual([]);
});
