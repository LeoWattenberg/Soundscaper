/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('source musical ruler keeps authored tempo-change labels readable', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await editor.getByRole('button', { name: 'Fullscreen', exact: true }).click();
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	const recording = createWavFixture({ name: 'source tempo recording.wav', duration: 120, channelCount: 1 });
	await importFiles(editor, [recording]);
	const panel = await openClipProperties(page, editor, clipByName(editor, recording.name));
	const ruler = panel.getByRole('slider', { name: 'Source timeline', exact: true });
	await ruler.press('Shift+F10');
	await page.getByRole('menuitem', { name: 'Beats & measures', exact: true }).click();
	const labels = () => ruler.locator('text').evaluateAll(elements => elements.map(element => {
		const bounds = element.getBoundingClientRect();
		return { text: element.textContent, start: bounds.left, end: bounds.right };
	}));
	const healthy = await labels();
	expect(healthy.length).toBeGreaterThan(1);
	for (let index = 1; index < healthy.length; index += 1) expect(healthy[index].start).toBeGreaterThan(healthy[index - 1].end);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('960');
	await tempo.blur();
	await expect(tempo).toHaveValue('960');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await musical.getByRole('button', { name: 'Add tempo event', exact: true }).click();
	const second = musical.getByRole('form', { name: 'Tempo event 2', exact: true });
	await second.getByRole('spinbutton', { name: 'Beat position numerator', exact: true }).fill('40');
	await second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('30');
	await second.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('30');
	await musical.press('Escape');
	const changed = await labels();
	expect(changed.length).toBeGreaterThan(1);
	for (let index = 1; index < changed.length; index += 1) expect(changed[index].start).toBeGreaterThan(changed[index - 1].end);
});
