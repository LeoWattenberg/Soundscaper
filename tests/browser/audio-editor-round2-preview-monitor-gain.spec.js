/* SPDX-License-Identifier: AGPL-3.0-only */

import { observeListeningGains } from './helpers/round2-listening-gain-observer.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

for (const kind of ['tempo', 'eq', 'nyquist']) test(`${kind} previews respect the muted playback listening level`, async ({ page }) => {
	test.setTimeout(60_000);
	await observeListeningGains(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	await volume.fill('0');
	await expect(volume).toHaveAttribute('aria-valuetext', '−∞ dB');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	if (kind === 'eq') await openParametricEqSelectionEffect(page, editor);
	else if (kind === 'nyquist') {
		await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Rhythm Track']);
		const dialog = page.getByRole('dialog', { name: 'Rhythm Track', exact: true });
		await dialog.getByRole('spinbutton', { name: /^Tempo \(bpm\)/u }).fill('300');
		await dialog.getByRole('spinbutton', { name: /^Number of bars/u }).fill('1');
	} else await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change tempo']);
	await page.getByRole('dialog', { name: kind === 'nyquist' ? 'Rhythm Track' : 'Apply effect', exact: true }).getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round2PreviewListeningGains.at(-1))).toEqual([0]);
});
