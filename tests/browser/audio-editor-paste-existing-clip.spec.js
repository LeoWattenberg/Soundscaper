/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clickClipInterior,
	clipByName,
	clipField,
	collectClientErrors,
	importFiles,
	openClipProperties,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test('joins a paste into the containing clip and preserves it through history', async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');

	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', {
		name: 'Always paste audio as a new clip', exact: true,
	}).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await expect(preferences.getByRole('checkbox', {
		name: 'Always paste audio as a new clip', exact: true,
	})).not.toBeChecked();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();

	await importFiles(editor, [toneA]);
	let clip = clipByName(editor, toneA.name);
	const clipId = await clip.getAttribute('data-clip-id');
	expect(clipId).not.toBeNull();
	const clipBox = await clip.boundingBox();
	expect(clipBox).not.toBeNull();
	const selectionY = clipBox.y + clipBox.height * 0.55;
	await page.mouse.move(clipBox.x + clipBox.width * 0.25, selectionY);
	await page.mouse.down();
	await page.mouse.move(clipBox.x + clipBox.width * 0.5, selectionY, { steps: 4 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await clickClipInterior(page, clip, 0.65);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);

	// The joined source is rendered and persisted asynchronously. Wait for the
	// document mutation before selecting the clip again: changing selection while
	// that render is in flight deliberately aborts its revision-guarded commit.
	await expect(clip).not.toHaveAccessibleName(/0\.8 seconds long$/u, { timeout: 20_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	clip = editor.locator(`[data-clip-id="${clipId}"]`);
	await expect(clip).toBeVisible();
	let properties = await openClipProperties(page, editor, clip);
	await expect.poll(async () => Number(await clipField(properties, 'durationFrame').inputValue()), {
		timeout: 15_000,
	}).toBeGreaterThan(38_400);
	const joinedDuration = await clipField(properties, 'durationFrame').inputValue();
	await properties.getByRole('button', { name: 'Close', exact: true }).click();

	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	properties = await openClipProperties(page, editor, editor.locator(`[data-clip-id="${clipId}"]`));
	await expect(clipField(properties, 'durationFrame')).toHaveValue('38400');
	await properties.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	properties = await openClipProperties(page, editor, editor.locator(`[data-clip-id="${clipId}"]`));
	await expect(clipField(properties, 'durationFrame')).toHaveValue(joinedDuration);
	await properties.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

	await page.reload();
	const restoredEditor = await waitForEditor(page);
	await expect(restoredEditor).toHaveAttribute('data-clip-count', '1');
	const restoredClip = restoredEditor.locator(`[data-clip-id="${clipId}"]`);
	await expect(restoredClip).toBeVisible();
	properties = await openClipProperties(page, restoredEditor, restoredClip);
	await expect(clipField(properties, 'durationFrame')).toHaveValue(joinedDuration);
	await properties.getByRole('button', { name: 'Close', exact: true }).click();
	expect(errors).toEqual([]);
});
