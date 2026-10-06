/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { addClipGainPoint } from './helpers/complex-editing-workflows.js';

test('Escape cancels clip-gain envelope dragging without persisting the preview', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await addClipGainPoint(page, editor, clip, 0.5);
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li');
	const historyBefore = await history.count();
	const point = clip.locator('.envelope-point').first();
	const before = await point.boundingBox();
	expect(before).not.toBeNull();
	const originalCenterY = before.y + before.height / 2;
	const pointCenterY = async () => {
		const bounds = await point.boundingBox();
		return bounds ? bounds.y + bounds.height / 2 : null;
	};
	await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
	await page.mouse.down();
	await page.mouse.move(before.x + before.width / 2 + 10, before.y + 20, { steps: 4 });
	await expect.poll(pointCenterY).not.toBe(originalCenterY);
	await page.keyboard.press('Escape');
	await expect.poll(pointCenterY).toBe(originalCenterY);
	await page.mouse.up();
	await expect.poll(pointCenterY).toBe(originalCenterY);
	await expect(history).toHaveCount(historyBefore);
});
