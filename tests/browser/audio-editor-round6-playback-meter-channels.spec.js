/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Playback meter preserves the ordinary silent right channel', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'left-channel-meter.wav', frequency: 440,
		duration: 20, channelCount: 2, channelAmplitudes: [0.8, 0] })]);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	await chooseCommandAction(page, editor, 'Window', 'Playback meter');
	const panel = editor.locator('[data-workspace-panel="playback-meter"]');
	await expect(panel).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Window', 'Playback meter');
	await expect(panel).toBeVisible();
	const fills = panel.locator('.kw-audio-editor__playback-meter-peak');
	await expect(fills).toHaveCount(2);
	const trackFills = editor.locator('.kw-audio-editor__mixer-channel--track').filter({ hasText: 'left-channel-meter' })
		.locator('.mixer-channel__meter-fill');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => trackFills.first().evaluate(element => Number(/^scaleY\(([^)]+)\)$/u.exec(element.style.transform)?.[1])))
		.toBeGreaterThan(0.8);
	await expect.poll(() => trackFills.nth(1).evaluate(element => Number(/^scaleY\(([^)]+)\)$/u.exec(element.style.transform)?.[1])))
		.toBe(0);
	const level = fill => fill.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--playback-meter-peak')));
	await expect.poll(() => level(fills.first())).toBeGreaterThan(80);
	await expect.poll(() => level(fills.nth(1))).toBe(0);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
