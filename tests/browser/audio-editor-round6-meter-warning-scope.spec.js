/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const [amplitude, ebu] of [[.8, false], [.9, true], [.9, false]]) {
	test(`the ordinary ${String(amplitude)} tone ${ebu ? 'retains EBU headroom' : 'has no false clipping'} warning`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'ordinary-headroom.wav', frequency: 440,
			duration: 20, channelCount: 2, channelAmplitudes: [amplitude, amplitude] })]);
		await chooseCommandAction(page, editor, 'Window', 'Mixer');
		const panel = editor.locator('[data-workspace-panel="playback-meter"]');
		if (!await panel.count()) await chooseCommandAction(page, editor, 'Window', 'Playback meter');
		await expect(panel).toBeVisible();
		if (ebu) {
			await panel.getByRole('button', { name: 'Playback meter settings', exact: true }).click();
			await page.getByRole('radio', { name: 'EBU R 128', exact: true }).check();
			await page.keyboard.press('Escape');
		}
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		const strip = editor.locator('.kw-audio-editor__mixer-channel--track').filter({ hasText: 'ordinary-headroom' });
		await expect.poll(() => strip.locator('.mixer-channel__meter-fill').first().evaluate(element =>
			Number(/^scaleY\(([^)]+)\)$/u.exec(element.style.transform)?.[1]))).toBeGreaterThan(.95);
		await expect(strip.locator('.mixer-channel__meter-clip--active')).toHaveCount(0);
		const warning = panel.locator('.kw-audio-editor__playback-meter-clipped');
		if (ebu) await expect(warning).toHaveCount(1);
		else await expect(warning).toHaveCount(0);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	});
}
