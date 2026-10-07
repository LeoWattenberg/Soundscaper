/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction,
	clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('linked Truncate Silence keeps selected clips synchronized at their common pause', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recordings = [0.3, 0.7].map((pause, index) => {
		const recording = createWavFixture({ name: `dialogue-${index}.wav`, frequency: index ? 440 : 330,
			duration: 2, channelCount: 1 });
		recording.buffer.fill(0, 44 + Math.round(pause * 48_000) * 2, 44 + Math.round((pause + 1) * 48_000) * 2);
		return recording;
	});
	await importFiles(editor, recordings);
	await clipByName(editor, recordings[0].name).locator('.clip-header').click();
	await clipByName(editor, recordings[1].name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Truncate Silence']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(effect.locator('[data-effect-param="independent"]').getByRole('checkbox')).not.toBeChecked();
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
