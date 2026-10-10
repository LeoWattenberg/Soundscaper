/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const surface of ['header', 'mixer']) {
	test(`the ${surface} Pan control admits stereo and suspends ordinary four-channel recordings`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [2, 4].map(channelCount => createWavFixture({
			name: `${channelCount}-channel-recording.wav`, frequency: 440, duration: 1, channelCount,
		})));
		if (surface === 'mixer') await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
		const channel = count => surface === 'mixer'
			? editor.locator('.kw-audio-editor__mixer-channel--track').filter({ hasText: `${count}-channel-recording` })
			: editor.getByRole('group', { name: `${count}-channel-recording track controls`, exact: true });
		const stereo = channel(2), wide = channel(4);
		const pan = strip => strip.getByRole('slider', { name: /^Pan(?:$|:)/u });
		await stereo.getByRole('button', { name: 'Solo', exact: true }).click();
		const healthy = rms(await exportSamples(page, editor));
		expect(healthy).toBeGreaterThan(.2);
		await expect(pan(stereo)).toBeEnabled();
		await pan(stereo).press('End');
		await expect(pan(stereo)).toHaveAttribute('aria-valuenow', '100');
		expect(rms(await exportSamples(page, editor))).toBeLessThan(.0001);
		await stereo.getByRole('button', { name: 'Solo', exact: true }).click();
		await wide.getByRole('button', { name: 'Solo', exact: true }).click();
		const original = rms(await exportSamples(page, editor));
		expect(original).toBeGreaterThan(.2);
		await pan(wide).press('End');
		const attempted = rms(await exportSamples(page, editor));
		expect(attempted).toBeCloseTo(original, 6);
		await expect(pan(wide)).toBeDisabled();
		await expect(pan(wide)).toHaveAttribute('aria-valuenow', '0');
	});
}

function rms(samples) {
	const window = samples.slice(12_000, 36_000);
	return Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
}
