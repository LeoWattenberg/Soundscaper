/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, longTone } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clipByName, clipField, collectClientErrors, commitInput,
	importFiles, openClipProperties, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('clip properties pitch and normalization', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1440, height: 1000 } });

	test('percent pitch and speed show their neutral value at the top without a sweep', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		await panel.getByText('Pitch and tempo', { exact: true }).click();
		await panel.getByRole('button', { name: 'Percent change', exact: true }).click();
		for (const [field, neutral] of [['pitchCents', '0'], ['speedRatio', '1']]) {
			const knob = panel.locator(`[data-clip-knob="${field}"]`).getByRole('slider');
			await expect(knob).toHaveAttribute('aria-valuenow', neutral);
			await expect(knob.locator('.knob__knob-group')).toHaveAttribute('style', 'transform: rotate(0deg);');
			await expect(knob.locator('.knob__value-sweep')).toHaveCount(0);
		}
	});

	test('linked controls follow sample playback rate and retain the independent pitch when unlinked', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		await panel.getByText('Pitch and tempo', { exact: true }).click();
		await commitInput(clipField(panel, 'pitchCents'), '3');
		await commitInput(clipField(panel, 'speedRatio'), '1.5');
		const linked = panel.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true });
		await linked.click();
		await expect(linked).toBeChecked();
		await expect(clipField(panel, 'pitchCents')).toHaveValue('7.02');
		await commitInput(clipField(panel, 'speedRatio'), '4');
		await expect(clipField(panel, 'pitchCents')).toHaveValue('24.00');
		await commitInput(clipField(panel, 'pitchCents'), '12');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('2');
		await panel.getByRole('button', { name: 'Percent change', exact: true }).click();
		await expect(clipField(panel, 'pitchCents')).toHaveValue('100.000');
		await commitInput(clipField(panel, 'pitchCents'), '-50');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('0.5');
		await panel.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Stop', exact: true }).click();
		await linked.click();
		await panel.getByRole('button', { name: 'Semitones (half-steps)', exact: true }).click();
		await expect(clipField(panel, 'pitchCents')).toHaveValue('3.00');
		await expect(clipField(panel, 'speedRatio')).toHaveValue('0.5');
		await expect(panel.getByRole('alert')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('neutral linked playback disables rendering in the panel and the clip menu', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const panel = await openClipProperties(page, editor, clip);
		await panel.getByText('Pitch and tempo', { exact: true }).click();
		await commitInput(clipField(panel, 'pitchCents'), '3');
		await panel.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true }).click();
		await expect(clipField(panel, 'pitchCents')).toHaveValue('0.00');
		await expect(panel.getByRole('button', { name: 'Render', exact: true })).toBeDisabled();
		await clip.click({ button: 'right', position: { x: 32, y: 10 } });
		await expect(page.locator('.audio-editor-clip-context-menu')
			.getByRole('menuitem', { name: 'Render pitch and speed', exact: true })).toHaveAttribute('aria-disabled', 'true');
		await page.keyboard.press('Escape');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restoredEditor = await waitForEditor(page);
		const restoredPanel = await openClipProperties(page, restoredEditor, clipByName(restoredEditor, longTone.name));
		await restoredPanel.getByText('Pitch and tempo', { exact: true }).click();
		const restoredLink = restoredPanel.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true });
		await expect(restoredLink).toBeChecked();
		await expect(clipField(restoredPanel, 'pitchCents')).toHaveValue('0.00');
		await restoredLink.click();
		await expect(clipField(restoredPanel, 'pitchCents')).toHaveValue('3.00');
	});

	test('normalization contains gain and stacks both normalization actions vertically', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
		await panel.getByText('Fading', { exact: true }).click();
		await expect(panel.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true })).toBeHidden();
		await panel.getByText('Fading', { exact: true }).click();
		await panel.getByText('Normalize', { exact: true }).click();
		const gain = panel.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true });
		await commitInput(gain, '-6');
		await expect(gain).toHaveValue('-6.00');
		const peak = await panel.getByRole('button', { name: 'Normalize to −1 dBFS', exact: true }).boundingBox();
		const loudness = await panel.getByRole('button', { name: 'Normalize to −14 LUFS', exact: true }).boundingBox();
		expect(peak).not.toBeNull(); expect(loudness).not.toBeNull();
		expect(loudness.x).toBeCloseTo(peak.x, 0);
		expect(loudness.y).toBeGreaterThanOrEqual(peak.y + peak.height);
	});
});
