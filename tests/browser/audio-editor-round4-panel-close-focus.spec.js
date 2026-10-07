/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, openWorkspacePanelMenu } from './audio-editor-test-helpers.js';

for (const remainingId of ['history', 'metadata']) test(`closing an active workspace tab returns keyboard focus to ${remainingId}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	await groupAsTab(editor, 'markers', /History.*Right/u);
	if (remainingId === 'metadata') {
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		await groupAsTab(editor, 'metadata', /History.*Markers.*Right/u);
	}
	const markers = editor.getByRole('tab', { name: 'Markers', exact: true });
	await markers.press('Enter');
	await expect(markers).toHaveAttribute('aria-selected', 'true');
	const menu = await openWorkspacePanelMenu(editor, 'markers');
	await menu.getByRole('menuitem', { name: 'Close', exact: true }).press('Enter');
	await expect(markers).toHaveCount(0);
	const remaining = editor.locator(`[data-workspace-panel="${remainingId}"]`);
	await expect(remaining).toBeVisible();
	await expect(remaining.getByRole('button', { name: `Panel menu: ${remainingId === 'history' ? 'History' : 'Metadata'}`, exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(editor.locator('.kw-audio-editor__workspace-panel-menu')).toBeVisible();
});

async function groupAsTab(editor, panelId, targetName) {
	const menu = await openWorkspacePanelMenu(editor, panelId);
	const arrange = menu.getByRole('menuitem', { name: /^Arrange panel/u });
	await arrange.press('ArrowRight');
	const target = arrange.getByRole('menu').getByRole('menuitem', { name: targetName }).first();
	await target.press('ArrowRight');
	await target.getByRole('menu').getByRole('menuitem', { name: 'As tab', exact: true }).press('Enter');
}
