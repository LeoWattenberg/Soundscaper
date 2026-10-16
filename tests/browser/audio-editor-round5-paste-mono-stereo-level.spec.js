/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior,
	clipByName, disableNativeSavePicker, importFiles,
} from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const destination = createWavFixture({ name: 'silent-stereo-destination.wav', frequency: 660,
	channelCount: 2, channelAmplitudes: [0, 0] });
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

test('pasting mono into an existing stereo recording preserves its listening level', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Always paste audio as a new clip', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [monoTone, destination]);
	const original = clipByName(editor, monoTone.name);
	const before = await exportSamples(page, editor);
	const originalLevel = rms(before.slice(12_000, 16_800));
	expect(originalLevel).toBeGreaterThan(0.17); expect(originalLevel).toBeLessThan(0.18);
	await original.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and leave gap']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await clickClipInterior(page, clipByName(editor, destination.name), 0.25);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(clipByName(editor, destination.name)).toHaveAttribute('aria-label', /1\.6 seconds long$/u);
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length * 2);
	expect(rms(after.slice(19_200, 28_800))).toBeCloseTo(originalLevel, 4);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	expect(rms((await exportSamples(page, editor)).slice(19_200, 28_800))).toBeLessThan(0.00001);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	expect(rms((await exportSamples(page, editor)).slice(19_200, 28_800))).toBeCloseTo(originalLevel, 4);
});
