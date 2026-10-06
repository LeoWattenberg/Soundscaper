/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAup3Fixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseFileAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

async function openTone(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	return page.getByRole('dialog', { name: 'Tone', exact: true });
}

async function preferencesPage(page, name) {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name }).click();
	return dialog;
}

test('reopening a preferences dropdown preserves the selected keyboard option', async ({ page }) => {
	const dialog = await preferencesPage(page, /Keyboard shortcuts$/u);
	const field = dialog.getByRole('group', { name: 'Sort commands', exact: true });
	await chooseDropdown(page, field, 'Alphabetical');
	const trigger = field.getByRole('button');
	await trigger.focus();
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await expect(trigger).toHaveText(/Alphabetical/u);
});

test('Tab dismisses a preferences dropdown before moving to the next field', async ({ page }) => {
	const dialog = await preferencesPage(page, /Keyboard shortcuts$/u);
	const trigger = dialog.getByRole('group', { name: 'Sort commands', exact: true }).getByRole('button');
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('listbox')).toBeVisible();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('listbox')).toBeHidden();
	await expect(dialog.getByRole('searchbox', { name: 'Search commands', exact: true })).not.toBeFocused();
});

test('spectrogram frequency settings accept a typed multi-digit maximum above the minimum', async ({ page }) => {
	const dialog = await preferencesPage(page, /Track display$/u);
	const minimum = dialog.getByRole('spinbutton', { name: 'Minimum frequency (Hz)', exact: true });
	await minimum.fill('1000');
	await minimum.press('Tab');
	const maximum = dialog.getByRole('spinbutton', { name: 'Maximum frequency (Hz)', exact: true });
	await maximum.focus();
	await maximum.press('ControlOrMeta+A');
	await maximum.pressSequentially('8000');
	await maximum.press('Tab');
	await expect(maximum).toHaveValue('8000');
});

test('search Home and End leave query editing to the text input', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await search.fill('track');
	await search.press('Home');
	await search.pressSequentially('mono ');
	await expect(search).toHaveValue('mono track');
	await search.press('End');
	await search.pressSequentially(' extra');
	await expect(search).toHaveValue('mono track extra');
});

test('sample timecode permits replacing a small duration with a larger sample count', async ({ page }) => {
	const dialog = await openTone(page);
	const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000000001');
	await page.keyboard.press('Enter');
	await duration.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(duration.locator('.timecode-digit')).toHaveCount(12);
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000000048000');
	await page.keyboard.press('Enter');
	await expect.poll(async () => Number(await dialog.locator('[data-generator-field="durationSeconds"] [data-timecode-direct-entry]').inputValue())).toBeCloseTo(1, 8);
});

test('the duration format button leaves generation to the Generate button', async ({ page }) => {
	const dialog = await openTone(page);
	await dialog.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-clip-id]')).toHaveCount(0);
});

test('clicking a timecode digit edits it without activating its enclosing label', async ({ page }) => {
	const dialog = await openTone(page);
	const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').nth(6).click();
	await expect(page.getByRole('menu')).toHaveCount(0);
	await expect(duration.locator('.timecode-digit').nth(6)).toBeFocused();
	await expect(dialog).toBeVisible();
});

test('editing whole seconds preserves undisplayed fractional time', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').nth(6).click();
	await page.keyboard.type('015');
	await page.keyboard.press('Enter');
	const field = dialog.locator('[data-generator-field="durationSeconds"]');
	const previous = Number(await field.locator('[data-timecode-direct-entry]').inputValue());
	await duration.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'seconds', exact: true }).click();
	await duration.locator('.timecode-digit').last().click();
	await page.keyboard.press('ArrowUp');
	await expect.poll(async () => Number(await field.locator('[data-timecode-direct-entry]').inputValue()))
		.toBeCloseTo(previous + 1, 8);
});

test('preferences dropdown choices stay inside a short viewport', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 600 });
	const dialog = await preferencesPage(page, /Editing$/u);
	const field = dialog.getByRole('group', { name: 'Zoom state 2:', exact: true });
	await field.scrollIntoViewIfNeeded();
	await field.getByRole('button').click();
	const listbox = page.getByRole('listbox');
	await expect(listbox).toBeVisible();
	const bounds = await listbox.boundingBox();
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
});

test('shortcut preferences reject a misspelled key instead of assigning an unusable binding', async ({ page }) => {
	const dialog = await preferencesPage(page, /Keyboard shortcuts$/u);
	await dialog.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New mono track');
	const row = dialog.locator('[data-shortcut-action="new-mono-track"]');
	await row.locator('[data-shortcut-binding="0"]').fill('Ctrl+Backspacee');
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await expect(row.getByRole('alert')).toBeVisible();
});

async function open44100Project(page) {
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = await createAup3Fixture({ sampleRate: 44_100,
		tracks: [{ name: '44.1 kHz recording', clips: [{ samples: Array.from({ length: 100 }, (_, index) => index % 2 ? 0.1 : -0.1) }] }] });
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: '44.1 kHz recording.aup3',
		mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	return editor;
}

test('duration sample display uses the rate of a normally opened Audacity project', async ({ page }) => {
	const editor = await open44100Project(page);
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
	const value = Number(await dialog.locator('[data-generator-field="durationSeconds"] [data-timecode-direct-entry]').inputValue());
	await duration.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	const digits = (await duration.locator('.timecode-digit').allTextContents()).join('');
	expect(Number(digits)).toBe(Math.round(value * 44_100));
});

test('an exact sample entered in the playhead stays exact after its seconds conversion', async ({ page }) => {
	const editor = await open44100Project(page);
	const display = editor.locator('[data-editor-tool-toolbar] [data-time-display]');
	await display.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await display.locator('.timecode-digit').first().click();
	await page.keyboard.type('000000000015');
	await page.keyboard.press('Enter');
	await expect.poll(async () => Number((await display.locator('.timecode-digit').allTextContents()).join(''))).toBe(15);
});
