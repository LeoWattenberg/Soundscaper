/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { observeListeningGains } from './helpers/round2-listening-gain-observer.js';

for (const preview of ['source', 'bin']) test(`${preview} preview inherits the listening volume`, async ({ page }) => {
	test.setTimeout(60_000);
	await observeListeningGains(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'preview-listening.wav', frequency: 440, duration: 5, channelCount: 1 });
	await importFiles(editor, [recording]);
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	await volume.fill('0');
	await expect(volume).toHaveAttribute('aria-valuetext', '−∞ dB');
	const clip = clipByName(editor, recording.name);
	let playing;
	if (preview === 'source') {
		const panel = await openClipProperties(page, editor, clip);
		await panel.getByRole('button', { name: 'Play', exact: true }).click();
		playing = panel.getByRole('button', { name: 'Pause', exact: true });
	} else {
		await clip.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /^Play:/u }).click();
		playing = editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /^Pause:/u });
	}
	await expect.poll(() => page.evaluate(() => window.__round2ListeningDestinationGains().at(-1))).toBe(0);
	await expect(playing).toBeVisible();
	await volume.fill('1');
	await expect(playing).toBeVisible();
	await expect.poll(() => page.evaluate(() => window.__round2ListeningDestinationGains().at(-1))).toBe(1);
});
