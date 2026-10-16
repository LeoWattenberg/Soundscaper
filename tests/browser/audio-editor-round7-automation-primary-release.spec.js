/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { addTrackAutomation } from './helpers/complex-editing-workflows.js';

test('a track automation drag ends on primary release with another mouse button held', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const row = clipByName(editor, monoTone.name).locator('xpath=ancestor::div[@data-track-row][1]');
	const { overlay } = await addTrackAutomation(page, editor, row);
	const point = overlay.locator('[data-automation-point-id]').last();
	const identity = await point.getAttribute('data-automation-point-id');
	const owned = overlay.locator(`[data-automation-point-id="${identity}"]`);
	const y = () => owned.evaluate(element => Number(element.getAttribute('cy')));
	const initial = await y();
	const drag = async auxiliary => {
		const box = await owned.boundingBox();
		expect(box).not.toBeNull();
		const x = box.x + box.width / 2, startY = box.y + box.height / 2;
		await page.mouse.move(x, startY);
		await page.mouse.down();
		await page.mouse.move(x, startY + 12, { steps: 3 });
		await expect.poll(y).toBeCloseTo(initial + 12, 0);
		if (auxiliary) await page.mouse.down({ button: 'middle' });
		await page.mouse.up();
		if (auxiliary) {
			await page.mouse.move(x, startY + 24, { steps: 3 });
			await page.mouse.up({ button: 'middle' });
		}
	};
	await drag(false);
	await expect.poll(y).toBeCloseTo(initial + 12, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(y).toBeCloseTo(initial, 0);
	await drag(true);
	await expect.poll(y).toBeCloseTo(initial + 12, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(y).toBeCloseTo(initial, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(y).toBeCloseTo(initial + 12, 0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
