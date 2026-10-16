/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const channelCount of [2, 4]) {
	test(`a timeline Invert processes an ordinary ${channelCount}-channel recording`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: `timeline-${channelCount}-channels.wav`,
			frequency: 750, duration: 1, channelCount })]);
		const original = await exportSamples(page, editor);
		expect(original).toHaveLength(48_000);
		expect(original.slice(4800, 43_200).some(value => Math.abs(value) > .1)).toBe(true);
		await editor.locator('[data-clip-id]').first().locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
		await expect(editor.getByRole('alert')).toHaveCount(0);
		await expectPolarity(-1);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expectPolarity(1);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expectPolarity(-1);

		async function expectPolarity(polarity) {
			const actual = await exportSamples(page, editor);
			expect(actual).toHaveLength(original.length);
			let maximumError = 0;
			for (let frame = 4800; frame < 43_200; frame++) {
				maximumError = Math.max(maximumError, Math.abs(actual[frame] - polarity * original[frame]));
			}
			expect(maximumError).toBeLessThan(.0001);
		}
	});
}
