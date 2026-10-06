/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	closeWorkspacePanel,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';

test('command helpers keep keyboard defaults and explicit pointer opening on real menus', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__commandMenuInputModes = [];
		const topLevelMenuItem = (target) => target?.closest?.('[role="menubar"] [role="menuitem"]');
		for (const type of ['keydown', 'pointerdown']) {
			document.addEventListener(type, (event) => {
				if (type === 'keydown' && event.key !== 'Enter') return;
				const item = topLevelMenuItem(event.target);
				if (item) globalThis.__commandMenuInputModes.push(type);
			}, true);
		}
	});
	const editor = await bootEditor(page, '/embed/en/');
	for (const [options, inputMode] of [[{}, 'keydown'], [{ openWithKeyboard: false }, 'pointerdown']]) {
		await page.evaluate(() => { globalThis.__commandMenuInputModes.length = 0; });
		await chooseCommandAction(page, editor, 'Edit', 'Preferences', options);
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await expect(preferences).toBeVisible();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties'], options);
		const properties = editor.locator('[data-workspace-panel="metadata"]');
		await expect(properties).toBeVisible();
		await closeWorkspacePanel(editor, 'metadata');

		const snapping = await openNestedCommandMenu(page, editor, 'View', ['Snapping'], options);
		await expect(snapping).toBeVisible();
		await expect(snapping.getByRole('menuitemcheckbox', { name: /^Snap to grid(?:\s|$)/u })).toBeEnabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await expect(snapping).toBeHidden();
		expect(await page.evaluate(() => globalThis.__commandMenuInputModes)).toEqual([inputMode, inputMode, inputMode]);
	}
});
