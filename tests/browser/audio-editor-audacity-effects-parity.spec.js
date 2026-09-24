/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction,
	closeDialog, collectClientErrors, commitInput, importFiles, openEffectsForTrack,
	openRackPicker, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const historyName = 'Input, output and compression history';
const curveName = 'Compression curve';

function parameter(dialog, label) {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return dialog.getByRole('group', { name: new RegExp(`^${escaped}(?: \\(.*\\))?$`, 'u') });
}

async function box(locator) {
	await expect(locator).toBeVisible();
	const bounds = await locator.boundingBox();
	expect(bounds).not.toBeNull();
	return bounds;
}

async function expectHistoryControls(dialog) {
	const history = dialog.getByRole('img', { name: historyName, exact: true });
	await expect(history).toBeVisible();
	for (const label of ['Input', 'Output', 'Compression']) {
		const checkbox = dialog.getByRole('checkbox', { name: label, exact: true });
		await expect(checkbox).toBeChecked();
		await checkbox.click();
		await expect(checkbox).not.toBeChecked();
		await checkbox.click();
		await expect(checkbox).toBeChecked();
	}
	return history;
}

async function expectPresetAndBypass(page, dialog, presetName, threshold) {
	const preset = dialog.getByRole('button', { name: 'Preset', exact: true });
	await preset.click();
	await page.getByRole('option', { name: presetName, exact: true }).click();
	await expect(preset).toContainText(presetName);
	const input = parameter(dialog, 'Threshold').getByRole('spinbutton');
	await expect(input).toHaveValue(threshold);
	await commitInput(input, '-18');
	await expect(input).toHaveValue('-18');
	await expect(preset).toContainText('*');
	await dialog.getByRole('button', { name: 'Reset preset', exact: true }).click();
	await expect(input).toHaveValue(threshold);
	await expect(preset).not.toContainText('*');
	await dialog.getByRole('button', { name: 'Disable effect', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Enable effect', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Enable effect', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Disable effect', exact: true })).toBeVisible();
	await expect(input).toHaveValue(threshold);
}

async function useAudacityDarkTheme(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Appearance$/u }).click();
	await preferences.getByRole('radio', { name: 'Dark', exact: true }).check();
	await preferences.getByRole('button', { name: 'Close', exact: true }).first().click();
	await expect(preferences).toBeHidden();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
}

test.describe('ported Audacity effect layouts', () => {
	registerAudioEditorHooks();
	test.use({ viewport: { width: 1600, height: 1000 } });

	test('offers one Compressor and Limiter and opens their Audacity realtime controls', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openEffectsForTrack(editor, 1);
		for (const name of ['Compressor', 'Limiter']) {
			await openRackPicker(panel, 'track');
			const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
			await expect(picker.getByRole('menuitem', { name: /^Compressor(?: \(Audacity\))?$/u })).toHaveCount(1);
			await expect(picker.getByRole('menuitem', { name: /^Limiter(?: \(Audacity\))?$/u })).toHaveCount(1);
			await picker.getByRole('menuitem', { name, exact: true }).click();
			const dialog = page.getByRole('dialog', { name, exact: true });
			await expect(dialog.getByRole('img', { name: historyName, exact: true })).toBeVisible();
			await expect(parameter(dialog, 'Threshold')).toBeVisible();
			await expect(parameter(dialog, 'Knee width')).toBeVisible();
			await expect(parameter(dialog, 'Lookahead')).toBeVisible();
			await expect(parameter(dialog, name === 'Compressor' ? 'Make-up gain' : 'Make-up target')).toBeVisible();
			await closeDialog(dialog);
		}
		expect(errors).toEqual([]);
	});

	test('compressor places history above its two knob grids and compression curve', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await useAudacityDarkTheme(page, editor);
		await importFiles(editor, [toneA]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Compressor');
		const dialog = page.getByRole('dialog', { name: 'Compressor', exact: true });
		const history = await expectHistoryControls(dialog);
		const historyBox = await box(history);
		const curve = dialog.getByRole('img', { name: curveName, exact: true });
		const curveBox = await box(curve);
		const drawing = await box(curve.locator('svg'));
		const labels = ['Attack', 'Release', 'Threshold', 'Ratio', 'Lookahead', 'Knee width', 'Make-up gain'];
		const controls = Object.fromEntries(await Promise.all(labels.map(async label => [label, await box(parameter(dialog, label))])));
		expect(historyBox.height).toBeGreaterThan(200);
		expect(historyBox.width).toBeGreaterThan(curveBox.width * 1.8);
		expect(historyBox.y + historyBox.height).toBeLessThanOrEqual(controls.Attack.y);
		expect(curveBox.width).toBeGreaterThan(250);
		expect(curveBox.height).toBeGreaterThan(150);
		expect(drawing.width).toBeGreaterThan(250);
		expect(drawing.height).toBeGreaterThan(150);
		expect(drawing.height).toBeLessThanOrEqual(210);
		expect(curveBox.x).toBeGreaterThan(controls.Ratio.x + controls.Ratio.width);
		for (const label of ['Release', 'Threshold', 'Ratio']) {
			expect(Math.abs(controls[label].y - controls.Attack.y)).toBeLessThan(2);
		}
		for (const [upper, lower] of [['Attack', 'Lookahead'], ['Threshold', 'Knee width'], ['Ratio', 'Make-up gain']]) {
			expect(controls[lower].y).toBeGreaterThan(controls[upper].y + controls[upper].height);
			expect(Math.abs(controls[lower].x - controls[upper].x)).toBeLessThan(2);
		}
		await expect(dialog.getByRole('heading', { name: /^(Timing|Compression|Response)$/u })).toHaveCount(0);
		const defaultPreset = dialog.getByRole('button', { name: 'Preset', exact: true });
		const threshold = parameter(dialog, 'Threshold').getByRole('spinbutton');
		const defaultThreshold = await threshold.inputValue();
		await expect(defaultPreset).toContainText('Default preset');
		await commitInput(threshold, '-18');
		await expect(defaultPreset).toContainText('*');
		await dialog.getByRole('button', { name: 'Reset preset', exact: true }).click();
		await expect(threshold).toHaveValue(defaultThreshold);
		await expect(defaultPreset).not.toContainText('*');
		for (const [label, value] of [['Attack', '3'], ['Release', '100'], ['Lookahead', '3'], ['Threshold', '-12'], ['Ratio', '4'], ['Knee width', '6'], ['Make-up gain', '9']]) {
			const control = parameter(dialog, label);
			const labelBox = await box(control.getByText(label, { exact: true }).first());
			const knobBox = await box(control.getByRole('slider'));
			const input = control.getByRole('spinbutton');
			const inputBox = await box(input);
			expect(inputBox.width).toBeGreaterThanOrEqual(60);
			expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(knobBox.y);
			expect(knobBox.y + knobBox.height).toBeLessThanOrEqual(inputBox.y);
			await commitInput(input, value);
			await expect(input).toHaveValue(value);
		}
		await expectPresetAndBypass(page, dialog, 'Glue Compressor', '-22');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('limiter uses history and a single row of large level and small character knobs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await useAudacityDarkTheme(page, editor);
		await importFiles(editor, [toneA]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Limiter');
		const dialog = page.getByRole('dialog', { name: 'Limiter', exact: true });
		const historyBox = await box(await expectHistoryControls(dialog));
		const labels = ['Threshold', 'Make-up target', 'Lookahead', 'Knee width', 'Release'];
		const bounds = await Promise.all(labels.map(label => box(parameter(dialog, label))));
		for (let index = 0; index < bounds.length; index += 1) {
			expect(bounds[index].y).toBeGreaterThanOrEqual(historyBox.y + historyBox.height);
			if (index) expect(bounds[index].x).toBeGreaterThan(bounds[index - 1].x + bounds[index - 1].width);
			expect(Math.abs(bounds[index].y + bounds[index].height / 2 - bounds[0].y - bounds[0].height / 2)).toBeLessThan(18);
		}
		const largeKnob = await box(parameter(dialog, 'Threshold').getByRole('slider'));
		const smallKnob = await box(parameter(dialog, 'Lookahead').getByRole('slider'));
		expect(largeKnob.height).toBeGreaterThan(smallKnob.height * 1.4);
		await expect(dialog.getByRole('img', { name: curveName, exact: true })).toHaveCount(0);
		await expect(dialog.getByRole('heading', { name: /^(Level|Character|Response)$/u })).toHaveCount(0);
		await expectPresetAndBypass(page, dialog, 'Master Limiter', '-0.1');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	for (const name of ['Compressor', 'Limiter']) {
		test(`${name} selection dialog only shows the controls Audacity uses destructively`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await importFiles(editor, [toneA]);
			await chooseCommandAction(page, editor, 'Select', 'Select all');
			await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', name]);
			const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
			await expect(parameter(dialog, 'Threshold')).toBeVisible();
			await expect(dialog.getByRole('img', { name: historyName, exact: true })).toHaveCount(0);
			await expect(dialog.getByRole('checkbox', { name: 'Compression', exact: true })).toHaveCount(0);
			await expect(dialog.getByRole('img', { name: curveName, exact: true })).toHaveCount(name.startsWith('Compressor') ? 1 : 0);
			await commitInput(parameter(dialog, 'Threshold').getByRole('spinbutton'), '-18');
			await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
			await expect(dialog).toBeHidden({ timeout: 20_000 });
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
			expect(errors).toEqual([]);
		});
	}

	test('Bass and Treble uses three large knobs with no invented card headings', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Bass and Treble');
		const dialog = page.getByRole('dialog', { name: 'Bass and Treble', exact: true });
		const labels = ['Bass', 'Treble', 'Output volume'];
		const bounds = await Promise.all(labels.map(label => box(parameter(dialog, label))));
		for (let index = 0; index < labels.length; index += 1) {
			const control = parameter(dialog, labels[index]);
			const knob = await box(control.getByRole('slider'));
			const labelBox = await box(control.getByText(labels[index], { exact: true }).first());
			const inputBox = await box(control.getByRole('spinbutton'));
			expect(knob.height).toBeGreaterThanOrEqual(48);
			expect(knob.y + knob.height).toBeLessThanOrEqual(labelBox.y);
			expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(inputBox.y);
			expect(Math.abs(bounds[index].y - bounds[0].y)).toBeLessThan(2);
			if (index) expect(bounds[index].x).toBeGreaterThan(bounds[index - 1].x + bounds[index - 1].width);
			await commitInput(control.getByRole('spinbutton'), '3');
			await expect(control.getByRole('spinbutton')).toHaveValue('3');
		}
		await expect(dialog.getByRole('heading', { name: /^(Tone|Output)$/u })).toHaveCount(0);
		const bassKnob = parameter(dialog, 'Bass').getByRole('slider');
		await bassKnob.press('ArrowUp');
		await expect.poll(async () => Number(await bassKnob.getAttribute('aria-valuenow'))).toBeGreaterThan(3);
		const knobBox = await box(bassKnob);
		await page.mouse.dblclick(knobBox.x + knobBox.width / 2, knobBox.y + knobBox.height / 2);
		await expect(bassKnob).toBeFocused();
		await expect(parameter(dialog, 'Bass').getByRole('spinbutton')).toHaveValue('0');
		for (const label of labels) await commitInput(parameter(dialog, label).getByRole('spinbutton'), '0');
		await dialog.getByRole('checkbox', { name: 'Auto-adjust volume to preserve loudness', exact: true }).click();
		await commitInput(parameter(dialog, 'Bass').getByRole('spinbutton'), '12');
		await expect(parameter(dialog, 'Output volume').getByRole('spinbutton')).toHaveValue('-6');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Reverb keeps its large space knobs beside the small tone and mix knobs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb (Audacity)']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		const room = await box(parameter(dialog, 'Room size'));
		const stereo = await box(parameter(dialog, 'Stereo width'));
		const preDelay = await box(parameter(dialog, 'Pre-delay'));
		const damping = await box(parameter(dialog, 'Damping'));
		expect(Math.abs(room.y - stereo.y)).toBeLessThan(2);
		expect(preDelay.y).toBeGreaterThan(room.y + room.height);
		expect(Math.abs(preDelay.x - room.x)).toBeLessThan(2);
		expect(damping.x).toBeGreaterThan(stereo.x + stereo.width);
		const large = await box(parameter(dialog, 'Room size').getByRole('slider'));
		const small = await box(parameter(dialog, 'Damping').getByRole('slider'));
		expect(large.height).toBeGreaterThan(small.height * 1.4);
		await expect(dialog.getByRole('heading', { name: /^(Space|Tone|Mix)$/u })).toHaveCount(0);
		const preset = dialog.getByRole('button', { name: 'Preset', exact: true });
		await preset.click();
		await page.getByRole('option', { name: 'Cathedral', exact: true }).click();
		await expect(parameter(dialog, 'Room size').getByRole('spinbutton')).toHaveValue('90');
		await expect(parameter(dialog, 'Tone high').getByRole('spinbutton')).toHaveValue('0');
		await expect(parameter(dialog, 'Dry gain').getByRole('spinbutton')).toHaveValue('-20');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Normalize keeps the peak field beside its checkbox and disables it without hiding it', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Normalize']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		const applyGain = dialog.getByRole('checkbox', { name: 'Normalize peak amplitude to', exact: true });
		const peak = parameter(dialog, 'Peak amplitude').getByRole('spinbutton');
		const checkBox = await box(applyGain);
		const peakBox = await box(peak);
		expect(peakBox.x).toBeGreaterThan(checkBox.x + checkBox.width);
		expect(Math.abs(peakBox.y + peakBox.height / 2 - checkBox.y - checkBox.height / 2)).toBeLessThan(18);
		await applyGain.click();
		await expect(peak).toBeVisible();
		await expect(peak).toBeDisabled();
		await applyGain.click();
		await expect(peak).toBeEnabled();
		await commitInput(peak, '-3');
		await expect(peak).toHaveValue('-3');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Amplify links the new peak slider and amplification through their shared value', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		const gain = parameter(dialog, 'Amplification').getByRole('spinbutton');
		const peakControl = parameter(dialog, 'New peak amplitude');
		const peak = peakControl.getByRole('spinbutton');
		await expect(peakControl.getByRole('slider')).toBeVisible();
		const startingGain = Number(await gain.inputValue());
		const startingPeak = Number(await peak.inputValue());
		await commitInput(peak, String(startingPeak - 3));
		await expect.poll(async () => Number(await gain.inputValue())).toBeCloseTo(startingGain - 3, 2);
		await commitInput(gain, String(startingGain - 6));
		await expect.poll(async () => Number(await peak.inputValue())).toBeCloseTo(startingPeak - 6, 2);
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Change Pitch links its percentage, semitone and frequency inputs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change pitch']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		const percent = parameter(dialog, 'Percentage change').getByRole('spinbutton');
		const semitones = parameter(dialog, 'Semitones').getByRole('spinbutton');
		const frequency = parameter(dialog, 'To frequency').getByRole('spinbutton');
		await commitInput(parameter(dialog, 'From frequency').getByRole('spinbutton'), '440');
		await commitInput(percent, '100');
		await expect(semitones).toHaveValue('12');
		await expect(frequency).toHaveValue('880');
		await commitInput(frequency, '440');
		await expect(semitones).toHaveValue('0');
		await expect(percent).toHaveValue('0');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});

	test('Noise Reduction keeps its two instruction cards and output modes connected to profile capture', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Noise Reduction');
		const dialog = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
		const first = dialog.locator('[data-effect-noise-profile]').locator('..');
		const second = dialog.getByRole('heading', { name: 'Step 2', exact: true }).locator('..');
		await expect(first.getByRole('heading', { name: 'Step 1', exact: true })).toBeVisible();
		await expect(first).toContainText('Select a few seconds of isolated noise so Audacity knows what to filter out');
		await expect(second).toContainText('Select all of the audio you want filtered');
		const firstBox = await box(first);
		const secondBox = await box(second);
		expect(secondBox.x).toBeGreaterThan(firstBox.x + firstBox.width);
		expect(Math.abs(secondBox.y - firstBox.y)).toBeLessThan(2);
		for (const name of ['reductionDb', 'sensitivity', 'frequencySmoothingBands']) {
			await expect(second.locator(`[data-audacity-parameter="${name}"]`).getByRole('slider')).toBeVisible();
		}
		const output = dialog.getByRole('radiogroup', { name: 'Output', exact: true });
		await expect(output.getByRole('radio', { name: 'Audio with noise removed', exact: true })).toBeChecked();
		await output.getByRole('radio', { name: 'Noise only', exact: true }).check();
		await expect(output.getByRole('radio', { name: 'Noise only', exact: true })).toBeChecked();
		await first.getByRole('button', { name: 'Get noise profile', exact: true }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(first.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible();
		await closeDialog(dialog);
		await panel.locator('[data-effect-rack]').getByRole('group', { name: 'Noise Reduction', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		await expect(dialog.getByRole('radio', { name: 'Noise only', exact: true })).toBeChecked();
		await expect(dialog.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible();
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});
});
