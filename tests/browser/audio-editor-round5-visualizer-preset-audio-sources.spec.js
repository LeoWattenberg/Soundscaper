/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a visualizer preset exposes ordinary sequence audio while applied to a Title draft', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Speech.wav', frequency: 440, duration: 1, channelCount: 1 })]);
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Sound Visualizer']);
	const visualizer = editor.getByRole('group', { name: 'Video clip: Sound Visualizer', exact: true });
	await visualizer.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	const inspector = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	const sources = inspector.getByRole('group', { name: 'Audio sources', exact: true });
	await sources.getByRole('checkbox').first().check();
	await inspector.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(inspector.getByRole('status').last()).toHaveText('Selected visual updated.');
	await page.mouse.move(1, 1); await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
	const presets = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	await presets.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Speech display');
	await presets.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
	await expect(presets.getByRole('combobox', { name: 'Saved visual preset', exact: true }).getByRole('option', { name: 'Speech display', exact: true })).toHaveCount(1);
	await page.mouse.move(1, 1); await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	await editor.getByRole('group', { name: 'Video clip: Title', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	await inspector.getByRole('combobox', { name: 'Visual preset', exact: true }).selectOption({ label: 'Speech display' });
	await expect(sources.getByRole('checkbox', { name: /Speech/u })).toHaveCount(1);
	const speech = sources.getByRole('checkbox', { name: /Speech/u });
	await expect(speech).toBeChecked();
	await speech.uncheck();
	await speech.check();
	await inspector.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(inspector.getByRole('status').last()).toHaveText('Selected visual updated.');
	await page.mouse.move(1, 1); await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	await expect(speech).toBeChecked();
});
