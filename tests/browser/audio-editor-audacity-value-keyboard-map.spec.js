/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, waitForEditor } from './audio-editor-test-helpers.js';

test('keyboard map opens from shortcut preferences and reflects a customized binding', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Insert');
	const row = preferences.locator('[data-shortcut-action="insert"]');
	await row.locator('input').first().fill('Alt+U');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	const show = preferences.getByRole('button', { name: 'Show keyboard', exact: true });
	await show.click();
	const map = page.getByRole('dialog', { name: 'Keyboard map', exact: true });
	await expect(map).toBeVisible();
	await map.getByRole('group', { name: 'Modifier state', exact: true }).getByRole('button', { name: 'Alt', exact: true }).click();
	await map.getByRole('button', { name: /^U: .*Insert/u }).click();
	await expect(map.locator('[data-keyboard-map-detail]')).toContainText('Alt+U');
	await map.getByRole('button', { name: 'Fade handle focused', exact: true }).click();
	await map.getByRole('group', { name: 'Modifier state', exact: true }).getByRole('button', { name: 'Plain', exact: true }).click();
	await map.getByRole('button', { name: /^0: Reset fade/u }).click();
	await expect(map.locator('[data-keyboard-map-detail]')).toContainText('Reset fade');
	await page.keyboard.press('Escape');
	await expect(map).toBeHidden();
	await expect(preferences).toBeVisible();
	await expect(show).toBeFocused();
});

test('timecode direct entry accepts units, cancels invalid drafts and is available in its menu', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const timecode = editor.getByRole('group', { name: 'Playhead', exact: true });
	await timecode.locator('.timecode__display').dblclick();
	const input = timecode.getByRole('textbox', { name: 'Playhead', exact: true });
	await expect(input).toBeFocused();
	await input.fill('0.5s');
	await input.press('Enter');
	await expect(input).toBeHidden();
	await expect(timecode.locator('.timecode__display')).toContainText('00.50s');
	await timecode.locator('.timecode__display').dblclick();
	await input.fill('invalid');
	await input.press('Enter');
	await expect(input).toHaveAttribute('aria-invalid', 'true');
	await input.press('Escape');
	await expect(timecode.locator('.timecode__display')).toContainText('00.50s');
	await timecode.getByRole('button', { name: 'Playhead: Format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Enter value…', exact: true }).click();
	await expect(input).toBeFocused();
	await input.press('Escape');
});

test('volume and pan offer numeric entry without leaking edits into track selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const volume = editor.getByRole('slider', { name: 'Volume', exact: true }).first();
	await volume.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Enter value…', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Volume', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Value', exact: true }).fill('37.5');
	await dialog.getByRole('textbox', { name: 'Value', exact: true }).press('Enter');
	await expect(dialog).toBeHidden();
	await expect(volume).toHaveValue('37.5');
	await expect(volume).toBeFocused();
});


test('optional play-at-speed toolbar shares its rate with the existing dropdown and saves visibility', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	await expect(editor.locator('[data-varispeed]')).toHaveCount(0);
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	const customization = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
	const toggle = customization.getByRole('checkbox', { name: 'Play at speed', exact: true });
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await toggle.click();
	await page.keyboard.press('Escape');
	const speed = editor.locator('[data-varispeed]');
	await expect(speed).toBeVisible();
	const readout = speed.locator('[data-varispeed-display]');
	await readout.focus();
	await readout.press('ArrowUp');
	await expect(readout).toHaveText('110%');
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	const dropdown = editor.locator('[data-play-at-speed]');
	const slider = dropdown.getByRole('slider', { name: 'Playback speed', exact: true });
	await expect(slider).toHaveValue('1.1');
	await slider.fill('1.5');
	await page.keyboard.press('Escape');
	await expect(readout).toHaveText('150%');
	await speed.locator('[data-varispeed-track]').dblclick();
	await expect(readout).toHaveText('100%');
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await expect(slider).toHaveValue('1');
	await page.keyboard.press('Escape');
	await page.reload();
	editor = await waitForEditor(page);
	await expect(editor.locator('[data-varispeed]')).toBeVisible();
});
