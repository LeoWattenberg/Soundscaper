/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const independent of [false, true]) test(`Truncate Silence preview keeps ${independent ? 'stereo channels' : 'linked clips'} synchronized`, async ({ page }) => {
	await page.addInitScript(() => {
		window.__round3TruncatePreviewDurations = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer) window.__round3TruncatePreviewDurations.push(this.buffer.duration);
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const recordings = independent
		? [createWavFixture({ name: 'stereo-dialogue.wav', frequency: 440, duration: 2 })]
		: [0, 1].map(index => createWavFixture({ name: `dialogue-${index}.wav`,
			frequency: index ? 440 : 330, duration: 2, channelCount: 1 }));
	for (let lane = 0; lane < 2; lane++) {
		const recording = recordings[independent ? 0 : lane];
		const channels = independent ? 2 : 1;
		for (let frame = lane ? 33_600 : 14_400; frame < (lane ? 81_600 : 62_400); frame++) {
			recording.buffer.writeInt16LE(0, 44 + (frame * channels + (independent ? lane : 0)) * 2);
		}
	}
	await importFiles(editor, recordings);
	await clipByName(editor, recordings[0].name).locator('.clip-header').click();
	if (!independent) await clipByName(editor, recordings[1].name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Truncate Silence']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await effect.locator('[data-effect-param="independent"]').getByRole('checkbox').setChecked(independent);
	await effect.locator('[data-effect-param="truncateTo"] .timecode-digit').first().click();
	await page.keyboard.type('000000000');
	await page.keyboard.press('Enter');
	await effect.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round3TruncatePreviewDurations.at(-1)),
		{ timeout: 20_000 }).toBeCloseTo(1.4, 2);
});
