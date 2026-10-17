/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeClipProperties, collectClientErrors,
	commitInput, importFiles, openClipProperties, openSourceMonitor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('upstream clip properties and source monitor', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1440, height: 1000 } });

	test('properties uses glyph fields while Source monitor retains the audio source editor without drawers', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const properties = await openClipProperties(page, editor, clip, { additional: false });
		await expect(properties.getByRole('textbox', { name: 'Clip name', exact: true })).toHaveValue(toneA.name.replace(/\.[^.]+$/u, ''));
		await expect(properties.getByRole('textbox', { name: 'Clip speed', exact: true })).toHaveValue('100');
		await expect(properties.getByRole('button', { name: 'Trim start', exact: true })).toBeVisible();
		await expect(properties.getByRole('region', { name: 'Source waveform', exact: true })).toHaveCount(0);
		const start = properties.getByRole('textbox', { name: 'Start', exact: true });
		await commitInput(start, '0.25');
		await expect(start).toHaveValue('0.25');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(start).toHaveValue('0');
		await closeClipProperties(properties);

		const source = await openSourceMonitor(page, editor, clip);
		await expect(source.getByRole('region', { name: 'Source waveform', exact: true })).toBeVisible();
		await expect(source.locator('details')).toHaveCount(0);
		await expect(source.getByRole('textbox', { name: 'Clip speed', exact: true })).toHaveCount(0);
		await source.getByRole('button', { name: 'Trim source start', exact: true }).press('Shift+ArrowRight');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		expect(errors).toEqual([]);
	});

	test('merged pitch edits apply to both selected clips and a single Undo restores both', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await clipByName(editor, toneA.name).locator('.clip-header').click();
		await clipByName(editor, toneB.name).locator('.clip-header').click({ modifiers: ['Shift'] });
		const properties = await openClipProperties(page, editor, undefined, { additional: false });
		await expect(properties.getByText('2 clips', { exact: true })).toBeVisible();
		const pitch = properties.getByRole('textbox', { name: 'Clip pitch', exact: true });
		await commitInput(pitch, '2');
		await expect(pitch).toHaveValue('2');
		await expect(properties.getByText('2 clips', { exact: true })).toBeVisible();
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(pitch).toHaveValue('0');
		await expect(properties.getByText('2 clips', { exact: true })).toBeVisible();
	});
});
