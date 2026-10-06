/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction,
	openWorkspacePanelMenu, waitForEditor,
} from './audio-editor-test-helpers.js';
import { localeCopy } from './helpers/locale-copy.js';

async function groupAsTab(editor, panelId, targetName) {
	const menu = await openWorkspacePanelMenu(editor, panelId);
	const arrange = menu.getByRole('menuitem', { name: /^Arrange panel/u });
	await arrange.press('ArrowRight');
	const target = arrange.getByRole('menu').getByRole('menuitem', { name: targetName }).first();
	await target.press('ArrowRight');
	await target.getByRole('menu').getByRole('menuitem', { name: 'As tab', exact: true }).press('Enter');
}

test('workspace tab arrows follow their physical order in an RTL locale', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	await groupAsTab(editor, 'metadata', /History.*Right/u);
	await groupAsTab(editor, 'project-bin', /History.*Metadata.*Right/u);
	const grouped = '[data-workspace-panel-group]:has([data-workspace-tab-panel="history"]):has([data-workspace-tab-panel="metadata"]):has([data-workspace-tab-panel="project-bin"])';
	await expect(editor.locator(grouped).getByRole('tab')).toHaveCount(3);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /General$/u }).click();
	await preferences.getByRole('button', { name: 'Language', exact: true }).click();
	await page.getByRole('option', { name: 'العربية', exact: true }).click();
	await expect(page).toHaveURL(/\/embed\/ar\//u);
	editor = await waitForEditor(page);
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	const tabs = editor.locator(grouped).getByRole('tab');
	await expect(tabs).toHaveCount(3);
	const first = tabs.nth(0);
	const second = tabs.nth(1);
	const third = tabs.nth(2);
	const [firstBox, secondBox, thirdBox] = await Promise.all([
		first.boundingBox(), second.boundingBox(), third.boundingBox(),
	]);
	expect(firstBox.x).toBeGreaterThan(secondBox.x);
	expect(secondBox.x).toBeGreaterThan(thirdBox.x);
	await second.focus();
	await second.press('ArrowRight');
	await expect(first).toBeFocused();
	await expect(first).toHaveAttribute('aria-selected', 'true');
	await first.press('ArrowLeft');
	await expect(second).toBeFocused();
	await second.press('Home');
	await expect(first).toBeFocused();
	await first.press('End');
	await expect(third).toBeFocused();
});

test('About dialog tab arrows follow their physical order in an RTL locale', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/ar/');
	const copy = localeCopy('ar');
	await editor.getByRole('menubar').getByRole('menuitem', { name: copy.helpMenu, exact: true }).press('Enter');
	await page.getByRole('menu', { name: copy.helpMenu, exact: true })
		.getByRole('menuitem', { name: copy.aboutEditor, exact: true }).press('Enter');
	const dialog = page.getByRole('dialog', { name: copy.aboutEditor, exact: true });
	const tabs = dialog.getByRole('tab');
	await expect(tabs).toHaveCount(4);
	const [first, second, third] = [tabs.nth(0), tabs.nth(1), tabs.nth(2)];
	const [firstBox, secondBox, thirdBox] = await Promise.all([
		first.boundingBox(), second.boundingBox(), third.boundingBox(),
	]);
	expect(firstBox.x).toBeGreaterThan(secondBox.x);
	expect(secondBox.x).toBeGreaterThan(thirdBox.x);
	await second.press('ArrowRight');
	await expect(first).toBeFocused();
	await expect(first).toHaveAttribute('aria-selected', 'true');
});
