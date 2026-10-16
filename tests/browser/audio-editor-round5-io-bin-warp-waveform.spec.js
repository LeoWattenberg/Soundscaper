/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a warped bin template draws its pause at the audible source position', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const file = createWavFixture({ name: 'warped-phrase.wav', sampleRate: 48_000, duration: 1,
		frequency: 1000, channelCount: 1 });
	file.buffer.fill(0, 44 + 12_000 * 2, 44 + 24_000 * 2);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('24000');
	await warp.getByLabel('Source sample', { exact: true }).fill('36000');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	const audio = await exportSamples(page, editor);
	const pause = audio.slice(9_600, 11_520);
	expect(Math.sqrt(pause.reduce((sum, value) => sum + value * value, 0) / pause.length)).toBeLessThan(0.001);
	await chooseCommandAction(page, editor, 'Window', 'Project bin');
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	const path = card.locator('.kw-audio-editor__project-bin-waveform-peaks');
	await expect(path).toHaveAttribute('d', /M/u);
	const columns = Array.from((await path.getAttribute('d')).matchAll(/M([\d.]+) ([\d.-]+)V([\d.-]+)/gu),
		match => ({ x: Number(match[1]), amplitude: Number(match[3]) - Number(match[2]) }));
	const drawnPause = columns.filter(column => column.x > 30 && column.x < 45);
	expect(drawnPause.length).toBeGreaterThan(1);
	expect(drawnPause.every(column => column.amplitude < 0.02)).toBe(true);
});
