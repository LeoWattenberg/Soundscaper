/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, clipField,
	closeClipProperties, commitInput, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const [field, value] of [['pitchCents', '2'], ['speedRatio', '2']]) {
	test(`Render preserves the audible authored warp after an independent ${field} edit`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		const recording = createWavFixture({ name: `independent-warp-${field}.wav`, frequency: 1000,
			duration: 1, channelCount: 1 });
		recording.buffer.fill(0, 44 + 12_000 * 2, 44 + 24_000 * 2);
		await importFiles(editor, [recording]);
		const clip = clipByName(editor, recording.name);
		await clip.locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
		await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
		await warp.getByLabel('Outer position', { exact: true }).fill('24000');
		await warp.getByLabel('Source sample', { exact: true }).fill('36000');
		await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
		await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
		await warp.getByRole('button', { name: 'Close', exact: true }).click();
		const properties = await openClipProperties(page, editor, clip);
		await properties.getByText('Pitch and tempo', { exact: true }).click();
		await expect(properties.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true })).not.toBeChecked();
		await commitInput(clipField(properties, field), value);
		await expect(clipField(properties, field)).toHaveValue(field === 'pitchCents' ? '2.00' : value);
		await closeClipProperties(properties);
		const before = await exportSamples(page, editor);
		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		await page.locator('.audio-editor-clip-context-menu')
			.getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
		const rendered = clipByName(editor, `${recording.name} — Render pitch and speed`);
		await expect(rendered).toBeVisible({ timeout: 10_000 });
		await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
		const after = await exportSamples(page, editor);
		expect(after).toHaveLength(before.length);
		expect(differenceRms(before, after)).toBeLessThan(.002);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clip).toBeVisible();
		const restored = await exportSamples(page, editor);
		expect(differenceRms(before, restored)).toBeLessThan(.0001);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(rendered).toBeVisible();
		const redone = await exportSamples(page, editor);
		expect(differenceRms(after, redone)).toBeLessThan(.0001);
	});
}

function differenceRms(first, second) {
	let sum = 0;
	for (let frame = 0; frame < first.length; frame++) sum += (first[frame] - second[frame]) ** 2;
	return Math.sqrt(sum / first.length);
}
