/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('header and mixer Pan controls admit stereo and suspend ordinary four-channel recordings', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [2, 4].map(channelCount => createWavFixture({
		name: `${channelCount}-channel-recording.wav`, frequency: 440, duration: 1, channelCount,
	})));
	const header = count => editor.getByRole('group', { name: `${count}-channel-recording track controls`, exact: true });
	const pan = strip => strip.getByRole('slider', { name: /^Pan(?:$|:)/u });
	const solo = strip => strip.getByRole('button', { name: 'Solo', exact: true });
	await solo(header(2)).click();
	const healthy = rms(await exportSamples(page, editor));
	expect(healthy).toBeGreaterThan(.2);
	await solo(header(2)).click();
	await solo(header(4)).click();
	const original = rms(await exportSamples(page, editor));
	expect(original).toBeGreaterThan(.2);
	await solo(header(4)).click();
	for (const surface of ['header', 'mixer']) await test.step(surface, async () => {
		if (surface === 'mixer') await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
		const channel = count => surface === 'mixer'
			? editor.locator('.kw-audio-editor__mixer-channel--track').filter({ hasText: `${count}-channel-recording` })
			: header(count);
		const stereo = channel(2), wide = channel(4);
		await expect(solo(stereo)).toHaveAttribute('aria-pressed', 'false');
		await expect(solo(wide)).toHaveAttribute('aria-pressed', 'false');
		await expect(pan(stereo)).toHaveAttribute('aria-valuenow', '0');
		await solo(stereo).click();
		await expect(pan(stereo)).toBeEnabled();
		await pan(stereo).press('End');
		await expect(pan(stereo)).toHaveAttribute('aria-valuenow', '100');
		expect(rms(await exportSamples(page, editor))).toBeLessThan(.0001);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(pan(stereo)).toHaveAttribute('aria-valuenow', '0');
		await solo(stereo).click();
		await solo(wide).click();
		await pan(wide).press('End');
		const attempted = rms(await exportSamples(page, editor));
		expect(attempted).toBeCloseTo(original, 6);
		await expect(pan(wide)).toBeDisabled();
		await expect(pan(wide)).toHaveAttribute('aria-valuenow', '0');
		await solo(wide).click();
	});
});

function rms(samples) {
	const window = samples.slice(12_000, 36_000);
	return Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
}
