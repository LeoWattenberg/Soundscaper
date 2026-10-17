/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, longTone, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clipByName, clipField, collectClientErrors, commitInput,
	importFiles, openClipProperties, openSourceMonitor, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';
import { chooseClipMediaSetting, chooseClipPitchUnit, expectClipMediaSettingChecked, openClipMediaSettings } from './audio-editor-clip-settings-test-helpers.js';

test.describe('clip properties pitch and normalization', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1440, height: 1000 } });

	test('percent pitch and speed show neutral values without altering the clip', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));

		await chooseClipPitchUnit(panel, 'Percent change');
		for (const [field, neutral] of [['pitchCents', '0'], ['speedRatio', '100']]) {
			await expect(clipField(panel, field)).toHaveValue(neutral);
		}
		await expect(clipByName(editor, longTone.name).getByRole('button', { name: 'Clip speed', exact: true })).toHaveCount(0);
	});

	test('linked controls follow sample playback rate and retain the independent pitch when unlinked', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));

		await commitInput(clipField(panel, 'pitchCents'), '3');
		await commitInput(clipField(panel, 'speedRatio'), '150');
		await chooseClipMediaSetting(panel, 'Link pitch and tempo');
		await expectClipMediaSettingChecked(panel, 'Link pitch and tempo', true);
		await expect(clipField(panel, 'pitchCents')).toHaveValue('7.02');
		await commitInput(clipField(panel, 'speedRatio'), '400');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('24');
		await commitInput(clipField(panel, 'pitchCents'), '12');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('200');
		await chooseClipPitchUnit(panel, 'Percent change');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('100');
		await commitInput(clipField(panel, 'pitchCents'), '-50');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('50');
		const source = await openSourceMonitor(page, editor);
		await source.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(source.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await source.getByRole('button', { name: 'Stop', exact: true }).click();
		await chooseClipMediaSetting(panel, 'Link pitch and tempo');
		await chooseClipPitchUnit(panel, 'Semitones (half-steps)');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('3');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('50');
		await expect(panel.getByRole('alert')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('clip speeds below one percent retain the native value through reload', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		const recording = createWavFixture({ name: 'slow-clip.wav', frequency: 220, duration: 0.02, channelCount: 1 });
		await importFiles(editor, [recording]);
		let panel = await openClipProperties(page, editor, clipByName(editor, recording.name));
		await chooseClipMediaSetting(panel, 'Link pitch and tempo');
		for (const percent of ['0.5', '0.1']) {
			await commitInput(clipField(panel, 'speedRatio'), percent);
			await expect(clipField(panel, 'speedRatio')).toHaveValue(percent);
		}
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openClipProperties(page, editor, clipByName(editor, recording.name));
		await expect(clipField(panel, 'speedRatio')).toHaveValue('0.1');
		expect(errors).toEqual([]);
	});

	test('neutral linked playback disables rendering in the panel and the clip menu', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const panel = await openClipProperties(page, editor, clip);

		await commitInput(clipField(panel, 'pitchCents'), '3');
		await chooseClipMediaSetting(panel, 'Link pitch and tempo');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('0');
		const settings = await openClipMediaSettings(panel);
		await expect(settings.getByRole('menuitem', { name: 'Render pitch and speed', exact: true })).toBeDisabled();
		await settings.press('Escape');
		await clip.click({ button: 'right', position: { x: 32, y: 10 } });
		await expect(page.locator('.audio-editor-clip-context-menu')
			.getByRole('menuitem', { name: 'Render pitch and speed', exact: true })).toHaveAttribute('aria-disabled', 'true');
		await page.keyboard.press('Escape');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restoredEditor = await waitForEditor(page);
		const restoredPanel = await openClipProperties(page, restoredEditor, clipByName(restoredEditor, longTone.name));

		await expectClipMediaSettingChecked(restoredPanel, 'Link pitch and tempo', true);
		await expect(clipField(restoredPanel, 'pitchCents')).toHaveValue('0');
		await chooseClipMediaSetting(restoredPanel, 'Link pitch and tempo');
		await expect(clipField(restoredPanel, 'pitchCents')).toHaveValue('3');
	});

	test('Media settings offers one gain dialog and both normalization actions', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		await expect(panel.getByRole('textbox', { name: 'Clip gain (dB)', exact: true })).toHaveCount(0);
		await chooseClipMediaSetting(panel, 'Clip gain (dB)');
		let gainDialog = page.getByRole('dialog', { name: 'Clip gain (dB)', exact: true });
		await gainDialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true }).fill('-6');
		await gainDialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(gainDialog).toBeHidden();
		await chooseClipMediaSetting(panel, 'Clip gain (dB)');
		gainDialog = page.getByRole('dialog', { name: 'Clip gain (dB)', exact: true });
		await expect(gainDialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true })).toHaveValue('-6');
		await gainDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		const settings = await openClipMediaSettings(panel);
		const peak = await settings.getByRole('menuitem', { name: 'Normalize to −1 dBFS', exact: true }).boundingBox();
		const loudness = await settings.getByRole('menuitem', { name: 'Normalize to −14 LUFS', exact: true }).boundingBox();
		expect(peak).not.toBeNull(); expect(loudness).not.toBeNull();
		expect(loudness.x).toBeCloseTo(peak.x, 0);
		expect(loudness.y).toBeGreaterThanOrEqual(peak.y + peak.height);
		await settings.press('Escape');
	});
});
