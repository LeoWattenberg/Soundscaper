/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('audio editor application lifecycle', () => {
	test('restores the loop-selection preference when the editor starts again', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		let loopMenu = await openNestedCommandMenu(page, editor, 'Select', ['Loop region']);
		let selectionFollowsLoop = getMenuItem(loopMenu, 'Creating a loop also selects audio');

		await expect(selectionFollowsLoop).toHaveAttribute('aria-checked', 'false');
		await selectionFollowsLoop.press('Enter');
		await expect(loopMenu).toBeHidden();

		loopMenu = await openNestedCommandMenu(page, editor, 'Select', ['Loop region']);
		selectionFollowsLoop = getMenuItem(loopMenu, 'Creating a loop also selects audio');
		await expect(selectionFollowsLoop).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await page.reload();
		editor = await waitForEditor(page);
		loopMenu = await openNestedCommandMenu(page, editor, 'Select', ['Loop region']);
		await expect(getMenuItem(loopMenu, 'Creating a loop also selects audio'))
			.toHaveAttribute('aria-checked', 'true');
		expect(errors).toEqual([]);
	});

	test('drives playback loudness measurement from the EBU R 128 panel', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await chooseCommandAction(page, editor, 'Analyze', 'EBU R 128');
		const panel = editor.locator('[data-workspace-panel="ebu-r128"]');
		const state = panel.locator('[data-ebu-state]');

		await expect(state).toHaveAttribute('data-ebu-state', 'standby');
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(state).toHaveAttribute('data-ebu-state', 'running');
		await panel.getByRole('button', { name: 'Pause measurement', exact: true }).click();
		await expect(state).toHaveAttribute('data-ebu-state', 'standby');
		await panel.getByRole('button', { name: 'Continue measurement', exact: true }).click();
		await expect(state).toHaveAttribute('data-ebu-state', 'running');
		await panel.getByRole('button', { name: 'Reset measurement', exact: true }).click();
		await expect(state).toHaveAttribute('data-ebu-state', 'running');
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('persists rendered silence for a selected clip through the shipped edit menu', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		const history = editor.locator('[data-workspace-panel="history"] [data-history-list]');
		const entriesBefore = await history.locator(':scope > li').count();

		await chooseNestedCommandAction(page, editor, 'Edit', ['Remove special', 'Silence audio']);
		await expect(editor.locator('[data-status]')).toHaveText('Done');
		await expect(history.locator(':scope > li')).toHaveCount(entriesBefore + 1);
		expect(errors).toEqual([]);
	});
});
