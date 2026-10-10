/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';
test('master envelope publishes one primary gesture through an auxiliary release', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1080 });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await closeWorkspacePanel(editor, 'source-monitor');
	await importFiles(editor, [createWavFixture({ name: 'Output envelope recording.wav', duration: 1 })]);
	await chooseCommandAction(page, editor, 'View', 'Master track');
	const row = editor.locator('[data-output-track-row][data-output-scope="master"]');
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Track menu', exact: true }).click();
	await page.locator('.audio-editor-output-track-menu').getByRole('menuitem', { name: 'Expand track', exact: true }).click();
	await expect(row).toHaveAttribute('data-collapsed', 'false');
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	await chooseCommandAction(page, editor, 'Window', 'History');
	const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li:not([data-redo])');
	await expect(history.first()).toBeVisible();
	const point = row.locator('.envelope-point').first();
	await expect(point).toBeVisible();
	const pointY = () => point.evaluate(element => element.getBoundingClientRect().y - element.closest('[data-output-track-row]').getBoundingClientRect().y);
	const initial = await pointY();
	const drag = async auxiliary => {
		const historyBefore = await history.count();
		const masterChangesBefore = await history.filter({ hasText: 'master/update' }).count();
		const box = await point.boundingBox();
		expect(box).not.toBeNull();
		const before = await pointY();
		const x = box.x + box.width / 2 + 32, y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 12, { steps: 3 });
		await expect.poll(pointY).toBeGreaterThan(before + 5);
		if (auxiliary) {
			await page.mouse.down({ button: 'middle' });
			await page.mouse.up({ button: 'middle' });
			await expect(history).toHaveCount(historyBefore);
		}
		await page.mouse.move(x, y + 30, { steps: 4 });
		await expect.poll(pointY).toBeGreaterThan(before + 20);
		await page.mouse.up();
		await expect(history).toHaveCount(historyBefore + 1);
		await expect(history.filter({ hasText: 'master/update' })).toHaveCount(masterChangesBefore + 1);

	};
	await drag(false);
	await expect.poll(pointY).toBeGreaterThan(initial + 20);
	const completed = await pointY();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(pointY).toBe(initial);
	await drag(true);
	await expect.poll(pointY).toBeCloseTo(completed, 1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(pointY).toBe(initial);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(pointY).toBeCloseTo(completed, 1);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
