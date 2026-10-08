/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, clipField,
	closeClipProperties, commitInput, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('rendering one grouped pitched recording preserves its untouched companion', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/embed/en/');
	const files = ['render-lead.wav', 'untouched-companion.wav'].map((name, index) =>
		createWavFixture({ name, frequency: index ? 660 : 440, channelCount: 1, duration: 0.8 }));
	await importFiles(editor, files);
	const lead = clipByName(editor, files[0].name);
	const companion = clipByName(editor, files[1].name);
	const properties = await openClipProperties(page, editor, lead);
	await properties.getByText('Pitch and tempo', { exact: true }).click();
	await commitInput(clipField(properties, 'pitchCents'), '2');
	await closeClipProperties(properties);
	await lead.locator('.clip-header').click();
	await companion.locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await lead.getByRole('button', { name: 'Clip menu', exact: true }).click();
	await page.locator('.audio-editor-clip-context-menu')
		.getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
	const rendered = clipByName(editor, `${files[0].name} — Render pitch and speed`);
	await expect(rendered).toBeVisible({ timeout: 30_000 });
	await expect(companion).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await rendered.press('Enter');
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(lead).toBeVisible();
	await expect(companion).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(companion).toBeVisible();
});
