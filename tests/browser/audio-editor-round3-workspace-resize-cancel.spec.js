/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	dockWorkspacePanel,
} from './audio-editor-test-helpers.js';

test('Escape cancels a floating workspace panel resize before release', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	await dockWorkspacePanel(editor, 'markers', 'floating');
	const panel = editor.locator('[data-workspace-panel="markers"]');
	const handle = panel.getByRole('button', { name: 'Resize: Markers', exact: true });
	const original = await panel.boundingBox();
	const grip = await handle.boundingBox();
	expect(original).not.toBeNull();
	expect(grip).not.toBeNull();
	const x = grip.x + grip.width / 2;
	const y = grip.y + grip.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 50, y - 30, { steps: 5 });
	await expect.poll(async () => (await panel.boundingBox()).width).toBeLessThan(original.width - 20);
	await page.keyboard.press('Escape');
	await expect.poll(async () => (await panel.boundingBox()).width).toBeCloseTo(original.width, 0);
	await page.mouse.up();
	await expect.poll(async () => (await panel.boundingBox()).width).toBeCloseTo(original.width, 0);
	await expect.poll(async () => (await panel.boundingBox()).height).toBeCloseTo(original.height, 0);
});
