/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
} from './audio-editor-test-helpers.js';

test('Audacity audio-editing preferences reveal their dependent choices and persist', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	let preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	let editing = preferences.locator('[data-editing-preferences]');

	await expect(editing.locator('[data-editing-preferences-section]')).toHaveCount(6);
	await expect(editing.getByRole('checkbox', {
		name: 'Apply effects to all audio when no selection is made', exact: true,
	})).toBeChecked();

	const deletion = editing.getByRole('radiogroup', {
		name: 'Choose behavior when deleting a portion of a clip', exact: true,
	});
	await deletion.getByRole('radio', { name: 'Close gap (ripple)', exact: true }).check();
	const closeGap = editing.getByRole('radiogroup', {
		name: 'When closing the gap, do the following', exact: true,
	});
	await expect(closeGap).toBeVisible();
	await closeGap.getByRole('radio', {
		name: 'All clips on all tracks move back to fill the gap', exact: true,
	}).check();

	const paste = editing.getByRole('radiogroup', {
		name: 'Choose behavior when pasting audio', exact: true,
	});
	await paste.getByRole('radio', { name: 'Paste pushes other clips', exact: true }).check();
	const pasteScope = editing.getByRole('radiogroup', {
		name: 'When making room for pasted audio, do the following', exact: true,
	});
	await expect(pasteScope).toBeVisible();
	await pasteScope.getByRole('radio', {
		name: 'Pasting audio pushes all clips on all tracks', exact: true,
	}).check();

	const stereoHeights = editing.getByRole('radiogroup', { name: 'Asymmetric stereo heights', exact: true });
	await stereoHeights.getByRole('radio', { name: 'Depending on workspace', exact: true }).check();
	await expect(editing.getByRole('group', { name: 'Workspaces', exact: true })).toBeVisible();

	await chooseDropdown(page, editing.getByRole('group', { name: 'Zoom state 1:', exact: true }), 'Seconds');
	await chooseDropdown(page, editing.getByRole('group', { name: 'Zoom state 2:', exact: true }), 'Max Zoom');
	await editing.getByRole('checkbox', { name: 'Always convert to mono without prompt', exact: true }).check();

	await assertNoSeriousAxeViolations(page, '[data-editing-preferences]');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();

	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	editing = preferences.locator('[data-editing-preferences]');
	await expect(editing.getByRole('radio', {
		name: 'All clips on all tracks move back to fill the gap', exact: true,
	})).toBeChecked();
	await expect(editing.getByRole('radio', {
		name: 'Pasting audio pushes all clips on all tracks', exact: true,
	})).toBeChecked();
	await expect(editing.getByRole('radio', { name: 'Depending on workspace', exact: true })).toBeChecked();
	await expect(editing.getByRole('checkbox', {
		name: 'Always convert to mono without prompt', exact: true,
	})).toBeChecked();
	await expect(editing.getByRole('group', { name: 'Zoom state 1:', exact: true })).toContainText('Seconds');
	await expect(editing.getByRole('group', { name: 'Zoom state 2:', exact: true })).toContainText('Max Zoom');
});
