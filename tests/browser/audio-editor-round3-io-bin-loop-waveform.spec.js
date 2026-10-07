/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

test('a looped bin template draws both audible repetitions and both pauses', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const samples = Float32Array.from({ length: 38_400 }, (_, frame) => frame < 19_200
		? 0.5 * Math.sin(2 * Math.PI * 440 * frame / 48_000) : 0);
	await importFiles(editor, [{ name: 'loop-phrase.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([samples], { sampleRate: 48_000, float: true })) }]);
	const clip = clipByName(editor, 'loop-phrase.wav');
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
	await chooseCommandAction(page, editor, 'Window', 'Project bin');
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toContainText('0:01.6');
	const path = card.locator('.kw-audio-editor__project-bin-waveform-peaks');
	await expect(path).toHaveAttribute('d', /M/u);
	const positions = (await path.getAttribute('d')).matchAll(/M([\d.]+) ([\d.-]+)V([\d.-]+)/gu);
	const columns = Array.from(positions, match => ({ x: Number(match[1]), amplitude: Number(match[3]) - Number(match[2]) }));
	for (const [start, end] of [[10, 30], [90, 110]]) {
		const region = columns.filter(column => column.x > start && column.x < end);
		expect(region.length).toBeGreaterThan(1);
		expect(region.every(column => column.amplitude > 10)).toBe(true);
	}
	for (const [start, end] of [[50, 70], [130, 150]]) {
		const region = columns.filter(column => column.x > start && column.x < end);
		expect(region.length).toBeGreaterThan(1);
		expect(region.every(column => column.amplitude < 0.02)).toBe(true);
	}
});
