/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

test('a reversed bin template shows its audible phrase after its leading pause', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const samples = Float32Array.from({ length: 48_000 }, (_, frame) => frame < 24_000
		? 0.5 * Math.sin(2 * Math.PI * 440 * frame / 48_000) : 0);
	await importFiles(editor, [{ name: 'phrase-then-pause.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([samples], { sampleRate: 48_000, float: true })) }]);
	const clip = clipByName(editor, 'phrase-then-pause.wav');
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Media settings', { exact: true }).click();
	await properties.getByRole('checkbox', { name: 'Reverse', exact: true }).check();
	await closeClipProperties(properties);
	await chooseCommandAction(page, editor, 'Window', 'Project bin');
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toContainText('Reversed');
	const path = card.locator('.kw-audio-editor__project-bin-waveform-peaks');
	await expect(path).toHaveAttribute('d', /M/u);
	const positions = (await path.getAttribute('d')).matchAll(/M([\d.]+) ([\d.-]+)V([\d.-]+)/gu);
	const columns = Array.from(positions, match => ({ x: Number(match[1]), amplitude: Number(match[3]) - Number(match[2]) }));
	expect(columns.filter(column => column.x < 60).every(column => column.amplitude < 0.02)).toBe(true);
	expect(columns.filter(column => column.x > 100).some(column => column.amplitude > 10)).toBe(true);
});
