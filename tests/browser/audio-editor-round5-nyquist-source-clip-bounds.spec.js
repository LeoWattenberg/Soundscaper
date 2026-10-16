/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeClipProperties,
	disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

async function selectMovedSource(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const properties = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
	await properties.getByText('Media settings', { exact: true }).click();
	const start = properties.locator('[data-clip-field="startFrame"]');
	await start.locator('.timecode-digit').first().click();
	await page.keyboard.type('000005000');
	await page.keyboard.press('Enter');
	await expect(start.locator('.timecode__display')).toHaveText('00h00m05.000s');
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	return { editor, properties };
}

test('Nyquist source clip bounds describe the native recording instead of its timeline placement', async ({ page }) => {
	const { editor } = await selectMovedSource(page);
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const prompt = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await prompt.getByRole('textbox', { name: 'Nyquist source', exact: true })
		.fill('(format nil "bounds=~a" (get \'*track* \'clips))');
	await prompt.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(prompt.locator('.kw-audio-editor__nyquist-output')).toContainText('bounds=((0 0.8))', { timeout: 20_000 });
});

test('Crossfade Clips can process a moved recording through its Source editor', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const { editor, properties } = await selectMovedSource(page);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Nyquist', 'Crossfade Clips']);
	const dialog = page.getByRole('dialog', { name: 'Crossfade Clips', exact: true });
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Nyquist result.');
	await closeClipProperties(properties);
	expect((await exportSamples(page, editor)).length).toBe(259_200);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	expect((await exportSamples(page, editor)).length).toBe(278_400);
});
