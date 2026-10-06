/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, importFiles, openClipProperties, closeClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a macro Invert operates on the same source-editor selection as the effect menu', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'source-macro.wav', frequency: 1000,
		duration: 0.8, channelCount: 1, sampleRate: 44_100 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	const panel = await openClipProperties(page, editor, clip);
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	const box = await waveform.boundingBox();
	if (!box) throw new Error('Missing source waveform bounds');
	await page.mouse.move(box.x + box.width * 0.25, box.y + 80);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.5, box.y + 80, { steps: 4 });
	await page.mouse.up();
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20_000 });
	const expected = await exportSamples(page, editor);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("await sound.effect('audacity-invert');");
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed', { timeout: 30_000 });
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	await closeClipProperties(panel);
	const actual = await exportSamples(page, editor);
	expect(actual).toHaveLength(expected.length);
	expect(actual.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample - expected[index])), 0)).toBeLessThan(0.0001);
});
