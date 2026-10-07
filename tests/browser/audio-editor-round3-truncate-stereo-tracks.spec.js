/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction,
	clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('independent track truncation preserves synchronization within a stereo track', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'stereo-dialogue.wav', frequency: 440, duration: 2 });
	// A normal stereo recording: each microphone has a different one-second pause.
	for (let channel = 0; channel < 2; channel++) {
		const start = channel ? 33_600 : 14_400;
		for (let frame = start; frame < start + 48_000; frame++) recording.buffer.writeInt16LE(0, 44 + (frame * 2 + channel) * 2);
	}
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Truncate Silence']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await effect.locator('[data-effect-param="independent"]').getByRole('checkbox').check();
	const truncate = effect.locator('[data-effect-param="truncateTo"]').getByRole('group');
	await truncate.locator('.timecode-digit').first().click();
	await page.keyboard.type('000000000');
	await page.keyboard.press('Enter');
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const rendered = await exportSamples(page, editor);
	expect(rendered.length / 48_000).toBeCloseTo(1.4, 2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await exportSamples(page, editor);
	expect(restored.length).toBe(96_000);
});
