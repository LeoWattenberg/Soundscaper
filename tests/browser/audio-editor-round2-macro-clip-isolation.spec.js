/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a header-selected macro effect matches the ordinary effect without mixing an overlapping neighbor', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const neighbor = createWavFixture({ name: 'unselected-neighbor.wav', frequency: 880, channelCount: 1 });
	await importFiles(editor, [monoTone, neighbor]);
	const selected = clipByName(editor, monoTone.name);
	const incoming = clipByName(editor, neighbor.name);
	const track = selected.locator('xpath=ancestor::*[@data-track-row][1]');
	const trackName = (await track.locator('.track-control-panel__track-name-text').textContent()).trim();
	await incoming.click({ button: 'right', position: { x: 32, y: 10 } });
	const move = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover();
	await move.getByRole('menuitem', { name: trackName, exact: true }).click();
	await incoming.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20_000 });
	const expected = await exportSamples(page, editor);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await incoming.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("await sound.effect('audacity-invert');");
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed', { timeout: 30_000 });
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	const actual = await exportSamples(page, editor);
	expect(actual).toHaveLength(expected.length);
	const residual = actual.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample - expected[index])), 0);
	expect(residual).toBeLessThan(0.0001);
});
