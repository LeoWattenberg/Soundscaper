/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('separately requested Noise generates independent downloaded recordings', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const generate = async () => {
		await chooseCommandAction(page, editor, 'Generate', 'Noise');
		const dialog = page.getByRole('dialog', { name: 'Noise', exact: true });
		const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
		await duration.locator('.timecode-digit').first().click();
		await page.keyboard.type('000001000');
		await page.keyboard.press('Enter');
		await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		return exportSamples(page, editor);
	};
	const first = await generate();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	const second = await generate();
	expect(first.length).toBe(48_000);
	expect(second.length).toBe(first.length);
	let cross = 0;
	let firstPower = 0;
	let secondPower = 0;
	for (let frame = 0; frame < first.length; frame++) {
		cross += first[frame] * second[frame];
		firstPower += first[frame] ** 2;
		secondPower += second[frame] ** 2;
	}
	expect(firstPower).toBeGreaterThan(1000);
	expect(secondPower).toBeGreaterThan(1000);
	expect(Math.abs(cross / Math.sqrt(firstPower * secondPower))).toBeLessThan(.05);
});

test('independently generated noise layers add independent energy to the exported mix', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	let first = [];
	for (let layer = 0; layer < 2; layer++) {
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await chooseCommandAction(page, editor, 'Generate', 'Noise');
		const dialog = page.getByRole('dialog', { name: 'Noise', exact: true });
		await dialog.locator('[data-generator-field="amplitude"] input').fill('.2');
		const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
		await duration.locator('.timecode-digit').first().click();
		await page.keyboard.type('000001000');
		await page.keyboard.press('Enter');
		await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor).toHaveAttribute('data-clip-count', String(layer + 1));
		if (layer === 0) {
			first = await exportSamples(page, editor);
			await test.info().attach('single-noise-layer.json', { body: JSON.stringify(first), contentType: 'application/json' });
		}
	}
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const mix = await exportSamples(page, editor);
	const energy = samples => samples.reduce((sum, sample) => sum + sample ** 2, 0);
	expect(energy(first)).toBeGreaterThan(100);
	const powerRatio = energy(mix) / energy(first);
	expect(powerRatio).toBeGreaterThan(1.8);
	expect(powerRatio).toBeLessThan(2.2);
});
