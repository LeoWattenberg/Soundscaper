/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors,
	disableNativeSavePicker, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const kind of ['band', 'output']) test(`Parametric EQ ${kind} completes at primary release while middle remains held`, async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: `Parametric ${kind} recording.wav`, frequency: 500,
		duration: 1, channelCount: 1, channelAmplitudes: [.15] });
	await importFiles(editor, [recording]);
	const dryPeak = peak(await exportSamples(page, editor));
	// A mono track's default centered pan delivers equal-power stereo.
	expect(dryPeak).toBeCloseTo(.15 * Math.SQRT1_2, 3);
	const open = async () => {
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		const dialog = await openParametricEqSelectionEffect(page, editor);
		await dialog.locator('.audio-editor-parametric-eq__toolbar').getByRole('button', { name: 'Reset', exact: true }).click();
		return dialog;
	};
	let dialog = await open();
	let control = await controls(dialog, kind);
	await drag(page, control, 6);
	await page.mouse.up();
	const healthyGain = await control.gain();
	expect(healthyGain).toBeGreaterThan(5);
	expect(healthyGain).toBeLessThan(7);
	await apply(dialog);
	const healthyPeak = peak(await exportSamples(page, editor));
	expect(healthyPeak / dryPeak).toBeGreaterThan(1.7);
	expect(healthyPeak / dryPeak).toBeLessThan(2.3);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clipByName(editor, recording.name)).toBeVisible();
	dialog = await open();
	control = await controls(dialog, kind);
	await control.owner.evaluate(element => element.addEventListener('pointermove', event => {
		if (event.pointerType === 'mouse' && event.button === 0 && event.buttons === 4) element.dataset.primaryReleased = '4';
	}));
	await drag(page, control, 6);
	await expect.poll(control.gain).toBeCloseTo(healthyGain, 1);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await expect(control.owner).toHaveAttribute('data-primary-released', '4');
	const after = control.at(-6);
	await page.mouse.move(after.x, after.y, { steps: 4 });
	await page.mouse.up({ button: 'middle' });
	await expect.poll(control.gain).toBeCloseTo(healthyGain, 1);
	await apply(dialog);
	expect(peak(await exportSamples(page, editor))).toBeCloseTo(healthyPeak, 3);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clipByName(editor, recording.name)).toBeVisible();
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	expect(peak(await exportSamples(page, editor))).toBeCloseTo(healthyPeak, 3);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('Parametric output retains native keyboard and outside mouse completion with physical Undo and Redo', async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Outside Parametric recording.wav', frequency: 500,
		duration: 1, channelCount: 1, channelAmplitudes: [.15] });
	await importFiles(editor, [recording]);
	const dryPeak = peak(await exportSamples(page, editor));
	expect(dryPeak).toBeCloseTo(.15 * Math.SQRT1_2, 3);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	await dialog.locator('.audio-editor-parametric-eq__toolbar').getByRole('button', { name: 'Reset', exact: true }).click();
	const control = await controls(dialog, 'output');
	await control.owner.focus();
	await control.owner.press('ArrowRight');
	await expect.poll(control.gain).toBeCloseTo(.1, 2);
	await control.owner.press('ArrowLeft');
	await expect.poll(control.gain).toBe(0);
	await drag(page, control, 6);
	await expect.poll(control.gain).toBeGreaterThan(5);
	const accepted = await control.gain();
	expect(accepted).toBeLessThan(7);
	const outside = control.at(6); outside.y -= 45;
	await page.mouse.move(outside.x, outside.y);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	const later = control.at(-6); later.y = outside.y;
	await page.mouse.move(later.x, later.y, { steps: 4 });
	await page.mouse.up({ button: 'middle' });
	await expect.poll(control.gain).toBeCloseTo(accepted, 1);
	await apply(dialog);
	const wetPeak = peak(await exportSamples(page, editor));
	expect(wetPeak / dryPeak).toBeGreaterThan(1.7);
	expect(wetPeak / dryPeak).toBeLessThan(2.3);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	expect(peak(await exportSamples(page, editor))).toBeCloseTo(dryPeak, 3);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	expect(peak(await exportSamples(page, editor))).toBeCloseTo(wetPeak, 3);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});

async function controls(dialog, kind) {
	if (kind === 'output') {
		const owner = dialog.locator('.audio-editor-parametric-eq__output input[type="range"]');
		await owner.scrollIntoViewIfNeeded();
		const box = await owner.boundingBox();
		expect(box).not.toBeNull();
		return { owner, gain: async () => Number(await owner.inputValue()),
			at: gain => ({ x: box.x + (gain + 24) / 48 * box.width, y: box.y + box.height / 2 }) };
	}
	const owner = dialog.locator('.audio-editor-parametric-eq__handle').nth(1);
	await owner.scrollIntoViewIfNeeded();
	const box = await owner.boundingBox();
	const graph = await dialog.locator('.audio-editor-parametric-eq__graph').boundingBox();
	expect(box).not.toBeNull(); expect(graph).not.toBeNull();
	return { owner, gain: async () => Number((await owner.getAttribute('aria-label')).match(/, (-?[\d.]+) dB,/u)?.[1]),
		at: gain => ({ x: box.x + box.width / 2, y: graph.y + (24 - gain) / 48 * graph.height }) };
}

async function drag(page, control, gain) {
	const start = control.at(0), end = control.at(gain);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
}

async function apply(dialog) {
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden();
}

function peak(samples) {
	let maximum = 0;
	for (const value of samples) maximum = Math.max(maximum, Math.abs(value));
	return maximum;
}
