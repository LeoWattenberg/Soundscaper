/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	collectClientErrors, effectSourcePeak, importFiles } from './audio-editor-test-helpers.js';

for (const name of ['Graphic EQ', 'Filter Curve EQ']) {
	test(`${name} completes its curve at primary release while middle remains held`, async ({ page }) => {
		const errors = collectClientErrors(page);
		const recording = createWavFixture({ name: `${name} release recording.wav`, frequency: 1000, duration: 1 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [recording]);
		const open = async () => {
			await chooseCommandAction(page, editor, 'Select', 'Select all');
			await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', name]);
			const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
			await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
			return dialog;
		};
		let dialog = await open();
		let curve = await curveControls(dialog, name);
		await drag(page, curve, 6);
		await page.mouse.up();
		const healthyGain = await curve.gain();
		expect(healthyGain).toBeCloseTo(6, 0);
		await apply(dialog);
		const healthyPeak = await effectSourcePeak(page, name);
		expect(healthyPeak).toBeGreaterThan(.5);
		expect(healthyPeak).toBeLessThan(.75);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, recording.name)).toBeVisible();
		dialog = await open();
		curve = await curveControls(dialog, name);
		await curve.owner.evaluate(element => {
			element.addEventListener('pointermove', event => {
				if (event.pointerType === 'mouse' && event.button === 0 && event.buttons === 4) {
					element.dataset.primaryReleased = 'true';
				}
			});
		});
		await drag(page, curve, 6);
		await expect.poll(curve.gain).toBeCloseTo(healthyGain, 0);
		await page.mouse.down({ button: 'middle' });
		await page.mouse.up();
		await expect(curve.owner).toHaveAttribute('data-primary-released', 'true');
		const after = curve.at(-6);
		await page.mouse.move(after.x, after.y, { steps: 4 });
		await page.mouse.up({ button: 'middle' });
		await expect.poll(curve.gain).toBeCloseTo(healthyGain, 0);
		await apply(dialog);
		await expect.poll(() => effectSourcePeak(page, name)).toBeCloseTo(healthyPeak, 3);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, recording.name)).toBeVisible();
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(() => effectSourcePeak(page, name)).toBeCloseTo(healthyPeak, 3);
		await expect(editor.getByRole('alert')).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

async function curveControls(dialog, name) {
	if (name === 'Graphic EQ') {
		const slider = dialog.getByRole('slider', { name: '1000 Hz', exact: true });
		await slider.scrollIntoViewIfNeeded();
		const box = await slider.boundingBox();
		expect(box).not.toBeNull();
		return { owner: dialog.locator('.audio-editor-graphic-eq__board'),
			gain: async () => Number(await slider.getAttribute('aria-valuenow')),
			at: gain => ({ x: box.x + box.width / 2, y: box.y + (20 - gain) / 40 * box.height }) };
	}
	const owner = dialog.getByRole('group', { name: 'Equalization curve', exact: true });
	const box = await owner.boundingBox();
	expect(box).not.toBeNull();
	return { owner, gain: async () => (await owner.getByRole('button').count()) === 1
		? Number((await owner.getByRole('button').getAttribute('aria-label'))?.match(/, (-?[\d.]+) dB$/)?.[1]) : Number.NaN,
		at: gain => ({ x: box.x + 340 / 640 * box.width, y: box.y + (16 + (30 - gain) / 60 * 244) / 300 * box.height }) };
}

async function drag(page, curve, gain) {
	const start = curve.at(0), end = curve.at(gain);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 4 });
}

async function apply(dialog) {
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden();
}
