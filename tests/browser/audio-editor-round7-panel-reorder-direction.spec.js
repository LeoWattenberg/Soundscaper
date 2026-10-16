/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, dockWorkspacePanel, waitForEditor } from './audio-editor-test-helpers.js';

for (const locale of ['en', 'ar']) test(`panel grip moves in the requested physical direction in ${locale}`, async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'History');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await dockWorkspacePanel(editor, 'history', 'bottom');
	await dockWorkspacePanel(editor, 'markers', 'bottom');
	if (locale === 'ar') {
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /General$/u }).click();
		await preferences.getByRole('button', { name: 'Language', exact: true }).click();
		await page.getByRole('option', { name: 'العربية', exact: true }).click();
		await expect(page).toHaveURL(/\/embed\/ar\//u);
		editor = await waitForEditor(page);
		await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	}
	const first = editor.locator('[data-panel-dock="bottom"] [data-workspace-panel="history"]');
	const second = editor.locator('[data-panel-dock="bottom"] [data-workspace-panel="markers"]');
	const grip = first.locator('[data-workspace-panel-drag-handle="history"]');
	await expect(first).toBeVisible(); await expect(second).toBeVisible();
	const before = await first.boundingBox(), neighbor = await second.boundingBox();
	expect(before).not.toBeNull(); expect(neighbor).not.toBeNull();
	if (locale === 'ar') expect(before.x).toBeGreaterThan(neighbor.x);
	else expect(before.x).toBeLessThan(neighbor.x);
	await grip.focus(); await grip.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight');
	const physicalOrder = async () => (await first.boundingBox()).x - (await second.boundingBox()).x;
	if (locale === 'ar') await expect.poll(physicalOrder).toBeLessThan(0);
	else await expect.poll(physicalOrder).toBeGreaterThan(0);
	await grip.press(locale === 'ar' ? 'ArrowRight' : 'ArrowLeft');
	if (locale === 'ar') await expect.poll(physicalOrder).toBeGreaterThan(0);
	else await expect.poll(physicalOrder).toBeLessThan(0);
	await expect(grip).toBeFocused();
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
