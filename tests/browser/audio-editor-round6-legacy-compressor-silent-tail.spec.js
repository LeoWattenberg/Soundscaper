/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeClipProperties, disableNativeSavePicker,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

// An ordinary IEEE float WAV containing a one-second tone and a digital pause.
const buffer = Buffer.alloc(44 + 72_000 * 4);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(buffer.length - 8, 4);
buffer.write('WAVEfmt ', 8);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(3, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(48_000, 24);
buffer.writeUInt32LE(48_000 * 4, 28);
buffer.writeUInt16LE(4, 32);
buffer.writeUInt16LE(32, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(72_000 * 4, 40);
for (let frame = 0; frame < 48_000; frame++) buffer.writeFloatLE(.8 * Math.sin(2 * Math.PI * 330 * frame / 48_000), 44 + frame * 4);

test('Source Legacy Compressor accepts a normal float recording followed by digital silence', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'ordinary-tone-and-pause.wav', mimeType: 'audio/wav', buffer }]);
	const properties = await openClipProperties(page, editor);
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Legacy effects', 'Legacy Compressor']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	await closeClipProperties(properties);
	const output = await exportSamples(page, editor);
	expect(output.every(Number.isFinite)).toBe(true);
	expect(Math.max(...output.slice(55_000, 65_000).map(Math.abs))).toBe(0);
	expect(Math.max(...output.slice(10_000, 20_000).map(Math.abs))).toBeGreaterThan(.5);
});
