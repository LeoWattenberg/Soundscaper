/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('master envelope publishes one primary gesture through an auxiliary release', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1080 });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Output envelope recording.wav', duration: 1 })]);
	await chooseCommandAction(page, editor, 'View', 'Master track');
	const row = editor.locator('[data-output-track-row][data-output-scope="master"]');
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Track menu', exact: true }).click();
	await page.locator('.audio-editor-output-track-menu').getByRole('menuitem', { name: 'Expand track', exact: true }).click();
	await expect(row).toHaveAttribute('data-collapsed', 'false');
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const point = row.locator('.envelope-point').first();
	await expect(point).toBeVisible();
	const initial = (await point.boundingBox()).y;
	const drag = async auxiliary => {
		const box = await point.boundingBox();
		expect(box).not.toBeNull();
		const x = box.x + box.width / 2 + 2, y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 12, { steps: 3 });
		if (auxiliary) {
			await page.mouse.down({ button: 'middle' });
			await page.mouse.up({ button: 'middle' });
		}
		await page.mouse.move(x, y + 30, { steps: 4 });
		await page.mouse.up();
	};
	await drag(false);
	await expect.poll(async () => (await point.boundingBox()).y).toBeGreaterThan(initial + 20);
	const completed = (await point.boundingBox()).y;
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await point.boundingBox()).y).toBe(initial);
	await drag(true);
	await expect.poll(async () => (await point.boundingBox()).y).toBeCloseTo(completed, 1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await point.boundingBox()).y).toBe(initial);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(async () => (await point.boundingBox()).y).toBeCloseTo(completed, 1);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
