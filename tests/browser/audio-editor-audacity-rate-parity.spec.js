/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	closeDialog, collectClientErrors, commitInput, importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

function parameter(dialog, label) {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return dialog.getByRole('group', { name: new RegExp(`^${escaped}(?: \\(.*\\))?$`, 'u') });
}

async function openRateEffect(page, name) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', name]);
	return page.getByRole('dialog', { name: 'Apply effect', exact: true });
}

test.describe('ported Audacity rate controls', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1600, height: 1000 } });

	test('Change tempo links BPM and duration while refusing targets outside the supported rate range', async ({ page }) => {
		const errors = collectClientErrors(page);
		const dialog = await openRateEffect(page, 'Change tempo');
		const fromBpm = parameter(dialog, 'From BPM').getByRole('spinbutton');
		const toBpm = parameter(dialog, 'To BPM').getByRole('spinbutton');
		const percent = parameter(dialog, 'Percent change').getByRole('spinbutton');
		const currentDuration = parameter(dialog, 'Current duration').last();
		const desiredDuration = parameter(dialog, 'Desired duration').last();
		await expect(toBpm).toBeDisabled();
		await expect(currentDuration).toHaveAttribute('aria-disabled', 'true');
		await expect(currentDuration).toContainText('800');
		await commitInput(fromBpm, '120');
		await expect(toBpm).toBeEnabled();
		await expect(toBpm).toHaveValue('120');
		await commitInput(toBpm, '180');
		await expect(percent).toHaveValue('50');
		await expect(desiredDuration).toContainText('533');
		await commitInput(toBpm, '300');
		await expect(percent).toHaveValue('50');
		await expect(desiredDuration).toContainText('533');
		await commitInput(toBpm, '240');
		await expect(percent).toHaveValue('100');
		await expect(desiredDuration).toContainText('400');
		await desiredDuration.focus();
		await desiredDuration.press('Enter');
		await page.keyboard.type('000000800');
		await percent.focus();
		await expect(percent).toHaveValue('0');
		await expect(toBpm).toHaveValue('120');
		await commitInput(fromBpm, '240');
		await expect(percent).toHaveValue('-50');
		await expect(toBpm).toHaveValue('120');
		await expect(desiredDuration).toContainText('600');
		await expect(currentDuration).toContainText('800');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Change speed and pitch links multiplier, vinyl rate and desired duration', async ({ page }) => {
		const errors = collectClientErrors(page);
		const dialog = await openRateEffect(page, 'Change speed and pitch');
		const multiplier = parameter(dialog, 'Speed multiplier').getByRole('spinbutton');
		const percent = parameter(dialog, 'Speed change').getByRole('spinbutton');
		const currentDuration = parameter(dialog, 'Current duration').last();
		const desiredDuration = parameter(dialog, 'Desired duration').last();
		await parameter(dialog, 'To rpm').getByRole('button').click();
		await expect(page.getByRole('option', { name: '78', exact: true })).toHaveCount(0);
		await expect(page.getByRole('option', { name: '45', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(multiplier).toHaveValue('1');
		await expect(currentDuration).toHaveAttribute('aria-disabled', 'true');
		await expect(currentDuration).toContainText('800');
		await commitInput(multiplier, '2');
		await expect(percent).toHaveValue('100');
		await expect(desiredDuration).toContainText('400');
		await commitInput(multiplier, '2.5');
		await expect(percent).toHaveValue('100');
		await expect(desiredDuration).toContainText('400');
		await commitInput(multiplier, '1.35');
		await expect(percent).toHaveValue('35');
		await expect(parameter(dialog, 'To rpm').getByRole('button')).toContainText('45');
		await chooseDropdown(page, parameter(dialog, 'From rpm'), '45');
		await expect(multiplier).toHaveValue('1');
		await expect(percent).toHaveValue('0');
		await expect(desiredDuration).toContainText('800');
		await desiredDuration.focus();
		await desiredDuration.press('Enter');
		await page.keyboard.type('000001600');
		await multiplier.focus();
		await expect(percent).toHaveValue('-50');
		await expect(multiplier).toHaveValue('0.5');
		await expect(desiredDuration).toContainText('600');
		await expect(currentDuration).toContainText('800');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Sliding stretch links each pitch percentage independently and keeps tempo sliders in the top row', async ({ page }) => {
		const errors = collectClientErrors(page);
		const dialog = await openRateEffect(page, 'Sliding stretch');
		const initialTempo = dialog.getByRole('region', { name: 'Initial tempo change', exact: true });
		const finalTempo = dialog.getByRole('region', { name: 'Final tempo change', exact: true });
		await expect(initialTempo.getByRole('slider')).toBeVisible();
		await expect(finalTempo.getByRole('slider')).toBeVisible();
		await commitInput(initialTempo.getByRole('spinbutton'), '24.5');
		await expect(initialTempo.getByRole('slider')).toHaveValue('24.5');
		const initialPitch = dialog.getByRole('region', { name: 'Initial pitch shift', exact: true });
		const finalPitch = dialog.getByRole('region', { name: 'Final pitch shift', exact: true });
		const initialSemitones = initialPitch.getByRole('group', { name: /^Semitones/u }).getByRole('spinbutton');
		const finalSemitones = finalPitch.getByRole('group', { name: /^Semitones/u }).getByRole('spinbutton');
		const initialPercent = parameter(initialPitch, 'Percentage change').getByRole('spinbutton');
		const finalPercent = parameter(finalPitch, 'Percentage change').getByRole('spinbutton');
		await commitInput(initialPercent, '100');
		await expect(initialSemitones).toHaveValue('12');
		await expect(finalSemitones).toHaveValue('0');
		await commitInput(finalPercent, '-50');
		await expect(finalSemitones).toHaveValue('-12');
		await expect(initialSemitones).toHaveValue('12');
		await commitInput(initialSemitones, '0');
		await expect(initialPercent).toHaveValue('0');
		await expect(finalPercent).toHaveValue('-50');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});
});
