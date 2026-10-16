/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior,
	clipByName, clipField, closeClipProperties, commitInput, disableNativeSavePicker,
	importFiles, openClipProperties,
} from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const silence = createWavFixture({ name: 'paste-destination.wav', frequency: 660,
	channelCount: 1, channelAmplitudes: [0] });

function amplitude(samples, frequency, start = 0.25, end = 0.35) {
	let real = 0, imaginary = 0;
	const first = Math.round(start * 48_000), last = Math.round(end * 48_000);
	for (let frame = first; frame < last; frame += 1) {
		const angle = 2 * Math.PI * frequency * frame / 48_000;
		real += samples[frame] * Math.cos(angle);
		imaginary += samples[frame] * Math.sin(angle);
	}
	return 2 * Math.hypot(real, imaginary) / (last - first);
}

test('paste into existing audio preserves the pitch of independently sped-up audio', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Always paste audio as a new clip', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [monoTone, silence]);
	const original = clipByName(editor, monoTone.name);
	const properties = await openClipProperties(page, editor, original);
	await properties.getByText('Pitch and tempo', { exact: true }).click();
	await expect(properties.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true })).not.toBeChecked();
	await commitInput(clipField(properties, 'speedRatio'), '2');
	await expect(clipField(properties, 'durationFrame')).toHaveValue('19200');
	await closeClipProperties(properties);
	const before = await exportSamples(page, editor);
	expect(amplitude(before, 440)).toBeGreaterThan(0.15);
	expect(amplitude(before, 880)).toBeLessThan(0.01);
	await original.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and leave gap']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const destination = clipByName(editor, silence.name);
	const destinationLabel = await destination.getAttribute('aria-label');
	await clickClipInterior(page, destination, 0.25);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect.poll(async () => Number(await editor.getAttribute('data-clip-count')) > 1
		|| await destination.getAttribute('aria-label') !== destinationLabel).toBe(true);
	const after = await exportSamples(page, editor);
	expect(amplitude(after, 440), JSON.stringify({ at440: amplitude(after, 440), at880: amplitude(after, 880) })).toBeGreaterThan(0.15);
	expect(amplitude(after, 880)).toBeLessThan(0.01);
	const pasted = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
	await expect(clipField(pasted, 'durationFrame')).toHaveValue('19200');
	await closeClipProperties(pasted);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	expect(amplitude(await exportSamples(page, editor), 440)).toBeLessThan(0.01);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	expect(amplitude(await exportSamples(page, editor), 440)).toBeGreaterThan(0.15);
});
